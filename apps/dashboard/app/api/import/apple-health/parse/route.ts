import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

// Supported Apple Health record types
const SUPPORTED_TYPES = new Set([
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

interface ParsedMetric {
  type: string;
  count: number;
  earliestDate: string;
  latestDate: string;
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the uploaded file
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    console.log(`📥 Parsing Apple Health export: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);

    let xmlContent: string;

    // Handle ZIP or XML file
    if (file.name.endsWith(".zip")) {
      const arrayBuffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      // Look for export.xml in the zip
      const exportXml = zip.file("apple_health_export/export.xml") || zip.file("export.xml");

      if (!exportXml) {
        return NextResponse.json(
          { error: "Could not find export.xml in the ZIP file. Make sure this is an Apple Health export." },
          { status: 400 }
        );
      }

      xmlContent = await exportXml.async("string");
    } else if (file.name.endsWith(".xml")) {
      xmlContent = await file.text();
    } else {
      return NextResponse.json(
        { error: "Unsupported file format. Please upload a .zip or .xml file." },
        { status: 400 }
      );
    }

    console.log(`📄 XML content length: ${(xmlContent.length / 1024 / 1024).toFixed(1)} MB`);

    // Parse XML - use streaming approach for large files
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });

    const parsed = parser.parse(xmlContent);

    if (!parsed.HealthData) {
      return NextResponse.json(
        { error: "Invalid Apple Health export format. Missing HealthData root element." },
        { status: 400 }
      );
    }

    // Get records
    let records = parsed.HealthData.Record;
    if (!records) {
      return NextResponse.json(
        { error: "No health records found in the export." },
        { status: 400 }
      );
    }

    // Ensure records is an array
    if (!Array.isArray(records)) {
      records = [records];
    }

    console.log(`📊 Total records in export: ${records.length}`);

    // Aggregate metrics
    const metricsMap = new Map<string, ParsedMetric>();
    let totalRecords = 0;
    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    for (const record of records) {
      const type = record["@_type"];
      
      if (!SUPPORTED_TYPES.has(type)) {
        continue;
      }

      totalRecords++;

      const startDate = new Date(record["@_startDate"]);
      
      if (!minDate || startDate < minDate) minDate = startDate;
      if (!maxDate || startDate > maxDate) maxDate = startDate;

      const existing = metricsMap.get(type);
      if (existing) {
        existing.count++;
        if (startDate.toISOString() < existing.earliestDate) {
          existing.earliestDate = startDate.toISOString();
        }
        if (startDate.toISOString() > existing.latestDate) {
          existing.latestDate = startDate.toISOString();
        }
      } else {
        metricsMap.set(type, {
          type,
          count: 1,
          earliestDate: startDate.toISOString(),
          latestDate: startDate.toISOString(),
        });
      }
    }

    const metrics = Array.from(metricsMap.values()).sort((a, b) => b.count - a.count);

    console.log(`✅ Found ${metrics.length} supported metric types with ${totalRecords} total records`);

    return NextResponse.json({
      success: true,
      metrics,
      totalRecords,
      dateRange: {
        start: minDate?.toISOString() || new Date().toISOString(),
        end: maxDate?.toISOString() || new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("❌ Error parsing Apple Health export:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to parse file" },
      { status: 500 }
    );
  }
}

