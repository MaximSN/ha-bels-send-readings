from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import aiohttp

from .const import API_URL, SITE_URL


class BelsClient:
    def __init__(self, session: aiohttp.ClientSession) -> None:
        self._session = session

    async def submit(self, payload: dict) -> tuple[dict, int]:
        async with self._session.get(SITE_URL, timeout=aiohttp.ClientTimeout(total=30)) as response:
            response.raise_for_status()

        form = aiohttp.FormData()
        form.add_field("json", json.dumps(payload, ensure_ascii=False, separators=(",", ":")))

        async with self._session.post(
            API_URL,
            data=form,
            headers={"Referer": SITE_URL, "Origin": "https://www.belssb.ru"},
            timeout=aiohttp.ClientTimeout(total=45),
        ) as response:
            status = response.status
            body = await response.text()
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = {"raw": body}
            return parsed, status


def build_payload(
    account: str,
    phone: str,
    email: str,
    readings: dict[str, int | float | None],
) -> dict:
    payload = {
        "pattern-licevoy-schet": account,
        "date-data": datetime.now(ZoneInfo("Europe/Moscow")).strftime("%d.%m.%Y"),
        "email-emayl": email,
        "phone-telefon": phone,
    }
    field_map = {
        "day": "pattern-pokazaniya-obshchie-den",
        "night": "pattern-pokazaniya-noch",
        "peak": "pattern-pokazaniya-pik",
    }
    for tariff, field in field_map.items():
        value = readings.get(tariff)
        if value is not None:
            payload[field] = str(value)
    return payload


def interpret_response(data: dict, http_status: int) -> tuple[str, str]:
    answer = data.get("answer") if isinstance(data, dict) else None
    if 200 <= http_status < 300 and isinstance(answer, dict) and answer.get("result") is True:
        return "success", "Показания успешно приняты"

    comments: list[str] = []
    wrong = answer.get("wrong") if isinstance(answer, dict) else None
    labels = {
        "email-emayl": "Неправильно указан e-mail",
        "phone-telefon": "Неправильно указан телефон",
    }
    if isinstance(wrong, dict):
        for key, value in wrong.items():
            comments.append(labels.get(key, f"{key}: {value}"))
    errors = data.get("errors") if isinstance(data, dict) else None
    if errors:
        comments.append(f"Ошибка БЭЛС: {errors}")
    if not 200 <= http_status < 300:
        comments.append(f"HTTP {http_status}")
    if not comments:
        comments.append("Сервер не подтвердил приём показаний")
    return "error", "; ".join(comments)
