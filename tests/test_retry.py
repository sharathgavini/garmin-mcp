import pytest

from sync.retry import retry_call


def test_retry_backoff_recovers_from_transient_errors():
    calls = {"count": 0}
    sleeps = []

    def flaky():
        calls["count"] += 1
        if calls["count"] < 3:
            raise RuntimeError("temporary")
        return "ok"

    assert retry_call(flaky, attempts=3, base_sleep_seconds=1, sleeper=sleeps.append) == "ok"
    assert sleeps == [1, 2]


def test_retry_backoff_raises_after_attempts():
    sleeps = []

    def fail():
        raise RuntimeError("nope")

    with pytest.raises(RuntimeError):
        retry_call(fail, attempts=2, base_sleep_seconds=0.5, sleeper=sleeps.append)
    assert sleeps == [0.5]
