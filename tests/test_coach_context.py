from sync.coach_context import generate_coach_context


# Coach context should stay compact while preserving recent training/recovery signals.
def test_coach_context_is_compact_and_aggregates_activity_totals():
    context = generate_coach_context(
        daily=[{"date": "2026-06-13", "acute_load": 410, "training_readiness": 68}],
        sleep=[{"date": "2026-06-13", "duration_minutes": 397, "score": 76}],
        hrv=[{"date": "2026-06-13", "status": "balanced", "overnight_avg": 55}],
        stress=[{"date": "2026-06-13", "avg_stress": 36}],
        body_battery=[{"date": "2026-06-13", "morning": 78, "evening": 34}],
        activities=[
            {"id": "a1", "type": "running", "date": "2026-06-13", "distance_meters": 5000, "duration_seconds": 1800},
            {"id": "a2", "type": "walking", "date": "2026-06-13", "distance_meters": 1000, "duration_seconds": 900},
        ],
    )

    assert context["recent_activity_counts"] == {"running": 1, "walking": 1}
    assert context["activity_totals"]["distance_meters"] == 6000
    assert "sleep_trend" in context
    assert "raw" not in context
