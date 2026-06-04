from datetime import datetime
from zoneinfo import ZoneInfo

from app.automation_worker import compute_next_fire_epoch


def test_compute_next_fire_uses_rule_timezone():
    now = datetime(2026, 6, 3, 17, 20, tzinfo=ZoneInfo("UTC")).timestamp()
    rule = {
        "schedule": {
            "frequency": "daily",
            "times": ["19:00"],
            "timezone": "Africa/Lagos",
        }
    }

    expected = datetime(2026, 6, 3, 19, 0, tzinfo=ZoneInfo("Africa/Lagos")).timestamp()
    assert compute_next_fire_epoch(rule, now) == expected


def test_compute_next_fire_skips_current_fire_once_reached():
    now = datetime(2026, 6, 3, 18, 0, tzinfo=ZoneInfo("UTC")).timestamp()
    rule = {
        "schedule": {
            "frequency": "daily",
            "times": ["19:00"],
            "timezone": "Africa/Lagos",
        }
    }

    expected = datetime(2026, 6, 4, 19, 0, tzinfo=ZoneInfo("Africa/Lagos")).timestamp()
    assert compute_next_fire_epoch(rule, now) == expected
