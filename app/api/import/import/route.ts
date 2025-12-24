import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import JSZip from "jszip";
import { parseStringPromise } from "xml2js";

// =====================
// TYPES
// =====================

type DataSource = "apple_health" | "whoop" | "csv" | "screenshot" | "oura" | "garmin" | "fitbit";

interface ExtractedData {
  metric: string;
  value: number;
  unit: string;
  date: string;
  confidence: number;
}

interface CSVMapping {
  dateColumn: string;
  valueColumn: string;
  metricColumn?: string;
  targetHabit?: string;
}

// Metric type to habit name and unit mapping
const METRIC_TO_HABIT: Record<string, { name: string; unit: string; integrationSource: string }> = {
  // Apple Health
  "HKQuantityTypeIdentifierStepCount": { name: "Steps", unit: "steps", integrationSource: "apple_health" },
  "HKQuantityTypeIdentifierHeartRate": { name: "Heart Rate", unit: "BPM", integrationSource: "apple_health" },
  "HKQuantityTypeIdentifierActiveEnergyBurned": { name: "Active Calories", unit: "kcal", integrationSource: "apple_health" },
  "HKQuantityTypeIdentifierBasalEnergyBurned": { name: "Resting Calories", unit: "kcal", integrationSource: "apple_health" },
  "HKQuantityTypeIdentifierDistanceWalkingRunning": { name: "Walking Distance", unit: "miles", integrationSource: "apple_health" },
  "HKQuantityTypeIdentifierFlightsClimbed": { name: "Flights Climbed", unit: "floors", integrationSource: "apple_health" },
  "HKQuantityTypeIdentifierAppleExerciseTime": { name: "Exercise Minutes", unit: "minutes", integrationSource: "apple_health" },
  "HKQuantityTypeIdentifierAppleStandTime": { name: "Stand Time", unit: "minutes", integrationSource: "apple_health" },
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": { name: "HRV", unit: "ms", integrationSource: "apple_health" },
  "HKQuantityTypeIdentifierRestingHeartRate": { name: "Resting Heart Rate", unit: "BPM", integrationSource: "apple_health" },
  "HKQuantityTypeIdentifierOxygenSaturation": { name: "Blood Oxygen", unit: "%", integrationSource: "apple_health" },
  "HKQuantityTypeIdentifierRespiratoryRate": { name: "Respiratory Rate", unit: "breaths/min", integrationSource: "apple_health" },
  "HKCategoryTypeIdentifierSleepAnalysis": { name: "Sleep", unit: "hours", integrationSource: "apple_health" },
  "HKCategoryTypeIdentifierMindfulSession": { name: "Mindfulness", unit: "minutes", integrationSource: "apple_health" },
  // Whoop
  "whoop_sleep_performance": { name: "Sleep Performance", unit: "%", integrationSource: "whoop" },
  "whoop_recovery": { name: "Recovery Score", unit: "%", integrationSource: "whoop" },
  "whoop_strain": { name: "Strain", unit: "score", integrationSource: "whoop" },
  // Oura
  "oura_readiness": { name: "Readiness Score", unit: "score", integrationSource: "oura" },
  "oura_sleep_score": { name: "Sleep Score", unit: "score", integrationSource: "oura" },
  "oura_activity_score": { name: "Activity Score", unit: "score", integrationSource: "oura" },
  // Garmin
  "garmin_stress": { name: "Stress Level", unit: "score", integrationSource: "garmin" },
  "garmin_body_battery": { name: "Body Battery", unit: "score", integrationSource: "garmin" },
  // Common metrics
  "steps": { name: "Steps", unit: "steps", integrationSource: "wearable" },
  "hr": { name: "Heart Rate", unit: "BPM", integrationSource: "wearable" },
  "hrv": { name: "HRV", unit: "ms", integrationSource: "wearable" },
  "resting_hr": { name: "Resting Heart Rate", unit: "BPM", integrationSource: "wearable" },
  "active_energy": { name: "Active Calories", unit: "kcal", integrationSource: "wearable" },
  "sleep_session": { name: "Sleep", unit: "hours", integrationSource: "wearable" },
  "distance": { name: "Distance", unit: "miles", integrationSource: "wearable" },
  "flights_climbed": { name: "Flights Climbed", unit: "floors", integrationSource: "wearable" },
  "respiratory_rate": { name: "Respiratory Rate", unit: "breaths/min", integrationSource: "wearable" },
};

// =====================
// HELPER FUNCTIONS
// =====================

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

async function getOrCreateHabit(
  userId: string,
  metricType: string,
  customName?: string,
  customUnit?: string,
  customSource?: string
): Promise<{ habitId: string; habitName: string }> {
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
  
  const habitInfo = METRIC_TO_HABIT[metricType] || {
    name: customName || metricType,
    unit: customUnit || "count",
    integrationSource: customSource || "import",
  };
  
  // First, try to find existing habit
  const existingResponse = await fetch(`${backendUrl}/api/habits?user_id=${userId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  
  if (existingResponse.ok) {
    const habits = await existingResponse.json();
    const existing = habits.find((h: { metric_type?: string; name: string }) => 
      h.metric_type === metricType || 
      h.name.toLowerCase() === habitInfo.name.toLowerCase()
    );
    
    if (existing) {
      return { habitId: existing.id, habitName: existing.name };
    }
  }
  
  // Create new habit
  const createResponse = await fetch(`${backendUrl}/api/habits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      name: customName || habitInfo.name,
      description: `Imported from ${habitInfo.integrationSource}`,
      frequency: "daily",
      goal_type: "at_least",
      goal_value: null,
      unit_type: customUnit || habitInfo.unit,
      allow_partial: true,
      metric_type: metricType,
      sensor_type: habitInfo.integrationSource,
      integration_source: habitInfo.integrationSource,
    }),
  });
  
  if (!createResponse.ok) {
    const error = await createResponse.text();
    throw new Error(`Failed to create habit: ${error}`);
  }
  
  const newHabit = await createResponse.json();
  return { habitId: newHabit.id, habitName: newHabit.name };
}

async function createHabitLog(
  userId: string,
  habitId: string,
  habitName: string,
  value: number,
  date: string,
  source: string
): Promise<void> {
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
  
  await fetch(`${backendUrl}/api/habits/${habitId}/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      habit_id: habitId,
      habit_name: habitName,
      amount: value,
      date: date,
      completed_at: new Date(date).toISOString(),
      status: "completed",
      notes: `Imported from ${source}`,
      source: source,
    }),
  });
}

// =====================
// APPLE HEALTH IMPORT
// =====================

async function importAppleHealth(
  userId: string,
  file: File,
  selectedMetrics: string[],
  startDate?: string,
  endDate?: string
) {
  let xmlContent: string;
  
  // Handle both ZIP and XML files
  if (file.name.endsWith(".zip")) {
    const arrayBuffer = await file.arrayBuffer();
    const zip = new JSZip();
    const contents = await zip.loadAsync(arrayBuffer);
    
    const exportFile = contents.file("apple_health_export/export.xml") || 
                       contents.file("export.xml");
    
    if (!exportFile) {
      throw new Error("Could not find export.xml in the ZIP file");
    }
    
    xmlContent = await exportFile.async("string");
  } else {
    xmlContent = await file.text();
  }
  
  const parsed = await parseStringPromise(xmlContent, { 
    explicitArray: true,
    ignoreAttrs: false 
  });
  
  const healthData = parsed.HealthData;
  if (!healthData) {
    throw new Error("Invalid Apple Health export format");
  }
  
  const records = healthData.Record || [];
  const metricsSet = new Set(selectedMetrics);
  
  // Parse date filters
  const filterStart = startDate ? new Date(startDate) : null;
  const filterEnd = endDate ? new Date(endDate) : null;
  
  // Group records by metric and date for aggregation
  const aggregatedData = new Map<string, Map<string, { sum: number; count: number }>>();
  
  for (const record of records) {
    const attrs = record.$ || {};
    const type = attrs.type;
    
    if (!type || !metricsSet.has(type)) continue;
    
    const recordDate = new Date(attrs.startDate || attrs.creationDate);
    
    // Apply date filter
    if (filterStart && recordDate < filterStart) continue;
    if (filterEnd && recordDate > filterEnd) continue;
    
    const dateKey = recordDate.toISOString().split("T")[0];
    
    // Get or create metric map
    if (!aggregatedData.has(type)) {
      aggregatedData.set(type, new Map());
    }
    
    const metricMap = aggregatedData.get(type)!;
    const existing = metricMap.get(dateKey) || { sum: 0, count: 0 };
    
    // Parse value
    let value = 0;
    if (attrs.value) {
      value = parseFloat(attrs.value);
    } else if (attrs.quantity) {
      value = parseFloat(attrs.quantity);
    }
    
    // Handle unit conversion
    const unit = attrs.unit || "";
    if (type === "HKQuantityTypeIdentifierDistanceWalkingRunning" && unit === "m") {
      value = value / 1609.34; // Convert meters to miles
    } else if (type === "HKQuantityTypeIdentifierOxygenSaturation") {
      value = value * 100; // Convert decimal to percentage
    } else if (type === "HKCategoryTypeIdentifierSleepAnalysis") {
      // For sleep, calculate duration in hours
      const endDate = new Date(attrs.endDate);
      const startDate = new Date(attrs.startDate);
      value = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    }
    
    if (!isNaN(value)) {
      existing.sum += value;
      existing.count++;
      metricMap.set(dateKey, existing);
    }
  }
  
  // Import aggregated data
  let importedCount = 0;
  let errorCount = 0;
  
  for (const [metricType, dateMap] of aggregatedData.entries()) {
    try {
      const { habitId, habitName } = await getOrCreateHabit(userId, metricType);
      
      for (const [date, data] of dateMap.entries()) {
        try {
          // Use sum for cumulative metrics (steps, calories), average for rate metrics (HR)
          const isRateMetric = metricType.includes("HeartRate") || 
                               metricType.includes("OxygenSaturation") ||
                               metricType.includes("RespiratoryRate");
          
          const value = isRateMetric ? data.sum / data.count : data.sum;
          
          await createHabitLog(userId, habitId, habitName, value, date, "apple_health_import");
          importedCount++;
        } catch (err) {
          console.error(`Error creating log for ${metricType} on ${date}:`, err);
          errorCount++;
        }
      }
    } catch (err) {
      console.error(`Error processing metric ${metricType}:`, err);
      errorCount++;
    }
  }
  
  return {
    success: true,
    imported: importedCount,
    errors: errorCount,
    message: `Imported ${importedCount} records from Apple Health`,
  };
}

// =====================
// CSV IMPORT
// =====================

async function importCSV(
  userId: string,
  file: File,
  mapping: CSVMapping
) {
  const text = await file.text();
  const lines = text.trim().split("\n");
  
  if (lines.length < 2) {
    throw new Error("CSV file appears to be empty");
  }
  
  const headers = parseCSVLine(lines[0]);
  const dateColIndex = headers.indexOf(mapping.dateColumn);
  const valueColIndex = headers.indexOf(mapping.valueColumn);
  const metricColIndex = mapping.metricColumn ? headers.indexOf(mapping.metricColumn) : -1;
  
  if (dateColIndex === -1) {
    throw new Error(`Date column "${mapping.dateColumn}" not found`);
  }
  
  if (valueColIndex === -1) {
    throw new Error(`Value column "${mapping.valueColumn}" not found`);
  }
  
  // Get or create the target habit
  const habitName = mapping.targetHabit || mapping.valueColumn || "Imported Data";
  const { habitId } = await getOrCreateHabit(
    userId, 
    `csv_import_${habitName.toLowerCase().replace(/\s+/g, "_")}`,
    habitName,
    "count",
    "csv_import"
  );
  
  let importedCount = 0;
  let errorCount = 0;
  
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length !== headers.length) continue;
    
    try {
      const dateStr = row[dateColIndex];
      const valueStr = row[valueColIndex];
      
      const date = new Date(dateStr);
      const value = parseFloat(valueStr);
      
      if (isNaN(date.getTime()) || isNaN(value)) continue;
      
      await createHabitLog(
        userId,
        habitId,
        habitName,
        value,
        date.toISOString().split("T")[0],
        "csv_import"
      );
      
      importedCount++;
    } catch (err) {
      console.error(`Error importing row ${i}:`, err);
      errorCount++;
    }
  }
  
  return {
    success: true,
    imported: importedCount,
    errors: errorCount,
    message: `Imported ${importedCount} records from CSV`,
  };
}

// =====================
// SCREENSHOT IMPORT
// =====================

async function importScreenshot(
  userId: string,
  extractions: ExtractedData[]
) {
  let importedCount = 0;
  let errorCount = 0;
  
  for (const extraction of extractions) {
    try {
      const metricKey = `screenshot_${extraction.metric.toLowerCase().replace(/\s+/g, "_")}`;
      
      const { habitId, habitName } = await getOrCreateHabit(
        userId,
        metricKey,
        extraction.metric,
        extraction.unit,
        "screenshot_import"
      );
      
      await createHabitLog(
        userId,
        habitId,
        habitName,
        extraction.value,
        extraction.date,
        "screenshot_import"
      );
      
      importedCount++;
    } catch (err) {
      console.error(`Error importing extraction:`, err);
      errorCount++;
    }
  }
  
  return {
    success: true,
    imported: importedCount,
    errors: errorCount,
    message: `Imported ${importedCount} records from screenshot`,
  };
}

// =====================
// WHOOP IMPORT
// =====================

async function importWhoop(
  userId: string,
  file: File,
  selectedMetrics: string[],
  startDate?: string,
  endDate?: string
) {
  const text = await file.text();
  const lines = text.trim().split("\n");
  
  if (lines.length < 2) {
    throw new Error("Whoop export file appears to be empty");
  }
  
  const headers = parseCSVLine(lines[0]);
  const metricsSet = new Set(selectedMetrics);
  
  // Parse date filters
  const filterStart = startDate ? new Date(startDate) : null;
  const filterEnd = endDate ? new Date(endDate) : null;
  
  const dateColumnIndex = headers.findIndex(h => 
    h.toLowerCase().includes("date") || h.toLowerCase().includes("day")
  );
  
  if (dateColumnIndex === -1) {
    throw new Error("Could not find date column in Whoop export");
  }
  
  // Map column names to our metric types
  const columnToMetricType: Record<string, string> = {};
  headers.forEach((h, idx) => {
    if (h.toLowerCase().includes("recovery") || h.toLowerCase().includes("recovery score")) {
      columnToMetricType[String(idx)] = "whoop_recovery";
    } else if (h.toLowerCase().includes("strain")) {
      columnToMetricType[String(idx)] = "whoop_strain";
    } else if (h.toLowerCase().includes("sleep") && h.toLowerCase().includes("performance")) {
      columnToMetricType[String(idx)] = "whoop_sleep_performance";
    } else if (h.toLowerCase().includes("hrv")) {
      columnToMetricType[String(idx)] = "hrv";
    } else if (h.toLowerCase().includes("resting") && h.toLowerCase().includes("heart")) {
      columnToMetricType[String(idx)] = "resting_hr";
    } else if (h.toLowerCase().includes("respiratory")) {
      columnToMetricType[String(idx)] = "respiratory_rate";
    } else if (h.toLowerCase().includes("calorie")) {
      columnToMetricType[String(idx)] = "active_energy";
    } else if (h.toLowerCase().includes("sleep") && (h.toLowerCase().includes("duration") || h.toLowerCase().includes("hours"))) {
      columnToMetricType[String(idx)] = "sleep_session";
    }
  });
  
  let importedCount = 0;
  let errorCount = 0;
  
  // Create habits and import data
  const habitCache = new Map<string, { habitId: string; habitName: string }>();
  
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length !== headers.length) continue;
    
    const dateStr = row[dateColumnIndex];
    const recordDate = new Date(dateStr);
    
    if (isNaN(recordDate.getTime())) continue;
    if (filterStart && recordDate < filterStart) continue;
    if (filterEnd && recordDate > filterEnd) continue;
    
    const date = recordDate.toISOString().split("T")[0];
    
    for (const [colIndex, metricType] of Object.entries(columnToMetricType)) {
      if (!metricsSet.has(metricType)) continue;
      
      const value = parseFloat(row[parseInt(colIndex)]);
      if (isNaN(value)) continue;
      
      try {
        if (!habitCache.has(metricType)) {
          const habit = await getOrCreateHabit(userId, metricType);
          habitCache.set(metricType, habit);
        }
        
        const { habitId, habitName } = habitCache.get(metricType)!;
        await createHabitLog(userId, habitId, habitName, value, date, "whoop_import");
        importedCount++;
      } catch (err) {
        console.error(`Error importing Whoop metric:`, err);
        errorCount++;
      }
    }
  }
  
  return {
    success: true,
    imported: importedCount,
    errors: errorCount,
    message: `Imported ${importedCount} records from Whoop`,
  };
}

// =====================
// OURA IMPORT
// =====================

async function importOura(
  userId: string,
  file: File,
  selectedMetrics: string[],
  startDate?: string,
  endDate?: string
) {
  const text = await file.text();
  const metricsSet = new Set(selectedMetrics);
  
  // Parse date filters
  const filterStart = startDate ? new Date(startDate) : null;
  const filterEnd = endDate ? new Date(endDate) : null;
  
  let importedCount = 0;
  let errorCount = 0;
  
  const habitCache = new Map<string, { habitId: string; habitName: string }>();
  
  if (file.name.endsWith(".json")) {
    // JSON format
    const data = JSON.parse(text);
    
    const sectionToMetric: Record<string, string> = {
      sleep: "sleep_session",
      readiness: "oura_readiness",
      activity: "oura_activity_score",
      heart_rate: "hr",
    };
    
    for (const [section, metricType] of Object.entries(sectionToMetric)) {
      if (!metricsSet.has(metricType)) continue;
      
      const records = data[section] || [];
      if (!Array.isArray(records)) continue;
      
      if (!habitCache.has(metricType)) {
        const habit = await getOrCreateHabit(userId, metricType);
        habitCache.set(metricType, habit);
      }
      
      const { habitId, habitName } = habitCache.get(metricType)!;
      
      for (const record of records) {
        try {
          const dateStr = record.day || record.summary_date || record.timestamp;
          if (!dateStr) continue;
          
          const recordDate = new Date(dateStr);
          if (isNaN(recordDate.getTime())) continue;
          if (filterStart && recordDate < filterStart) continue;
          if (filterEnd && recordDate > filterEnd) continue;
          
          // Extract value based on section
          let value: number | undefined;
          switch (section) {
            case "sleep":
              value = record.total || record.duration;
              if (value) value = value / 3600; // Convert seconds to hours
              break;
            case "readiness":
              value = record.score;
              break;
            case "activity":
              value = record.score;
              break;
            case "heart_rate":
              value = record.bpm || record.average;
              break;
          }
          
          if (value === undefined || isNaN(value)) continue;
          
          await createHabitLog(
            userId, 
            habitId, 
            habitName, 
            value, 
            recordDate.toISOString().split("T")[0], 
            "oura_import"
          );
          importedCount++;
        } catch (err) {
          console.error(`Error importing Oura record:`, err);
          errorCount++;
        }
      }
    }
  } else {
    // CSV format - similar to Whoop
    const lines = text.trim().split("\n");
    
    if (lines.length < 2) {
      throw new Error("Oura export file appears to be empty");
    }
    
    const headers = parseCSVLine(lines[0]);
    
    const dateColumnIndex = headers.findIndex(h => 
      h.toLowerCase().includes("date") || h.toLowerCase() === "day"
    );
    
    if (dateColumnIndex === -1) {
      throw new Error("Could not find date column in Oura export");
    }
    
    const columnToMetricType: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const lower = h.toLowerCase();
      if (lower.includes("sleep") && (lower.includes("score") || lower.includes("duration"))) {
        columnToMetricType[String(idx)] = "sleep_session";
      } else if (lower.includes("readiness")) {
        columnToMetricType[String(idx)] = "oura_readiness";
      } else if (lower.includes("activity") && lower.includes("score")) {
        columnToMetricType[String(idx)] = "oura_activity_score";
      } else if (lower.includes("hrv")) {
        columnToMetricType[String(idx)] = "hrv";
      } else if (lower.includes("resting") && lower.includes("heart")) {
        columnToMetricType[String(idx)] = "resting_hr";
      } else if (lower.includes("steps")) {
        columnToMetricType[String(idx)] = "steps";
      }
    });
    
    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVLine(lines[i]);
      if (row.length !== headers.length) continue;
      
      const dateStr = row[dateColumnIndex];
      const recordDate = new Date(dateStr);
      
      if (isNaN(recordDate.getTime())) continue;
      if (filterStart && recordDate < filterStart) continue;
      if (filterEnd && recordDate > filterEnd) continue;
      
      const date = recordDate.toISOString().split("T")[0];
      
      for (const [colIndex, metricType] of Object.entries(columnToMetricType)) {
        if (!metricsSet.has(metricType)) continue;
        
        const value = parseFloat(row[parseInt(colIndex)]);
        if (isNaN(value)) continue;
        
        try {
          if (!habitCache.has(metricType)) {
            const habit = await getOrCreateHabit(userId, metricType);
            habitCache.set(metricType, habit);
          }
          
          const { habitId, habitName } = habitCache.get(metricType)!;
          await createHabitLog(userId, habitId, habitName, value, date, "oura_import");
          importedCount++;
        } catch (err) {
          console.error(`Error importing Oura metric:`, err);
          errorCount++;
        }
      }
    }
  }
  
  return {
    success: true,
    imported: importedCount,
    errors: errorCount,
    message: `Imported ${importedCount} records from Oura`,
  };
}

// =====================
// GARMIN IMPORT
// =====================

async function importGarmin(
  userId: string,
  file: File,
  selectedMetrics: string[],
  startDate?: string,
  endDate?: string
) {
  const text = await file.text();
  const lines = text.trim().split("\n");
  
  if (lines.length < 2) {
    throw new Error("Garmin export file appears to be empty");
  }
  
  const headers = parseCSVLine(lines[0]);
  const metricsSet = new Set(selectedMetrics);
  
  const filterStart = startDate ? new Date(startDate) : null;
  const filterEnd = endDate ? new Date(endDate) : null;
  
  const dateColumnIndex = headers.findIndex(h => 
    h.toLowerCase().includes("date") || h.toLowerCase().includes("day")
  );
  
  if (dateColumnIndex === -1) {
    throw new Error("Could not find date column in Garmin export");
  }
  
  const columnToMetricType: Record<string, string> = {};
  headers.forEach((h, idx) => {
    const lower = h.toLowerCase();
    if (lower.includes("steps")) {
      columnToMetricType[String(idx)] = "steps";
    } else if (lower.includes("distance")) {
      columnToMetricType[String(idx)] = "distance";
    } else if (lower.includes("calorie") && lower.includes("active")) {
      columnToMetricType[String(idx)] = "active_energy";
    } else if (lower.includes("resting") && lower.includes("heart")) {
      columnToMetricType[String(idx)] = "resting_hr";
    } else if (lower.includes("stress")) {
      columnToMetricType[String(idx)] = "garmin_stress";
    } else if (lower.includes("body battery")) {
      columnToMetricType[String(idx)] = "garmin_body_battery";
    } else if (lower.includes("sleep")) {
      columnToMetricType[String(idx)] = "sleep_session";
    } else if (lower.includes("floors") || lower.includes("flights")) {
      columnToMetricType[String(idx)] = "flights_climbed";
    }
  });
  
  let importedCount = 0;
  let errorCount = 0;
  
  const habitCache = new Map<string, { habitId: string; habitName: string }>();
  
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length !== headers.length) continue;
    
    const dateStr = row[dateColumnIndex];
    const recordDate = new Date(dateStr);
    
    if (isNaN(recordDate.getTime())) continue;
    if (filterStart && recordDate < filterStart) continue;
    if (filterEnd && recordDate > filterEnd) continue;
    
    const date = recordDate.toISOString().split("T")[0];
    
    for (const [colIndex, metricType] of Object.entries(columnToMetricType)) {
      if (!metricsSet.has(metricType)) continue;
      
      const value = parseFloat(row[parseInt(colIndex)]);
      if (isNaN(value)) continue;
      
      try {
        if (!habitCache.has(metricType)) {
          const habit = await getOrCreateHabit(userId, metricType);
          habitCache.set(metricType, habit);
        }
        
        const { habitId, habitName } = habitCache.get(metricType)!;
        await createHabitLog(userId, habitId, habitName, value, date, "garmin_import");
        importedCount++;
      } catch (err) {
        console.error(`Error importing Garmin metric:`, err);
        errorCount++;
      }
    }
  }
  
  return {
    success: true,
    imported: importedCount,
    errors: errorCount,
    message: `Imported ${importedCount} records from Garmin`,
  };
}

// =====================
// MAIN HANDLER
// =====================

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const source = formData.get("source") as DataSource | null;
    
    if (!file && source !== "screenshot") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    
    if (!source) {
      return NextResponse.json({ error: "No source type specified" }, { status: 400 });
    }
    
    let result;
    
    switch (source) {
      case "apple_health": {
        const metrics = JSON.parse(formData.get("metrics") as string || "[]");
        const startDate = formData.get("startDate") as string | null;
        const endDate = formData.get("endDate") as string | null;
        result = await importAppleHealth(userId, file!, metrics, startDate || undefined, endDate || undefined);
        break;
      }
      
      case "csv": {
        const mapping = JSON.parse(formData.get("mapping") as string || "{}") as CSVMapping;
        result = await importCSV(userId, file!, mapping);
        break;
      }
      
      case "screenshot": {
        const extractions = JSON.parse(formData.get("extractions") as string || "[]") as ExtractedData[];
        result = await importScreenshot(userId, extractions);
        break;
      }
      
      case "whoop": {
        const metrics = JSON.parse(formData.get("metrics") as string || "[]");
        const startDate = formData.get("startDate") as string | null;
        const endDate = formData.get("endDate") as string | null;
        result = await importWhoop(userId, file!, metrics, startDate || undefined, endDate || undefined);
        break;
      }
      
      case "oura": {
        const metrics = JSON.parse(formData.get("metrics") as string || "[]");
        const startDate = formData.get("startDate") as string | null;
        const endDate = formData.get("endDate") as string | null;
        result = await importOura(userId, file!, metrics, startDate || undefined, endDate || undefined);
        break;
      }
      
      case "garmin": {
        const metrics = JSON.parse(formData.get("metrics") as string || "[]");
        const startDate = formData.get("startDate") as string | null;
        const endDate = formData.get("endDate") as string | null;
        result = await importGarmin(userId, file!, metrics, startDate || undefined, endDate || undefined);
        break;
      }
      
      default:
        return NextResponse.json({ error: `Unsupported source type: ${source}` }, { status: 400 });
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}

