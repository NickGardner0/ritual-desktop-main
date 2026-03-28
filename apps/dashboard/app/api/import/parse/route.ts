import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import JSZip from "jszip";
import { parseStringPromise } from "xml2js";

// =====================
// TYPES
// =====================

type DataSource = "apple_health" | "whoop" | "csv" | "screenshot" | "oura" | "garmin" | "fitbit";

interface ParsedMetric {
  type: string;
  count: number;
  earliestDate: string;
  latestDate: string;
}

// =====================
// APPLE HEALTH PARSING
// =====================

const APPLE_HEALTH_SUPPORTED_TYPES = new Set([
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierHeartRate",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKQuantityTypeIdentifierBasalEnergyBurned",
  "HKQuantityTypeIdentifierDistanceWalkingRunning",
  "HKQuantityTypeIdentifierFlightsClimbed",
  "HKQuantityTypeIdentifierAppleExerciseTime",
  "HKQuantityTypeIdentifierAppleStandTime",
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKQuantityTypeIdentifierOxygenSaturation",
  "HKQuantityTypeIdentifierRespiratoryRate",
  "HKCategoryTypeIdentifierSleepAnalysis",
  "HKCategoryTypeIdentifierMindfulSession",
]);

async function parseAppleHealthExport(file: File) {
  let xmlContent: string;
  
  // Handle both ZIP and XML files
  if (file.name.endsWith(".zip")) {
    const arrayBuffer = await file.arrayBuffer();
    const zip = new JSZip();
    const contents = await zip.loadAsync(arrayBuffer);
    
    // Find export.xml in the zip
    const exportFile = contents.file("apple_health_export/export.xml") || 
                       contents.file("export.xml");
    
    if (!exportFile) {
      throw new Error("Could not find export.xml in the ZIP file");
    }
    
    xmlContent = await exportFile.async("string");
  } else {
    xmlContent = await file.text();
  }
  
  // Parse XML
  const parsed = await parseStringPromise(xmlContent, { 
    explicitArray: true,
    ignoreAttrs: false 
  });
  
  const healthData = parsed.HealthData;
  if (!healthData) {
    throw new Error("Invalid Apple Health export format");
  }
  
  // Extract records
  const records = healthData.Record || [];
  const workouts = healthData.Workout || [];
  
  // Aggregate metrics
  const metricsMap = new Map<string, { count: number; earliest: Date; latest: Date }>();
  let totalRecords = 0;
  let overallEarliest: Date | null = null;
  let overallLatest: Date | null = null;
  
  for (const record of records) {
    const attrs = record.$ || {};
    const type = attrs.type;
    
    if (!type || !APPLE_HEALTH_SUPPORTED_TYPES.has(type)) continue;
    
    totalRecords++;
    const recordDate = new Date(attrs.startDate || attrs.creationDate);
    
    // Update overall date range
    if (!overallEarliest || recordDate < overallEarliest) overallEarliest = recordDate;
    if (!overallLatest || recordDate > overallLatest) overallLatest = recordDate;
    
    // Update metric-specific counts
    const existing = metricsMap.get(type) || {
      count: 0,
      earliest: recordDate,
      latest: recordDate,
    };
    
    existing.count++;
    if (recordDate < existing.earliest) existing.earliest = recordDate;
    if (recordDate > existing.latest) existing.latest = recordDate;
    
    metricsMap.set(type, existing);
  }
  
  // Process workouts
  if (workouts.length > 0) {
    totalRecords += workouts.length;
    const workoutType = "HKWorkoutType";
    
    let earliest: Date | null = null;
    let latest: Date | null = null;
    
    for (const workout of workouts) {
      const attrs = workout.$ || {};
      const workoutDate = new Date(attrs.startDate);
      
      if (!earliest || workoutDate < earliest) earliest = workoutDate;
      if (!latest || workoutDate > latest) latest = workoutDate;
      if (!overallEarliest || workoutDate < overallEarliest) overallEarliest = workoutDate;
      if (!overallLatest || workoutDate > overallLatest) overallLatest = workoutDate;
    }
    
    if (earliest && latest) {
      metricsMap.set(workoutType, {
        count: workouts.length,
        earliest,
        latest,
      });
    }
  }
  
  // Convert to array
  const metrics: ParsedMetric[] = Array.from(metricsMap.entries()).map(([type, data]) => ({
    type,
    count: data.count,
    earliestDate: data.earliest.toISOString(),
    latestDate: data.latest.toISOString(),
  }));
  
  return {
    success: true,
    metrics,
    totalRecords,
    dateRange: {
      start: overallEarliest?.toISOString() || new Date().toISOString(),
      end: overallLatest?.toISOString() || new Date().toISOString(),
    },
  };
}

// =====================
// CSV PARSING
// =====================

async function parseCSV(file: File) {
  const text = await file.text();
  const lines = text.trim().split("\n");
  
  if (lines.length < 2) {
    throw new Error("CSV file appears to be empty or has no data rows");
  }
  
  // Parse headers
  const headers = parseCSVLine(lines[0]);
  
  // Parse rows
  const rows: string[][] = [];
  const preview: Record<string, string>[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length === headers.length) {
      rows.push(row);
      
      // Build preview for first few rows
      if (preview.length < 5) {
        const previewRow: Record<string, string> = {};
        headers.forEach((h, idx) => {
          previewRow[h] = row[idx];
        });
        preview.push(previewRow);
      }
    }
  }
  
  return {
    success: true,
    headers,
    rows,
    preview,
    totalRows: rows.length,
  };
}

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

// =====================
// SCREENSHOT PARSING (AI)
// =====================

async function parseScreenshot(file: File) {
  // Convert file to base64
  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = file.type || "image/png";
  
  // Use OpenAI Vision or similar to extract data
  // For now, we'll use a simpler approach with pattern matching
  // In production, you'd call an AI API here
  
  try {
    // Call our AI extraction endpoint
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ""}/api/import/extract-from-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: `data:${mimeType};base64,${base64}`,
        filename: file.name,
      }),
      signal: AbortSignal.timeout(15000),
    });
    
    if (!response.ok) {
      throw new Error("Failed to extract data from image");
    }
    
    const result = await response.json();
    return result;
  } catch (error) {
    // Fallback: return empty result
    console.error("Screenshot parsing error:", error);
    return {
      success: true,
      extractedData: [],
      rawText: "",
    };
  }
}

// =====================
// WHOOP PARSING
// =====================

async function parseWhoopExport(file: File) {
  const text = await file.text();
  const lines = text.trim().split("\n");
  
  if (lines.length < 2) {
    throw new Error("Whoop export file appears to be empty");
  }
  
  const headers = parseCSVLine(lines[0]);
  
  // Whoop exports typically have columns like:
  // Date, Sleep Performance, Recovery Score, Strain, HRV, Resting Heart Rate, etc.
  
  const metricsMap = new Map<string, { count: number; earliest: Date; latest: Date }>();
  let totalRecords = 0;
  let overallEarliest: Date | null = null;
  let overallLatest: Date | null = null;
  
  // Map Whoop columns to our metric types
  const whoopToMetricType: Record<string, string> = {
    "Sleep Performance": "whoop_sleep_performance",
    "Recovery Score": "whoop_recovery",
    "Strain": "whoop_strain",
    "HRV": "hrv",
    "Resting Heart Rate": "resting_hr",
    "Respiratory Rate": "respiratory_rate",
    "Calories": "active_energy",
    "Sleep Duration": "sleep_session",
  };
  
  const dateColumnIndex = headers.findIndex(h => 
    h.toLowerCase().includes("date") || h.toLowerCase().includes("day")
  );
  
  if (dateColumnIndex === -1) {
    throw new Error("Could not find date column in Whoop export");
  }
  
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length !== headers.length) continue;
    
    const dateStr = row[dateColumnIndex];
    const recordDate = new Date(dateStr);
    
    if (isNaN(recordDate.getTime())) continue;
    
    totalRecords++;
    
    // Update overall date range
    if (!overallEarliest || recordDate < overallEarliest) overallEarliest = recordDate;
    if (!overallLatest || recordDate > overallLatest) overallLatest = recordDate;
    
    // Check each column for known metrics
    headers.forEach((header, idx) => {
      const metricType = whoopToMetricType[header];
      if (!metricType) return;
      
      const value = row[idx];
      if (!value || value === "" || isNaN(parseFloat(value))) return;
      
      const existing = metricsMap.get(metricType) || {
        count: 0,
        earliest: recordDate,
        latest: recordDate,
      };
      
      existing.count++;
      if (recordDate < existing.earliest) existing.earliest = recordDate;
      if (recordDate > existing.latest) existing.latest = recordDate;
      
      metricsMap.set(metricType, existing);
    });
  }
  
  const metrics: ParsedMetric[] = Array.from(metricsMap.entries()).map(([type, data]) => ({
    type,
    count: data.count,
    earliestDate: data.earliest.toISOString(),
    latestDate: data.latest.toISOString(),
  }));
  
  return {
    success: true,
    metrics,
    totalRecords,
    dateRange: {
      start: overallEarliest?.toISOString() || new Date().toISOString(),
      end: overallLatest?.toISOString() || new Date().toISOString(),
    },
  };
}

// =====================
// OURA PARSING
// =====================

async function parseOuraExport(file: File) {
  const text = await file.text();
  
  // Oura can export as JSON or CSV
  if (file.name.endsWith(".json")) {
    return parseOuraJSON(text);
  } else {
    return parseOuraCSV(text);
  }
}

function parseOuraJSON(text: string) {
  const data = JSON.parse(text);
  
  const metricsMap = new Map<string, { count: number; earliest: Date; latest: Date }>();
  let totalRecords = 0;
  let overallEarliest: Date | null = null;
  let overallLatest: Date | null = null;
  
  // Oura JSON typically has sections like: sleep, activity, readiness
  const sections = ["sleep", "activity", "readiness", "heart_rate"];
  
  const ouraToMetricType: Record<string, string> = {
    sleep: "sleep_session",
    activity: "active_energy",
    readiness: "oura_readiness",
    heart_rate: "hr",
  };
  
  for (const section of sections) {
    const records = data[section] || [];
    if (!Array.isArray(records)) continue;
    
    const metricType = ouraToMetricType[section] || section;
    
    for (const record of records) {
      const dateStr = record.day || record.summary_date || record.timestamp;
      if (!dateStr) continue;
      
      const recordDate = new Date(dateStr);
      if (isNaN(recordDate.getTime())) continue;
      
      totalRecords++;
      
      if (!overallEarliest || recordDate < overallEarliest) overallEarliest = recordDate;
      if (!overallLatest || recordDate > overallLatest) overallLatest = recordDate;
      
      const existing = metricsMap.get(metricType) || {
        count: 0,
        earliest: recordDate,
        latest: recordDate,
      };
      
      existing.count++;
      if (recordDate < existing.earliest) existing.earliest = recordDate;
      if (recordDate > existing.latest) existing.latest = recordDate;
      
      metricsMap.set(metricType, existing);
    }
  }
  
  const metrics: ParsedMetric[] = Array.from(metricsMap.entries()).map(([type, data]) => ({
    type,
    count: data.count,
    earliestDate: data.earliest.toISOString(),
    latestDate: data.latest.toISOString(),
  }));
  
  return {
    success: true,
    metrics,
    totalRecords,
    dateRange: {
      start: overallEarliest?.toISOString() || new Date().toISOString(),
      end: overallLatest?.toISOString() || new Date().toISOString(),
    },
  };
}

function parseOuraCSV(text: string) {
  // Similar to Whoop CSV parsing
  const lines = text.trim().split("\n");
  
  if (lines.length < 2) {
    throw new Error("Oura export file appears to be empty");
  }
  
  const headers = parseCSVLine(lines[0]);
  
  const metricsMap = new Map<string, { count: number; earliest: Date; latest: Date }>();
  let totalRecords = 0;
  let overallEarliest: Date | null = null;
  let overallLatest: Date | null = null;
  
  const ouraToMetricType: Record<string, string> = {
    "Total Sleep Duration": "sleep_session",
    "Sleep Score": "oura_sleep_score",
    "Readiness Score": "oura_readiness",
    "Activity Score": "oura_activity_score",
    "HRV Average": "hrv",
    "Resting Heart Rate": "resting_hr",
    "Steps": "steps",
    "Calories": "active_energy",
  };
  
  const dateColumnIndex = headers.findIndex(h => 
    h.toLowerCase().includes("date") || h.toLowerCase() === "day"
  );
  
  if (dateColumnIndex === -1) {
    throw new Error("Could not find date column in Oura export");
  }
  
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length !== headers.length) continue;
    
    const dateStr = row[dateColumnIndex];
    const recordDate = new Date(dateStr);
    
    if (isNaN(recordDate.getTime())) continue;
    
    totalRecords++;
    
    if (!overallEarliest || recordDate < overallEarliest) overallEarliest = recordDate;
    if (!overallLatest || recordDate > overallLatest) overallLatest = recordDate;
    
    headers.forEach((header, idx) => {
      const metricType = ouraToMetricType[header];
      if (!metricType) return;
      
      const value = row[idx];
      if (!value || value === "" || isNaN(parseFloat(value))) return;
      
      const existing = metricsMap.get(metricType) || {
        count: 0,
        earliest: recordDate,
        latest: recordDate,
      };
      
      existing.count++;
      if (recordDate < existing.earliest) existing.earliest = recordDate;
      if (recordDate > existing.latest) existing.latest = recordDate;
      
      metricsMap.set(metricType, existing);
    });
  }
  
  const metrics: ParsedMetric[] = Array.from(metricsMap.entries()).map(([type, data]) => ({
    type,
    count: data.count,
    earliestDate: data.earliest.toISOString(),
    latestDate: data.latest.toISOString(),
  }));
  
  return {
    success: true,
    metrics,
    totalRecords,
    dateRange: {
      start: overallEarliest?.toISOString() || new Date().toISOString(),
      end: overallLatest?.toISOString() || new Date().toISOString(),
    },
  };
}

// =====================
// GARMIN PARSING
// =====================

async function parseGarminExport(file: File) {
  // Garmin exports can be CSV or ZIP
  // For simplicity, we'll handle CSV format similar to Whoop
  const text = await file.text();
  const lines = text.trim().split("\n");
  
  if (lines.length < 2) {
    throw new Error("Garmin export file appears to be empty");
  }
  
  const headers = parseCSVLine(lines[0]);
  
  const metricsMap = new Map<string, { count: number; earliest: Date; latest: Date }>();
  let totalRecords = 0;
  let overallEarliest: Date | null = null;
  let overallLatest: Date | null = null;
  
  const garminToMetricType: Record<string, string> = {
    "Steps": "steps",
    "Distance": "distance",
    "Calories": "active_energy",
    "Active Calories": "active_energy",
    "Resting Heart Rate": "resting_hr",
    "Avg Heart Rate": "hr",
    "Max Heart Rate": "hr_max",
    "Stress Level": "garmin_stress",
    "Body Battery": "garmin_body_battery",
    "Sleep Duration": "sleep_session",
    "Floors Climbed": "flights_climbed",
  };
  
  const dateColumnIndex = headers.findIndex(h => 
    h.toLowerCase().includes("date") || h.toLowerCase().includes("day")
  );
  
  if (dateColumnIndex === -1) {
    throw new Error("Could not find date column in Garmin export");
  }
  
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length !== headers.length) continue;
    
    const dateStr = row[dateColumnIndex];
    const recordDate = new Date(dateStr);
    
    if (isNaN(recordDate.getTime())) continue;
    
    totalRecords++;
    
    if (!overallEarliest || recordDate < overallEarliest) overallEarliest = recordDate;
    if (!overallLatest || recordDate > overallLatest) overallLatest = recordDate;
    
    headers.forEach((header, idx) => {
      const metricType = garminToMetricType[header];
      if (!metricType) return;
      
      const value = row[idx];
      if (!value || value === "" || isNaN(parseFloat(value))) return;
      
      const existing = metricsMap.get(metricType) || {
        count: 0,
        earliest: recordDate,
        latest: recordDate,
      };
      
      existing.count++;
      if (recordDate < existing.earliest) existing.earliest = recordDate;
      if (recordDate > existing.latest) existing.latest = recordDate;
      
      metricsMap.set(metricType, existing);
    });
  }
  
  const metrics: ParsedMetric[] = Array.from(metricsMap.entries()).map(([type, data]) => ({
    type,
    count: data.count,
    earliestDate: data.earliest.toISOString(),
    latestDate: data.latest.toISOString(),
  }));
  
  return {
    success: true,
    metrics,
    totalRecords,
    dateRange: {
      start: overallEarliest?.toISOString() || new Date().toISOString(),
      end: overallLatest?.toISOString() || new Date().toISOString(),
    },
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
    
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    
    if (!source) {
      return NextResponse.json({ error: "No source type specified" }, { status: 400 });
    }
    
    let result;
    
    switch (source) {
      case "apple_health":
        result = await parseAppleHealthExport(file);
        break;
      case "csv":
        result = await parseCSV(file);
        break;
      case "screenshot":
        result = await parseScreenshot(file);
        break;
      case "whoop":
        result = await parseWhoopExport(file);
        break;
      case "oura":
        result = await parseOuraExport(file);
        break;
      case "garmin":
        result = await parseGarminExport(file);
        break;
      default:
        return NextResponse.json({ error: `Unsupported source type: ${source}` }, { status: 400 });
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error("Parse error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to parse file" },
      { status: 500 }
    );
  }
}

