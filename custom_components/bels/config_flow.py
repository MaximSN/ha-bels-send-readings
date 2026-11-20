from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.helpers import selector

from .const import (
    DOMAIN, CONF_ACCOUNT, CONF_PHONE, CONF_EMAIL,
    CONF_DAY_ENTITY, CONF_NIGHT_ENTITY, CONF_PEAK_ENTITY,
    CONF_ROUND_TO, CONF_AUTO_ENABLED, CONF_AUTO_DAY, CONF_AUTO_TIME,
)


class BelsConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            user_input[CONF_PHONE] = user_input.get(CONF_PHONE, "")
            user_input[CONF_EMAIL] = user_input.get(CONF_EMAIL, "")
            return self.async_create_entry(title="БЭЛС — передача показаний", data=user_input)
        schema = vol.Schema({
            vol.Required(CONF_ACCOUNT): str,
            vol.Optional(CONF_PHONE, default=""): str,
            vol.Optional(CONF_EMAIL, default=""): str,
        })
        return self.async_show_form(step_id="user", data_schema=schema)

    @staticmethod
    def async_get_options_flow(config_entry):
        return BelsOptionsFlow()


class BelsOptionsFlow(config_entries.OptionsFlow):
    async def async_step_init(self, user_input=None):
        if user_input is not None:
            account = user_input.pop(CONF_ACCOUNT)
            phone = user_input.pop(CONF_PHONE, "")
            email = user_input.pop(CONF_EMAIL, "")
            self.hass.config_entries.async_update_entry(
                self.config_entry,
                data={
                    **self.config_entry.data,
                    CONF_ACCOUNT: account,
                    CONF_PHONE: phone,
                    CONF_EMAIL: email,
                },
            )
            for entity_key in (CONF_NIGHT_ENTITY, CONF_PEAK_ENTITY):
                if not user_input.get(entity_key):
                    user_input.pop(entity_key, None)
            return self.async_create_entry(title="", data=user_input)

        current = self.config_entry.options
        entry_data = self.config_entry.data
        schema = {
            vol.Required(CONF_ACCOUNT, default=entry_data.get(CONF_ACCOUNT, "")): str,
            vol.Optional(CONF_PHONE, default=entry_data.get(CONF_PHONE, "")): str,
            vol.Optional(CONF_EMAIL, default=entry_data.get(CONF_EMAIL, "")): str,
            vol.Required(CONF_DAY_ENTITY, default=current.get(CONF_DAY_ENTITY, "sensor.elektroenergiia")): selector.EntitySelector(
                selector.EntitySelectorConfig(domain="sensor")
            ),
            vol.Optional(
                CONF_NIGHT_ENTITY,
                default=current.get(CONF_NIGHT_ENTITY, ""),
            ): selector.EntitySelector(selector.EntitySelectorConfig(domain="sensor")),
            vol.Optional(
                CONF_PEAK_ENTITY,
                default=current.get(CONF_PEAK_ENTITY, ""),
            ): selector.EntitySelector(selector.EntitySelectorConfig(domain="sensor")),
            vol.Required(CONF_ROUND_TO, default=current.get(CONF_ROUND_TO, 50)): vol.All(
                vol.Coerce(int), vol.Range(min=0, max=1000000)
            ),
            vol.Required(CONF_AUTO_ENABLED, default=current.get(CONF_AUTO_ENABLED, False)): bool,
            vol.Required(CONF_AUTO_DAY, default=current.get(CONF_AUTO_DAY, 1)): selector.NumberSelector(
                selector.NumberSelectorConfig(
                    min=1, max=31, step=1, mode=selector.NumberSelectorMode.BOX
                )
            ),
            vol.Required(CONF_AUTO_TIME, default=current.get(CONF_AUTO_TIME, "09:00:00")): selector.TimeSelector(),
        }
        return self.async_show_form(step_id="init", data_schema=vol.Schema(schema))
