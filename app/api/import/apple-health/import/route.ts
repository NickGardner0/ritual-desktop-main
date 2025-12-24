import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

// Metric type mapping to habit defaults
const METRIC_CONFIG: Record<string, { habitName: string; unit: string; icon: string; metricType: string }> = {
  HKQuantityTypeIdentifierStepCount: {
    habitName: "Steps",
    unit: "steps",
    icon: "footprints",
    metricType: "steps",
  },
  HKQuantityTypeIdentifierHeartRate: {
    habitName: "Heart Rate",
    unit: "BPM",
    icon: "heart",
    metricType: "hr",
  },
  HKQuantityTypeIdentifierActiveEnergyBurned: {
    habitName: "Active Calories",
    unit: "kcal",
    icon: "flame",
    metricType: "active_energy",
  },
  HKQuantityTypeIdentifierBasalEnergyBurned: {
    habitName: "Resting Calories",
    unit: "kcal",
    icon: "flame",
    metricType: "basal_energy",
  },
  HKQuantityTypeIdentifierDistanceWalkingRunning: {
    habitName: "Walking Distance",
    unit: "miles",
    icon: "map-pin",
    metricType: "distance",
  },
  HKQuantityTypeIdentifierFlightsClimbed: {
    habitName: "Flights Climbed",
    unit: "floors",
    icon: "arrow-up",
    metricType: "flights_climbed",
  },
  HKQuantityTypeIdentifierAppleExerciseTime: {
    habitName: "Exercise Time",
    unit: "minutes",
    icon: "timer",
    metricType: "exercise_time",
  },
  HKQuantityTypeIdentifierAppleStandTime: {
    habitName: "Stand Time",
    unit: "minutes",
    icon: "user",
    metricType: "stand_time",
  },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: {
    habitName: "HRV",
    unit: "ms",
    icon: "activity",
    metricType: "hrv",
  },
  HKQuantityTypeIdentifierRestingHeartRate: {
    habitName: "Resting Heart Rate",
    unit: "BPM",
    icon: "heart",
    metricType: "resting_hr",
  },
  HKQuantityTypeIdentifierOxygenSaturation: {
    habitName: "Blood Oxygen",
    unit: "%",
    icon: "droplet",
    metricType: "oxygen_saturation",
  },
  HKQuantityTypeIdentifierRespiratoryRate: {
    habitName: "Respiratory Rate",
    unit: "breaths/min",
    icon: "wind",
    metricType: "respiratory_rate",
  },
  HKCategoryTypeIdentifierSleepAnalysis: {
    habitName: "Sleep",
    unit: "hours",
    icon: "moon",
    metricType: "sleep_session",
  },
  HKCategoryTypeIdentifierMindfulSession: {
    habitName: "Mindfulness",
    unit: "minutes",
    icon: "brain",
    metricType: "mindful_minutes",
  },
};

// Unit conversions for Apple Health units
function convertValue(value: number, appleUnit: string, targetUnit: string): number {
  // Distance conversions
  if (appleUnit === "mi" && targetUnit === "miles") return value;
  if (appleUnit === "km" && targetUnit === "miles") return value * 0.621371;
  if (appleUnit === "m" && targetUnit === "miles") return value * 0.000621371;
  
  // Energy conversions
  if (appleUnit === "kcal" && targetUnit === "kcal") return value;
  if (appleUnit === "Cal" && targetUnit === "kcal") return value; // Cal = kcal in Apple Health
  
  // Time conversions
  if (appleUnit === "min" && targetUnit === "minutes") return value;
  if (appleUnit === "hr" && targetUnit === "hours") return value;
  if (appleUnit === "s" && targetUnit === "minutes") return value / 60;
  if (appleUnit === "s" && targetUnit === "hours") return value / 3600;
  
  // Oxygen saturation (stored as fraction, display as percentage)
  if (targetUnit === "%" && value <= 1) return value * 100;
  
  return value;
}

// Aggregate records by day for certain metrics
function aggregateByDay(
  records: any[],
  metricType: string
): Map<string, { sum: number; count: number; min: number; max: number }> {
  const dailyData = new Map<string, { sum: number; count: number; min: number; max: number }>();

  for (const record of records) {
    const date = new Date(record["@_startDate"]).toISOString().split("T")[0];
    const value = parseFloat(record["@_value"]) || 0;

    const existing = dailyData.get(date);
    if (existing) {
      existing.sum += value;
      existing.count++;
      existing.min = Math.min(existing.min, value);
      existing.max = Math.max(existing.max, value);
    } else {
      dailyData.set(date, { sum: value, count: 1, min: value, max: value });
    }
  }

  return dailyData;
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the uploaded file and options
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const metricsJson = formData.get("metrics") as string;
    const startDateStr = formData.get("startDate") as string | null;
    const endDateStr = formData.get("endDate") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!metricsJson) {
      return NextResponse.json({ error: "No metrics selected" }, { status: 400 });
    }

    const selectedMetrics = new Set<string>(JSON.parse(metricsJson));
    const startDate = startDateStr ? new Date(startDateStr) : null;
    const endDate = endDateStr ? new Date(endDateStr + "T23:59:59") : null;

    console.log(`📥 Importing Apple Health data for user ${userId}`);
    console.log(`📊 Selected metrics: ${Array.from(selectedMetrics).join(", ")}`);
    if (startDate && endDate) {
      console.log(`📅 Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    }

    // Parse the file
    let xmlContent: string;

    if (file.name.endsWith(".zip")) {
      const arrayBuffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
      const exportXml = zip.file("apple_health_export/export.xml") || zip.file("export.xml");

      if (!exportXml) {
        return NextResponse.json(
          { error: "Could not find export.xml in the ZIP file" },
          { status: 400 }
        );
      }

      xmlContent = await exportXml.async("string");
    } else {
      xmlContent = await file.text();
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });

    const parsed = parser.parse(xmlContent);
    let records = parsed.HealthData?.Record || [];
    if (!Array.isArray(records)) {
      records = [records];
    }

    // Group records by type
    const recordsByType = new Map<string, any[]>();
    for (const record of records) {
      const type = record["@_type"];
      if (!selectedMetrics.has(type)) continue;

      const recordDate = new Date(record["@_startDate"]);
      if (startDate && recordDate < startDate) continue;
      if (endDate && recordDate > endDate) continue;

      const existing = recordsByType.get(type) || [];
      existing.push(record);
      recordsByType.set(type, existing);
    }

    // Get backend URL
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

    // First, get existing habits for this user to avoid duplicates
    const existingHabitsResponse = await fetch(`${backendUrl}/api/habits`, {
      headers: {
        Authorization: `Bearer ${userId}`,
        "x-user-id": userId,
      },
    });

    let existingHabits: any[] = [];
    if (existingHabitsResponse.ok) {
      existingHabits = await existingHabitsResponse.json();
    }

    // Create a map of existing habits by metric_type
    const habitsByMetricType = new Map<string, any>();
    for (const habit of existingHabits) {
      if (habit.metric_type) {
        habitsByMetricType.set(habit.metric_type, habit);
      }
    }

    let totalImported = 0;
    let totalErrors = 0;
    const importedHabits: string[] = [];

    // Process each metric type
    for (const [type, typeRecords] of recordsByType) {
      const config = METRIC_CONFIG[type];
      if (!config) continue;

      console.log(`📊 Processing ${config.habitName}: ${typeRecords.length} records`);

      // Check if habit already exists
      let habit = habitsByMetricType.get(config.metricType);

      // Create habit if it doesn't exist
      if (!habit) {
        const createHabitResponse = await fetch(`${backendUrl}/api/habits`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userId}`,
            "x-user-id": userId,
          },
          body: JSON.stringify({
            name: config.habitName,
            description: `Imported from Apple Health`,
            icon: config.icon,
            color: "#FF6B6B",
            frequency: "daily",
            target_value: null,
            unit_type: config.unit,
            integration_source: "apple_health",
            sensor_type: "apple_health",
            metric_type: config.metricType,
          }),
        });

        if (createHabitResponse.ok) {
          habit = await createHabitResponse.json();
          console.log(`✅ Created habit: ${config.habitName}`);
        } else {
          console.error(`❌ Failed to create habit: ${config.habitName}`);
          totalErrors += typeRecords.length;
          continue;
        }
      }

      importedHabits.push(config.habitName);

      // Aggregate data by day
      const dailyData = aggregateByDay(typeRecords, config.metricType);

      // Create habit logs for each day
      for (const [date, data] of dailyData) {
        // Determine the value to use based on metric type
        let amount: number;
        const appleUnit = typeRecords[0]["@_unit"] || "";

        // For cumulative metrics (steps, calories, distance), use sum
        // For average metrics (heart rate, HRV), use average
        if (["steps", "active_energy", "basal_energy", "distance", "flights_climbed", "exercise_time", "stand_time", "mindful_minutes"].includes(config.metricType)) {
          amount = data.sum;
        } else if (["hr", "resting_hr", "hrv", "oxygen_saturation", "respiratory_rate"].includes(config.metricType)) {
          amount = data.sum / data.count; // Average
        } else if (config.metricType === "sleep_session") {
          // Sleep is stored in hours
          amount = data.sum / 3600; // Convert seconds to hours if needed
        } else {
          amount = data.sum;
        }

        // Convert units
        amount = convertValue(amount, appleUnit, config.unit);

        // Create habit log
        const logResponse = await fetch(`${backendUrl}/api/habit-logs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userId}`,
            "x-user-id": userId,
          },
          body: JSON.stringify({
            habit_id: habit.id,
            habit_name: habit.name,
            date: date,
            amount: amount,
            duration: config.unit.includes("hour") || config.unit.includes("minute") ? Math.round(amount * (config.unit.includes("hour") ? 3600 : 60)) : null,
            status: "completed",
            notes: "Imported from Apple Health",
            source: "apple_health",
          }),
        });

        if (logResponse.ok) {
          totalImported++;
        } else {
          // Log might already exist for this date - that's okay
          const error = await logResponse.json().catch(() => ({}));
          if (!error.detail?.includes("already exists")) {
            totalErrors++;
          }
        }
      }

      console.log(`✅ Imported ${dailyData.size} daily records for ${config.habitName}`);
    }

    console.log(`🎉 Import complete: ${totalImported} records imported, ${totalErrors} errors`);

    return NextResponse.json({
      success: true,
      imported: totalImported,
      errors: totalErrors,
      habits: importedHabits,
      message: `Successfully imported ${totalImported} records across ${importedHabits.length} habits`,
    });
  } catch (error) {
    console.error("❌ Error importing Apple Health data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}

