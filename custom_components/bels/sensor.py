from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
    async_add_entities([
        BelsHistorySensor(coordinator, entry),
        BelsLastSubmissionSensor(coordinator, entry),
    ])


class BelsBaseSensor(CoordinatorEntity, SensorEntity):
    _attr_has_entity_name = False

    def __init__(self, coordinator, entry: ConfigEntry, suffix: str, name: str):
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_{suffix}"
        self._attr_name = name


class BelsHistorySensor(BelsBaseSensor):
    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, "history", "BELS History")
        self.entity_id = "sensor.bels_history"

    @property
    def native_value(self):
        return len(self.coordinator.data.get("entries", []))

    @property
    def extra_state_attributes(self):
        return {"entries": self.coordinator.data.get("entries", [])}


class BelsLastSubmissionSensor(BelsBaseSensor):
    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, "last_submission", "BELS Last Submission")
        self.entity_id = "sensor.bels_last_submission"

    @property
    def native_value(self):
        entries = self.coordinator.data.get("entries", [])
        return entries[0].get("status", "unknown") if entries else "unknown"

    @property
    def extra_state_attributes(self):
        entries = self.coordinator.data.get("entries", [])
        if not entries:
            return {}
        item = entries[0]
        return {
            "timestamp": item.get("timestamp"),
            "source": item.get("source"),
            "comment": item.get("comment"),
            "http_status": item.get("http_status"),
        }
