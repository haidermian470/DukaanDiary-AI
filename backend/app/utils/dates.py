"""Date and period helpers.

Business dates are calendar dates in the shop's timezone (Asia/Karachi).
"Today" therefore means today in Pakistan, even though the server may run in UTC.
Weeks run Monday to Sunday.
Timestamps (created_at and similar) are stored in UTC.
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from app.core.config import get_settings

PeriodName = Literal[
    "today", "yesterday", "this_week", "last_week", "this_month", "last_month",
    "last_7_days", "last_30_days", "this_year", "all_time", "custom",
]

PERIOD_LABELS: dict[str, str] = {
    "today": "Today", "yesterday": "Yesterday", "this_week": "This week",
    "last_week": "Last week", "this_month": "This month", "last_month": "Last month",
    "last_7_days": "Last 7 days", "last_30_days": "Last 30 days",
    "this_year": "This year", "all_time": "All time", "custom": "Selected dates",
}

# Used as the start of "all time" so SQL filters stay simple.
EPOCH = date(2000, 1, 1)


def business_tz() -> ZoneInfo:
    return ZoneInfo(get_settings().business_timezone)


def today_local() -> date:
    return datetime.now(business_tz()).date()


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc(value: datetime | None) -> datetime | None:
    """Treat naive datetimes as UTC and convert aware ones to UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@dataclass(frozen=True)
class Period:
    name: str
    start: date  # inclusive
    end: date    # inclusive

    @property
    def label(self) -> str:
        return PERIOD_LABELS.get(self.name, self.name)

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def as_dict(self) -> dict:
        return {"name": self.name, "label": self.label,
                "date_from": self.start.isoformat(), "date_to": self.end.isoformat()}


def resolve_period(name: str = "this_month", date_from: date | None = None,
                   date_to: date | None = None, today: date | None = None) -> Period:
    """Turn a period name (or custom dates) into concrete inclusive start/end dates."""
    t = today or today_local()
    if date_from or date_to or name == "custom":
        start = date_from or EPOCH
        end = date_to or t
        if start > end:
            raise ValueError("date_from must be on or before date_to.")
        return Period("custom", start, end)

    week_start = t - timedelta(days=t.weekday())
    month_start = t.replace(day=1)
    if name == "today":
        return Period(name, t, t)
    if name == "yesterday":
        y = t - timedelta(days=1)
        return Period(name, y, y)
    if name == "this_week":
        return Period(name, week_start, t)
    if name == "last_week":
        return Period(name, week_start - timedelta(days=7), week_start - timedelta(days=1))
    if name == "this_month":
        return Period(name, month_start, t)
    if name == "last_month":
        last_end = month_start - timedelta(days=1)
        return Period(name, last_end.replace(day=1), last_end)
    if name == "last_7_days":
        return Period(name, t - timedelta(days=6), t)
    if name == "last_30_days":
        return Period(name, t - timedelta(days=29), t)
    if name == "this_year":
        return Period(name, t.replace(month=1, day=1), t)
    if name == "all_time":
        return Period(name, EPOCH, t)
    raise ValueError(f"Unknown period '{name}'.")


def previous_period(period: Period) -> Period:
    """The period of equal length immediately before `period` (used for comparisons)."""
    if period.name == "this_week":
        return Period("last_week", period.start - timedelta(days=7), period.start - timedelta(days=1))
    if period.name == "this_month":
        last_end = period.start - timedelta(days=1)
        return Period("last_month", last_end.replace(day=1), last_end)
    length = period.days
    end = period.start - timedelta(days=1)
    return Period("custom", end - timedelta(days=length - 1), end)
