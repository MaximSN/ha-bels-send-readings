from __future__ import annotations

import logging
import math
from datetime import time
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .client import BelsClient, build_payload, interpret_response
from .const import (
    DOMAIN, PLATFORMS, STORAGE_VERSION, HISTORY_LIMIT,
    CONF_ACCOUNT, CONF_PHONE, CONF_EMAIL,
    CONF_DAY_ENTITY, CONF_NIGHT_ENTITY, CONF_PEAK_ENTITY,
    CONF_ROUND_TO, CONF_AUTO_ENABLED, CONF_AUTO_DAY, CONF_AUTO_TIME,
)

_LOGGER = logging.getLogger(__name__)
CARD_PATH = Path(__file__).parent / "www" / "bels-panel.js"


def _reading(hass: HomeAssistant, entity_id: str | None, round_to: int):
    if not entity_id:
        return None
    state = hass.states.get(entity_id)
    if state is None:
        raise ValueError(f"Сущность {entity_id} не найдена")
    try:
        value = float(state.state)
    except (TypeError, ValueError):
        raise ValueError(f"Сущность {entity_id} не содержит числовое значение")
    if not math.isfinite(value):
        raise ValueError(f"Сущность {entity_id} содержит некорректное значение")
    if round_to > 0:
        value = math.ceil(value / round_to) * round_to
    return int(value) if value.is_integer() else value


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    session = async_get_clientsession(hass)
    client = BelsClient(session)
    store = Store(hass, STORAGE_VERSION, f"{DOMAIN}_{entry.entry_id}_history")
    history = await store.async_load() or {"entries": []}

    async def refresh_data():
        return {
            "entries": history.get("entries", []),
            "last_status": history.get("entries", [{}])[0].get("status", "unknown") if history.get("entries") else "unknown",
        }

    coordinator = DataUpdateCoordinator(
        hass, _LOGGER, name="БЭЛС", update_method=refresh_data
    )
    await coordinator.async_config_entry_first_refresh()

    async def submit(
        source: str = "manual",
        browser: dict | None = None,
        reading_date: str | None = None,
    ):
        options = entry.options
        round_to = int(options.get(CONF_ROUND_TO, 50))
        readings = {
            "day": _reading(hass, options.get(CONF_DAY_ENTITY), round_to),
            "night": _reading(hass, options.get(CONF_NIGHT_ENTITY), round_to),
            "peak": _reading(hass, options.get(CONF_PEAK_ENTITY), round_to),
        }
        payload = build_payload(
            entry.data[CONF_ACCOUNT],
            entry.data[CONF_PHONE],
            entry.data[CONF_EMAIL],
            readings,
            browser,
            reading_date,
        )
        try:
            response, http_status = await client.submit(payload)
            status, comment = interpret_response(response, http_status)
        except Exception as err:
            _LOGGER.exception("Ошибка отправки показаний БЭЛС")
            response = {"transport_error": str(err)}
            http_status = 0
            status = "error"
            comment = f"Ошибка соединения: {err}"

        from datetime import datetime
        from zoneinfo import ZoneInfo

        item = {
            "timestamp": datetime.now(ZoneInfo("Europe/Moscow")).isoformat(),
            "source": source,
            "source_label": "Автоматически" if source == "automatic" else "Вручную",
            "status": status,
            "status_label": "Успешно" if status == "success" else "Ошибка",
            "comment": comment,
            "http_status": http_status,
            "form": payload,
            "response": response,
        }
        history["entries"].insert(0, item)
        history["entries"] = history["entries"][:HISTORY_LIMIT]
        await store.async_save(history)
        coordinator.async_set_updated_data(await refresh_data())
        return item

    async def handle_submit(call: ServiceCall):
        browser = dict(call.data)
        reading_date = browser.pop("date", None)
        item = await submit("manual", browser, reading_date)
        hass.bus.async_fire(f"{DOMAIN}_submission_finished", item)

    hass.services.async_register(DOMAIN, "submit_readings", handle_submit)
    hass.data[DOMAIN][entry.entry_id] = {
        "client": client,
        "coordinator": coordinator,
        "submit": submit,
        "store": store,
    }

    if CARD_PATH.exists():
        try:
            hass.http.register_static_path("/bels/bels-panel.js", str(CARD_PATH), cache_headers=True)
        except (AttributeError, RuntimeError):
            _LOGGER.debug("Не удалось зарегистрировать URL карточки автоматически")

    if entry.options.get(CONF_AUTO_ENABLED, False):
        auto_day = int(entry.options.get(CONF_AUTO_DAY, 1))
        parts = str(entry.options.get(CONF_AUTO_TIME, "09:00:00")).split(":")
        auto_time = time(int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) > 2 else 0)

        async def scheduled(now):
            if now.day == auto_day:
                try:
                    item = await submit("automatic")
                    hass.bus.async_fire(f"{DOMAIN}_submission_finished", item)
                except Exception:
                    _LOGGER.exception("Автоматическая отправка БЭЛС не выполнена")

        cancel = async_track_time_change(
            hass, scheduled, hour=auto_time.hour, minute=auto_time.minute, second=auto_time.second
        )
        hass.data[DOMAIN][entry.entry_id]["cancel_schedule"] = cancel

    entry.async_on_unload(entry.add_update_listener(async_reload_entry))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    data = hass.data[DOMAIN].pop(entry.entry_id, {})
    if cancel := data.get("cancel_schedule"):
        cancel()
    if hass.services.has_service(DOMAIN, "submit_readings"):
        hass.services.async_remove(DOMAIN, "submit_readings")
    return unload_ok
