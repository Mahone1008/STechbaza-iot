"""Календар без cron-процесу на кожен об'єкт; лише стандартні datetime/zoneinfo."""
import calendar
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.schemas.program import ProgramStep
from app.schemas.schedule import ScheduleRun, ScheduleSpec

START_GRACE_SECONDS = 30


def civil_utc(day: date, at, zone: ZoneInfo) -> datetime | None:
    naive = datetime.combine(day, at)
    # Під час повторної години — лише перший момент; неіснуючий час пропускаємо.
    local = naive.replace(tzinfo=zone, fold=0)
    utc = local.astimezone(timezone.utc)
    return utc if utc.astimezone(zone).replace(tzinfo=None) == naive else None


def matches(spec: ScheduleSpec, day: date) -> bool:
    if day.month not in spec.months or day in spec.excluded_dates:
        return False
    match spec.repeat:
        case "once": return day == spec.start_date
        case "weekly": return day.weekday() in spec.weekdays
        case "interval": return (day - spec.start_date).days % spec.interval_days == 0
        case "monthly": return day.day == (calendar.monthrange(day.year, day.month)[1] if spec.month_day == -1 else spec.month_day)
        case "yearly": return (day.month, day.day) == (spec.start_date.month, spec.start_date.day)
        case _: return True


def run_on_date(spec: ScheduleSpec, day: date) -> ScheduleRun | None:
    if not spec.start_date <= day <= spec.until_date or not matches(spec, day):
        return None
    zone = ZoneInfo(spec.timezone)
    points = [civil_utc(day, spec.start_time, zone)]
    frequencies = [spec.frequency_hz]
    for change in spec.changes:
        points.append(civil_utc(day + timedelta(days=change.day_offset), change.at, zone))
        frequencies.append(change.frequency_hz)
    points.append(civil_utc(day + timedelta(days=spec.stop_day_offset), spec.stop_time, zone))
    if any(point is None for point in points):
        return None
    durations = [int((end - start).total_seconds()) for start, end in zip(points, points[1:])]
    # DST може змінити реальну тривалість або порядок; такий запуск не переінакшуємо.
    if any(duration < 10 for duration in durations) or sum(durations) > 86400:
        return None
    return ScheduleRun(version=1, starts_at=points[0], stops_at=points[-1], steps=[
        ProgramStep(frequency_hz=hz, duration_seconds=duration) for hz, duration in zip(frequencies, durations)
    ])


def upcoming(spec: ScheduleSpec, after: datetime, *, limit: int = 1, until: datetime | None = None) -> list[ScheduleRun]:
    if after.utcoffset() is None:
        raise ValueError("UTC reference required")
    zone = ZoneInfo(spec.timezone)
    day = max(spec.start_date, after.astimezone(zone).date())
    last = min(spec.until_date, until.astimezone(zone).date()) if until else spec.until_date
    if spec.repeat == "once":
        last = min(last, spec.start_date)
    runs = []
    while day <= last and len(runs) < limit:
        run = run_on_date(spec, day)
        if run and run.starts_at >= after and (until is None or run.starts_at < until):
            runs.append(run)
        day += timedelta(days=1)
    return runs


def first_overlap(left: ScheduleSpec, right: ScheduleSpec, after: datetime, *, days: int = 366) -> bool:
    # Не більше одного запуску на календарний день; обмежене preview не сканує 50 років.
    end = after + timedelta(days=days)
    a = upcoming(left, after - timedelta(days=1), limit=days + 3, until=end)
    b = upcoming(right, after - timedelta(days=1), limit=days + 3, until=end)
    i = j = 0
    while i < len(a) and j < len(b):
        if max(a[i].starts_at, b[j].starts_at, after) < min(a[i].stops_at, b[j].stops_at):
            return True
        if a[i].stops_at <= b[j].stops_at: i += 1
        else: j += 1
    return False
