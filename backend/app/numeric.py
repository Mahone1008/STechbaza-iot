"""Однакова безпечна нормалізація для rule engine та read model."""

import math


def finite_number(value: object) -> float | None:
    # bool — підклас int, але не числове показання датчика.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except (ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None
