from __future__ import annotations

import logging
import math
from calendar import monthrange
from datetime import time
from pathlib import Path

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store

from .client import BelsClient, build_payload, interpret_response
from .const import (
    DOMAIN, STORAGE_VERSION, HISTORY_LIMIT,
    CONF_ACCOUNT, CONF_PHONE, CONF_EMAIL,
    CONF_DAY_ENTITY, CONF_NIGHT_ENTITY, CONF_PEAK_ENTITY,
    CONF_ROUND_TO, CONF_AUTO_ENABLED, CONF_AUTO_DAY, CONF_AUTO_TIME,
)

_LOGGER = logging.getLogger(__name__)
CARD_PATH = Path(__file__).parent / "www" / "bels-panel.js"
CARD_URL = "/bels/bels-panel.js"
CARD_VERSION = "0.6.1"


def _normalize_reading(value, label: str, round_to: int, optional: bool = False):
    if value is None or (isinstance(value, str) and not value.strip()):
        if optional:
            return None
        raise ValueError(f"Не указано обязательное показание «{label}»")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"Показание «{label}» должно быть числом")
    if not math.isfinite(number):
        raise ValueError(f"Показание «{label}» должно быть конечным числом")
    if round_to > 0:
        number = math.ceil(number / round_to) * round_to
    return int(number) if number.is_integer() else number


def _reading(hass: HomeAssistant, entity_id: str | None, round_to: int, label: str, optional: bool = False):
    if not entity_id:
        if optional:
            return None
        raise ValueError(f"Не выбран сенсор «{label}»")
    state = hass.states.get(entity_id)
    if state is None:
        raise ValueError(f"Сущность {entity_id} не найдена")
    return _normalize_reading(state.state, label, round_to, optional)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/history"})
@websocket_api.async_response
async def websocket_get_history(hass, connection, msg):
    entries = []
    config = {}
    config_entries = hass.config_entries.async_entries(DOMAIN)
    domain_data = hass.data.get(DOMAIN, {})

    for entry in config_entries:
        data = domain_data.get(entry.entry_id)
        if data and "history" in data:
            entries = data["history"].get("entries", [])
        else:
            store = Store(
                hass, STORAGE_VERSION, f"{DOMAIN}_{entry.entry_id}_history"
            )
            stored_history = await store.async_load()
            if stored_history:
                entries = stored_history.get("entries", [])
        if entries:
            break

    if config_entries:
        entry = config_entries[0]
        options = entry.options
        config = {
            "account": entry.data.get(CONF_ACCOUNT, ""),
            "phone": entry.data.get(CONF_PHONE, ""),
            "email": entry.data.get(CONF_EMAIL, ""),
            "entities": {
                "day": options.get(CONF_DAY_ENTITY, "sensor.elektroenergiia"),
                "night": options.get(CONF_NIGHT_ENTITY, ""),
                "peak": options.get(CONF_PEAK_ENTITY, ""),
            },
            "round_to": int(options.get(CONF_ROUND_TO, 50)),
        }

    connection.send_result(msg["id"], {"entries": entries, "config": config})


async def _async_register_frontend(hass: HomeAssistant) -> None:
    if CARD_PATH.exists():
        try:
            await hass.http.async_register_static_paths(
                [StaticPathConfig(CARD_URL, str(CARD_PATH), False)]
            )
        except RuntimeError:
            _LOGGER.debug("Статический URL карточки уже зарегистрирован")

    lovelace = hass.data.get("lovelace")
    if not lovelace or getattr(lovelace, "resource_mode", None) != "storage":
        return

    resources = lovelace.resources
    try:
        await resources.async_get_info()
        resource_items = resources.async_items()
        existing = next(
            (item for item in resource_items if item.get("url", "").split("?")[0] == CARD_URL),
            None,
        )
        versioned_url = f"{CARD_URL}?v={CARD_VERSION}"
        if existing:
            if existing.get("url") != versioned_url:
                await resources.async_update_item(
                    existing["id"], {"res_type": "module", "url": versioned_url}
                )
        else:
            await resources.async_create_item(
                {"res_type": "module", "url": versioned_url}
            )
    except Exception:
        _LOGGER.exception(
            "Не удалось автоматически добавить ресурс карточки. "
            "Добавьте %s вручную в Settings → Dashboards → Resources.",
            CARD_URL,
        )


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    websocket_api.async_register_command(hass, websocket_get_history)
    await _async_register_frontend(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    await _async_register_frontend(hass)
    session = async_get_clientsession(hass)
    client = BelsClient(session)
    store = Store(hass, STORAGE_VERSION, f"{DOMAIN}_{entry.entry_id}_history")
    history = await store.async_load() or {"entries": []}

    async def submit(
        source: str = "manual",
        browser: dict | None = None,
        reading_date: str | None = None,
        overrides: dict | None = None,
    ):
        payload = {}
        response = {}
        http_status = 0
        try:
            options = entry.options
            round_to = int(options.get(CONF_ROUND_TO, 50))
            overrides = overrides or {}
            readings = {}
            fields = (
                ("day", CONF_DAY_ENTITY, "Общие (день)", False),
                ("night", CONF_NIGHT_ENTITY, "Ночь", True),
                ("peak", CONF_PEAK_ENTITY, "Пик", True),
            )
            for key, entity_option, label, optional in fields:
                if key in overrides:
                    readings[key] = _normalize_reading(
                        overrides[key], label, round_to, optional
                    )
                else:
                    readings[key] = _reading(
                        hass,
                        options.get(entity_option, "sensor.elektroenergiia" if key == "day" else ""),
                        round_to,
                        label,
                        optional,
                    )

            payload = build_payload(
                entry.data[CONF_ACCOUNT],
                entry.data.get(CONF_PHONE, ""),
                entry.data.get(CONF_EMAIL, ""),
                readings,
                browser,
                reading_date,
            )
            response, http_status = await client.submit(payload)
            status, comment = interpret_response(response, http_status)
        except Exception as err:
            _LOGGER.exception("Ошибка отправки показаний БЭЛС")
            response = {"transport_error": str(err)}
            status = "error"
            comment = str(err) if isinstance(err, ValueError) else f"Ошибка отправки: {err}"

        from datetime import datetime
        from zoneinfo import ZoneInfo

        item = {
            "timestamp": datetime.now(ZoneInfo("Europe/Moscow")).isoformat(),
            "source": source,
            "source_label": "Автоматически" if source == "automatic" else "Вручную",
            "status": status,
            "status_label": "Успешно" if status == "success" else "Ошибка",
            "comment": comment if status == "error" else "",
            "http_status": http_status,
            "form": payload,
            "response": response,
        }
        history["entries"].insert(0, item)
        history["entries"] = history["entries"][:HISTORY_LIMIT]
        await store.async_save(history)
        hass.bus.async_fire(
            f"{DOMAIN}_submission_finished",
            {"entries": history["entries"]},
        )
        return item

    async def handle_submit(call: ServiceCall):
        data = dict(call.data)
        reading_date = data.pop("date", None)
        overrides = {
            key: data.pop(key)
            for key in ("day", "night", "peak")
            if key in data
        }
        await submit("manual", data, reading_date, overrides)

    hass.services.async_register(
        DOMAIN,
        "submit_readings",
        handle_submit,
        schema=vol.Schema({
            vol.Optional("date"): str,
            vol.Optional("day"): vol.Any(str, int, float),
            vol.Optional("night"): vol.Any(str, int, float),
            vol.Optional("peak"): vol.Any(str, int, float),
            vol.Optional("screen_width"): vol.Any(str, int, float),
            vol.Optional("screen_height"): vol.Any(str, int, float),
            vol.Optional("viewport_width"): vol.Any(str, int, float),
            vol.Optional("viewport_height"): vol.Any(str, int, float),
            vol.Optional("local_locale"): str,
        }),
    )
    hass.data[DOMAIN][entry.entry_id] = {
        "client": client,
        "submit": submit,
        "store": store,
        "history": history,
    }

    if entry.options.get(CONF_AUTO_ENABLED, False):
        auto_day = int(entry.options.get(CONF_AUTO_DAY, 1))
        parts = str(entry.options.get(CONF_AUTO_TIME, "09:00:00")).split(":")
        auto_time = time(int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) > 2 else 0)

        async def scheduled(now):
            scheduled_day = min(auto_day, monthrange(now.year, now.month)[1])
            if now.day == scheduled_day:
                try:
                    await submit("automatic")
                except Exception:
                    _LOGGER.exception("Автоматическая отправка БЭЛС не выполнена")

        cancel = async_track_time_change(
            hass, scheduled, hour=auto_time.hour, minute=auto_time.minute, second=auto_time.second
        )
        hass.data[DOMAIN][entry.entry_id]["cancel_schedule"] = cancel

    entry.async_on_unload(entry.add_update_listener(async_reload_entry))
    return True


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = hass.data[DOMAIN].pop(entry.entry_id, {})
    if cancel := data.get("cancel_schedule"):
        cancel()
    if hass.services.has_service(DOMAIN, "submit_readings"):
        hass.services.async_remove(DOMAIN, "submit_readings")
    return True
