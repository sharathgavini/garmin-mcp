from __future__ import annotations

"""Small retry/backoff helper for Garmin API calls."""

import time
from typing import Any, Callable


def retry_call(
    func: Callable[..., Any],
    *args: Any,
    attempts: int = 3,
    base_sleep_seconds: float = 0.5,
    max_sleep_seconds: float = 8,
    sleeper: Callable[[float], None] = time.sleep,
) -> Any:
    last_error: Exception | None = None
    for index in range(max(1, attempts)):
        try:
            return func(*args)
        except Exception as exc:
            last_error = exc
            if index >= attempts - 1:
                break
            sleeper(min(max_sleep_seconds, base_sleep_seconds * (2 ** index)))
    if last_error:
        raise last_error
    return None
