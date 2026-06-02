"""Tinybird sink for Whoop analytics records."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def get_whoop_sport_name(sport_id: int) -> str:
    sport_map = {
        0: "Activity", 1: "Running", 2: "Cycling", 3: "Basketball",
        4: "Football", 5: "Soccer", 6: "Swimming", 7: "Gym",
        8: "Weightlifting", 9: "CrossFit", 10: "Yoga", 11: "Tennis",
        12: "Golf", 13: "Hiking", 14: "Rowing", 15: "Climbing",
    }
    return sport_map.get(sport_id, f"Sport {sport_id}")


async def ingest_whoop_tinybird(
    tinybird: Any,
    *,
    user_id: str,
    whoop_connection_id: str,
    recovery_data: Optional[Dict[str, Any]] = None,
    sleep_data: Optional[Dict[str, Any]] = None,
    workout_data: Optional[Dict[str, Any]] = None,
    cycle_data: Optional[Dict[str, Any]] = None,
) -> None:
    del cycle_data

    if recovery_data and recovery_data.get("records"):
        recovery_events = []
        for record in recovery_data["records"]:
            score = record.get("score", {})
            whoop_cycle_id = str(record.get("cycle_id", ""))
            recovery_events.append({
                "id": f"whoop_recovery_{whoop_cycle_id}",
                "user_id": user_id,
                "whoop_connection_id": whoop_connection_id,
                "cycle_id": whoop_cycle_id,
                "date": record.get("created_at", "")[:10],
                "recovery_score": score.get("recovery_score", 0),
                "hrv_rmssd": score.get("hrv_rmssd_milli", 0),
                "resting_heart_rate": score.get("resting_heart_rate", 0),
                "spo2_percentage": score.get("spo2_percentage", 0),
                "skin_temp_celsius": score.get("skin_temp_celsius", 0),
                "created_at": datetime.utcnow().isoformat(),
            })

        if recovery_events:
            await tinybird.ingest_events("whoop_recovery_data", recovery_events)
            logger.info("Ingested %s Whoop recovery records to Tinybird", len(recovery_events))

    if sleep_data and sleep_data.get("records"):
        sleep_events = []
        for record in sleep_data["records"]:
            score = record.get("score", {})
            stage_summary = score.get("stage_summary", {})
            whoop_sleep_id = str(record.get("id", ""))
            sleep_events.append({
                "id": f"whoop_sleep_{whoop_sleep_id}",
                "user_id": user_id,
                "whoop_connection_id": whoop_connection_id,
                "sleep_id": whoop_sleep_id,
                "date": record.get("start", "")[:10],
                "sleep_performance_percentage": score.get("sleep_performance_percentage", 0),
                "total_sleep_duration_minutes": stage_summary.get("total_in_bed_time_milli", 0) // 60000,
                "sleep_efficiency_percentage": score.get("sleep_efficiency_percentage", 0),
                "rem_sleep_minutes": stage_summary.get("total_rem_sleep_time_milli", 0) // 60000,
                "slow_wave_sleep_minutes": stage_summary.get("total_slow_wave_sleep_time_milli", 0) // 60000,
                "light_sleep_minutes": stage_summary.get("total_light_sleep_time_milli", 0) // 60000,
                "awake_minutes": stage_summary.get("total_awake_time_milli", 0) // 60000,
                "sleep_onset": record.get("start", ""),
                "sleep_end": record.get("end", ""),
                "created_at": datetime.utcnow().isoformat(),
            })

        if sleep_events:
            await tinybird.ingest_events("whoop_sleep_data", sleep_events)
            logger.info("Ingested %s Whoop sleep records to Tinybird", len(sleep_events))

    if workout_data and workout_data.get("records"):
        workout_events = []
        for record in workout_data["records"]:
            score = record.get("score", {})
            start = datetime.fromisoformat(record.get("start", "").replace("Z", "+00:00"))
            end = datetime.fromisoformat(record.get("end", "").replace("Z", "+00:00"))
            whoop_workout_id = str(record.get("id", ""))
            workout_events.append({
                "id": f"whoop_workout_{whoop_workout_id}",
                "user_id": user_id,
                "whoop_connection_id": whoop_connection_id,
                "workout_id": whoop_workout_id,
                "date": record.get("start", "")[:10],
                "strain_score": score.get("strain", 0),
                "activity_name": get_whoop_sport_name(record.get("sport_id", 0)),
                "duration_minutes": int((end - start).total_seconds() / 60),
                "average_heart_rate": score.get("average_heart_rate", 0),
                "max_heart_rate": score.get("max_heart_rate", 0),
                "kilojoules": score.get("kilojoule", 0),
                "distance_meters": score.get("distance_meter", 0),
                "started_at": record.get("start", ""),
                "ended_at": record.get("end", ""),
                "created_at": datetime.utcnow().isoformat(),
            })

        if workout_events:
            await tinybird.ingest_events("whoop_workout_data", workout_events)
            logger.info("Ingested %s Whoop workout records to Tinybird", len(workout_events))
