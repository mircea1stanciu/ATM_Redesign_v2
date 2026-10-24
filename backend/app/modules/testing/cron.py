"""Five-field cron expressions (minute hour day-of-month month day-of-week) for suite schedules.

Supports `*`, numbers, ranges `a-b`, lists `a,b` and steps `*/n` / `a-b/n`. Day of week: 0-6 (Sunday = 0; 7 is
Sunday too). As in cron, when both day fields are restricted, a day matches if either does.
"""
from dataclasses import dataclass
from datetime import datetime

_LIMITS = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))
_NAMES = ("minute", "hour", "day of month", "month", "day of week")


class CronError(ValueError):
    pass


def _field(text: str, index: int) -> frozenset[int]:
    low, high = _LIMITS[index]
    values: set[int] = set()
    for part in text.split(","):
        step = 1
        if "/" in part:
            part, step_text = part.split("/", 1)
            if not step_text.isdigit() or int(step_text) < 1:
                raise CronError(f"Invalid step in the {_NAMES[index]} field: '{step_text}'.")
            step = int(step_text)
        if part == "*":
            start, end = low, high
        elif "-" in part:
            a, b = part.split("-", 1)
            if not (a.isdigit() and b.isdigit()):
                raise CronError(f"Invalid range in the {_NAMES[index]} field: '{part}'.")
            start, end = int(a), int(b)
        elif part.isdigit():
            start = end = int(part)
            if step > 1:
                end = high
        else:
            raise CronError(f"Invalid value in the {_NAMES[index]} field: '{part}'.")
        if start < low or end > high or start > end:
            raise CronError(f"The {_NAMES[index]} field must be between {low} and {high}.")
        values.update(range(start, end + 1, step))
    if index == 4 and 7 in values:
        values = (values - {7}) | {0}
    return frozenset(values)


@dataclass(frozen=True)
class Cron:
    minutes: frozenset[int]
    hours: frozenset[int]
    days: frozenset[int]
    months: frozenset[int]
    weekdays: frozenset[int]
    days_restricted: bool
    weekdays_restricted: bool

    def matches(self, moment: datetime) -> bool:
        if moment.minute not in self.minutes or moment.hour not in self.hours or moment.month not in self.months:
            return False
        weekday = (moment.weekday() + 1) % 7  # Python: Monday = 0; cron: Sunday = 0
        day_ok, weekday_ok = moment.day in self.days, weekday in self.weekdays
        if self.days_restricted and self.weekdays_restricted:
            return day_ok or weekday_ok
        return day_ok and weekday_ok


def parse(expression: str) -> Cron:
    fields = expression.split()
    if len(fields) != 5:
        raise CronError("A schedule has five fields: minute hour day-of-month month day-of-week, e.g. '0 6 * * 1-5'.")
    minutes, hours, days, months, weekdays = (_field(text, index) for index, text in enumerate(fields))
    return Cron(minutes, hours, days, months, weekdays, fields[2] != "*", fields[4] != "*")
