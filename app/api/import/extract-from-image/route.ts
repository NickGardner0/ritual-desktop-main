import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";

// =====================
// TYPES
// =====================

interface ExtractedData {
  metric: string;
  value: number;
  unit: string;
  date: string;
  confidence: number;
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
    
    const body = await request.json();
    const { image, filename } = body;
    
    if (!image) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }
    
    // Check for OpenAI API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.log("No OPENAI_API_KEY found, returning mock data");
      return NextResponse.json({
        success: true,
        extractedData: [],
        rawText: "AI extraction requires OPENAI_API_KEY to be configured",
      });
    }
    
    // Use OpenAI Vision to extract data from the image
    const openai = new OpenAI({ apiKey });
    
    const today = new Date().toISOString().split("T")[0];
    
    const systemPrompt = `You are an AI assistant that analyzes screenshots to extract health, fitness, or habit tracking data.

Your task:
1. Analyze the screenshot to understand what data it shows
2. Extract all meaningful metric values from the screenshot
3. For each value found, identify: metric name, numerical value, unit, and date if visible

Common screenshot types you might see:
- Apple Health / Apple Watch data
- Fitness apps (Strava, Nike Run Club, Peloton, etc.)
- Sleep tracking apps (Sleep Cycle, AutoSleep, etc.)
- Meditation apps (Headspace, Calm, etc.)
- Screen time data
- Weight/body composition apps
- Nutrition apps (MyFitnessPal, etc.)
- Any app showing tracked metrics

Rules:
- Extract ALL visible metrics, not just one
- Focus on TODAY's data if multiple days are shown, but extract historical data too if clearly visible
- Return numerical values only (convert "1h 30m" to 1.5 hours or 90 minutes)
- Use today's date (${today}) if no date is visible
- Be conservative with confidence scores

Return ONLY valid JSON in this exact format:
{
  "extractedData": [
    {
      "metric": "Steps",
      "value": 10234,
      "unit": "steps",
      "date": "2024-01-15",
      "confidence": 0.95
    },
    {
      "metric": "Heart Rate",
      "value": 72,
      "unit": "BPM",
      "date": "2024-01-15",
      "confidence": 0.9
    }
  ],
  "rawText": "Brief description of what you see in the image"
}

If you cannot find any health/fitness data, return:
{
  "extractedData": [],
  "rawText": "Description of what you see, explaining why no data was extracted"
}

Only extract data you are confident about. Be precise with numbers.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this screenshot and extract any health/fitness/habit data. Return JSON only.",
            },
            {
              type: "image_url",
              image_url: { url: image },
            },
          ],
        },
      ],
      temperature: 0.0,
      max_tokens: 1000,
    });
    
    const rawContent = response.choices[0].message.content;
    console.log("🔍 OpenAI vision response:", rawContent);
    
    if (!rawContent) {
      return NextResponse.json({
        success: true,
        extractedData: [],
        rawText: "Failed to analyze image",
      });
    }
    
    // Extract JSON from response
    let jsonData;
    
    // Try direct parse
    try {
      jsonData = JSON.parse(rawContent.trim());
    } catch {
      // Try extracting from markdown code block
      const codeBlockMatch = rawContent.match(/```(?:json)?\s*(\{[\s\S]+?\})\s*```/);
      if (codeBlockMatch) {
        try {
          jsonData = JSON.parse(codeBlockMatch[1]);
        } catch {
          // Continue to next method
        }
      }
      
      // Try finding JSON object
      if (!jsonData) {
        const start = rawContent.indexOf("{");
        const end = rawContent.lastIndexOf("}") + 1;
        if (start !== -1 && end > start) {
          try {
            jsonData = JSON.parse(rawContent.substring(start, end));
          } catch {
            // Give up
          }
        }
      }
    }
    
    if (!jsonData) {
      return NextResponse.json({
        success: true,
        extractedData: [],
        rawText: rawContent,
      });
    }
    
    return NextResponse.json({
      success: true,
      extractedData: jsonData.extractedData || [],
      rawText: jsonData.rawText || "",
    });
  } catch (error) {
    console.error("Image extraction error:", error);
    return NextResponse.json(
      { 
        success: true,
        extractedData: [],
        error: error instanceof Error ? error.message : "Failed to extract data from image",
      },
      { status: 200 } // Return 200 with empty data rather than error
    );
  }
}
