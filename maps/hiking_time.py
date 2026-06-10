from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class HikingTimeEstimate:
    moving_hours: float
    ascent_hours: float
    descent_hours: float
    horizontal_hours: float
    break_hours: float
    recommended_hours: float


def estimate_dav_hiking_time(
    *,
    distance_meters: float,
    ascent_meters: float = 0.0,
    descent_meters: float = 0.0,
    ascent_rate_mph: float = 300.0,
    descent_rate_mph: float = 500.0,
    horizontal_speed_kph: float = 4.0,
    break_minutes_per_hour: float = 5.0,
) -> HikingTimeEstimate:
    """
    Estimate hiking time using the common DAV / DIN-style rule of thumb.

    Core rule:
    - uphill time = ascent / ascent_rate
    - downhill time = descent / descent_rate
    - horizontal time = distance / horizontal_speed
    - halve the smaller vertical time and add it to the larger vertical time
      plus horizontal time

    The break buffer is exposed separately so product surfaces can choose
    whether to show pure moving time or a safer planning time.
    """

    horizontal_hours = max(distance_meters, 0.0) / 1000 / horizontal_speed_kph
    ascent_hours = max(ascent_meters, 0.0) / ascent_rate_mph
    descent_hours = max(descent_meters, 0.0) / descent_rate_mph

    smaller_vertical = min(ascent_hours, descent_hours)
    larger_vertical = max(ascent_hours, descent_hours)
    moving_hours = horizontal_hours + larger_vertical + (smaller_vertical / 2)
    break_hours = moving_hours * (break_minutes_per_hour / 60)

    return HikingTimeEstimate(
        moving_hours=moving_hours,
        ascent_hours=ascent_hours,
        descent_hours=descent_hours,
        horizontal_hours=horizontal_hours,
        break_hours=break_hours,
        recommended_hours=moving_hours + break_hours,
    )
