"""Календарні межі перевіряються без мережі та фізичного обладнання."""
import unittest
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from pydantic import ValidationError

from app.schemas.schedule import ScheduleRun, ScheduleSpec
from app.services.schedule_calendar import civil_utc, first_overlap, run_on_date, upcoming


def spec(**changes):
    values = dict(name="Вечірній полив", timezone="Europe/Kyiv",
        start_date="2026-10-01", until_date="2026-10-01", start_time="19:00", stop_time="02:00",
        stop_day_offset=1, frequency_hz=50)
    return ScheduleSpec.model_validate({**values, **changes})


class CalendarTests(unittest.TestCase):
    def test_overnight_has_exact_utc_window(self):
        plan = run_on_date(spec(), date(2026, 10, 1))
        self.assertEqual(plan.starts_at.isoformat(), "2026-10-01T16:00:00+00:00")
        self.assertEqual(plan.stops_at.isoformat(), "2026-10-01T23:00:00+00:00")
        self.assertEqual(plan.steps[0].duration_seconds, 7 * 3600)

    def test_clock_changes_cover_window_without_extra_ramp_time(self):
        rule = spec(changes=[{"at": "21:00", "frequency_hz": 40}, {"at": "01:00", "day_offset": 1, "frequency_hz": 30}])
        plan = run_on_date(rule, rule.start_date)
        self.assertEqual([s.duration_seconds for s in plan.steps], [7200, 14400, 3600])
        self.assertEqual([s.frequency_hz for s in plan.steps], [50, 40, 30])

    def test_all_months_fifty_years_last_day(self):
        rule = spec(repeat="monthly", month_day=-1, until_date="2076-09-30")
        runs = upcoming(rule, datetime(2026, 10, 1, tzinfo=timezone.utc), limit=600)
        self.assertEqual(len(runs), 600)
        local_days = [run.starts_at.astimezone(ZoneInfo(rule.timezone)).date() for run in runs]
        self.assertIn(date(2028, 2, 29), local_days)
        self.assertIn(date(2027, 2, 28), local_days)
        self.assertEqual(local_days[-1], date(2076, 9, 30))

    def test_31st_skips_short_months(self):
        rule = spec(repeat="monthly", month_day=31, until_date="2027-03-31")
        runs = upcoming(rule, datetime(2026, 10, 1, tzinfo=timezone.utc), limit=10)
        self.assertEqual([x.starts_at.astimezone(ZoneInfo(rule.timezone)).month for x in runs], [10, 12, 1, 3])

    def test_leap_anniversary_skips_2100(self):
        rule = spec(start_date="2096-02-29", until_date="2104-03-01", repeat="yearly")
        runs = upcoming(rule, datetime(2096, 1, 1, tzinfo=timezone.utc), limit=5)
        self.assertEqual([x.starts_at.year for x in runs], [2096, 2104])

    def test_weekday_interval_season_exclusion(self):
        rule = spec(repeat="weekly", weekdays=[0, 2, 4], months=[10], until_date="2026-11-30", excluded_dates=["2026-10-02"])
        runs = upcoming(rule, datetime(2026, 10, 1, tzinfo=timezone.utc), limit=5)
        self.assertEqual([x.starts_at.day for x in runs], [5, 7, 9, 12, 14])
        interval = spec(repeat="interval", interval_days=3, until_date="2026-10-15")
        self.assertEqual([x.starts_at.day for x in upcoming(interval, datetime(2026, 10, 2, tzinfo=timezone.utc), limit=4)], [4, 7, 10, 13])

    def test_dst_gap_skips_and_fold_runs_once(self):
        spring = spec(timezone="America/New_York", start_date="2024-03-10", until_date="2024-03-11", repeat="daily", start_time="02:30", stop_time="04:00", stop_day_offset=0)
        runs = upcoming(spring, datetime(2024, 3, 10, tzinfo=timezone.utc), limit=2)
        self.assertEqual([x.starts_at.day for x in runs], [11])
        autumn = spec(timezone="America/New_York", start_date="2024-11-03", until_date="2024-11-03", start_time="01:30", stop_time="02:30", stop_day_offset=0)
        plan = run_on_date(autumn, autumn.start_date)
        self.assertEqual(plan.starts_at.hour, 5)
        self.assertEqual(plan.steps[0].duration_seconds, 7200)
        self.assertEqual(upcoming(autumn, plan.starts_at + timedelta(seconds=1)), [])

    def test_dst_missing_change_skips_entire_execution(self):
        rule = spec(timezone="America/New_York", start_date="2024-03-10", until_date="2024-03-10", start_time="01:00", stop_time="04:00", stop_day_offset=0,
            changes=[{"at": "02:30", "frequency_hz": 40}])
        self.assertIsNone(run_on_date(rule, rule.start_date))

    def test_year_boundary_and_future_timestamp(self):
        rule = spec(start_date="2075-12-31", until_date="2075-12-31")
        run = run_on_date(rule, rule.start_date)
        self.assertEqual(run.stops_at.astimezone(ZoneInfo(rule.timezone)).date(), date(2076, 1, 1))
        self.assertGreater(run.starts_at.timestamp(), 2**31)
        self.assertEqual(ScheduleRun.model_validate_json(run.model_dump_json()), run)

    def test_overlap_includes_previous_day_and_allows_adjacent_runs(self):
        a = spec()
        b = spec(start_date="2026-10-02", until_date="2026-10-02", start_time="01:30", stop_time="03:00", stop_day_offset=0)
        after = datetime(2026, 10, 1, 22, tzinfo=timezone.utc)
        self.assertTrue(first_overlap(a, b, after))
        b.start_time = b.start_time.replace(hour=2, minute=0)
        self.assertFalse(first_overlap(a, b, after))

    def test_impossible_fields_fail_closed(self):
        for change in [{"start_date": "2027-02-29"}, {"timezone": "../etc/passwd"}, {"timezone": "Moon/Base"},
                       {"frequency_hz": True}, {"frequency_hz": 25.001}, {"weekdays": [True], "repeat": "weekly"},
                       {"weekdays": [], "repeat": "weekly"}, {"months": [1, 1]}, {"month_day": 0},
                       {"stop_day_offset": 0}, {"changes": [{"at": "18:00", "frequency_hz": 40}]},
                       {"until_date": "2080-01-01", "repeat": "daily"}]:
            with self.subTest(change=change), self.assertRaises(ValidationError): spec(**change)

    def test_payload_requires_exact_end_and_rejects_extra_fields(self):
        raw = run_on_date(spec(), date(2026, 10, 1)).model_dump(mode="json")
        for key, value in [("stops_at", "2026-10-02T00:00:00Z"), ("starts_at", "2026-10-01T16:00:00"), ("unknown", 1)]:
            with self.subTest(key=key), self.assertRaises(ValidationError): ScheduleRun.model_validate({**raw, key: value})

    def test_date_after_season_has_no_catchup(self):
        self.assertEqual(upcoming(spec(), datetime(2026, 10, 2, tzinfo=timezone.utc)), [])


if __name__ == "__main__":
    unittest.main()
