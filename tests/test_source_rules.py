from sync.source_rules import preferred_activity_source, resolve_metric_source


def test_preferred_activity_source_chooses_garmin_duplicate():
    chosen = preferred_activity_source(
        [
            {"id": "strava-1", "source": "strava", "distance_meters": 9990},
            {"id": "garmin-1", "source": "garmin-connect", "distance_meters": 10000},
        ]
    )

    assert chosen["id"] == "garmin-1"
    assert chosen["preferred_source"] == "garmin"


def test_resolve_metric_source_prefers_garmin_value():
    resolved = resolve_metric_source("distance_meters", 10000, 9990)

    assert resolved == {"metric": "distance_meters", "value": 10000, "source": "garmin"}
