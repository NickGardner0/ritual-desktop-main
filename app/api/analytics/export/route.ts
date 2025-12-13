import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { format, subDays } from 'date-fns';

/**
 * GET /api/analytics/export
 * 
 * Generate a Markdown summary of analytics for the specified period
 * Uses existing Tinybird data - no recomputation
 * 
 * Query params:
 * - start_date: Start of period (YYYY-MM-DD)
 * - end_date: End of period (YYYY-MM-DD)
 * - format: 'markdown' (default) | 'json'
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const tinybirdToken = process.env.TINYBIRD_TOKEN;
    const tinybirdUrl = process.env.TINYBIRD_API_URL || 'https://api.us-east.aws.tinybird.co';

    if (!tinybirdToken) {
      return NextResponse.json(
        { error: 'Analytics service not configured' },
        { status: 500 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('start_date') || format(subDays(new Date(), 30), 'yyyy-MM-dd');
    const endDate = searchParams.get('end_date') || format(new Date(), 'yyyy-MM-dd');
    const outputFormat = searchParams.get('format') || 'markdown';

    // Fetch summary data from Tinybird
    const summaryUrl = `${tinybirdUrl}/v0/pipes/analytics_summary.json?user_id=${encodeURIComponent(userId)}`;
    const habitsUrl = `${tinybirdUrl}/v0/pipes/user_habits_summary.json?user_id=${encodeURIComponent(userId)}&days_back=30`;
    const insightsUrl = `${tinybirdUrl}/v0/pipes/habit_insights.json?user_id=${encodeURIComponent(userId)}`;

    const [summaryRes, habitsRes, insightsRes] = await Promise.all([
      fetch(summaryUrl, { headers: { 'Authorization': `Bearer ${tinybirdToken}` } }),
      fetch(habitsUrl, { headers: { 'Authorization': `Bearer ${tinybirdToken}` } }),
      fetch(insightsUrl, { headers: { 'Authorization': `Bearer ${tinybirdToken}` } }),
    ]);

    const summaryData = summaryRes.ok ? await summaryRes.json() : { data: [] };
    const habitsData = habitsRes.ok ? await habitsRes.json() : { data: [] };
    const insightsData = insightsRes.ok ? await insightsRes.json() : { data: [] };

    const summary = summaryData.data?.[0] || {};
    const habits = habitsData.data || [];
    const insights = insightsData.data || [];

    if (outputFormat === 'json') {
      return NextResponse.json({
        success: true,
        data: {
          period: { start: startDate, end: endDate },
          summary,
          habits,
          insights,
        },
      });
    }

    // Generate Markdown summary
    const markdown = generateMarkdownSummary({
      startDate,
      endDate,
      summary,
      habits,
      insights,
    });

    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="ritual-analytics-${startDate}-to-${endDate}.md"`,
      },
    });

  } catch (error) {
    console.error('❌ Error in export endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function generateMarkdownSummary(data: {
  startDate: string;
  endDate: string;
  summary: any;
  habits: any[];
  insights: any[];
}): string {
  const { startDate, endDate, summary, habits, insights } = data;

  let md = `# Ritual Analytics Summary\n\n`;
  md += `**Period:** ${startDate} to ${endDate}\n\n`;
  md += `---\n\n`;

  // Overview Section
  md += `## Overview\n\n`;
  md += `- **Active Days (30d):** ${summary.active_days_30d || 0}\n`;
  md += `- **Avg Entries/Day:** ${summary.avg_entries_per_day_30d?.toFixed(1) || 0}\n`;
  md += `- **Current Streak:** ${summary.current_streak_days || 0} days\n`;
  if (summary.most_consistent_habit_name) {
    md += `- **Most Consistent:** ${summary.most_consistent_habit_name} (${summary.most_consistent_habit_pct || 0}%)\n`;
  }
  md += `\n`;

  // Insights Section
  if (insights.length > 0) {
    md += `## Key Insights\n\n`;
    insights.forEach((insight: any) => {
      const emoji = insight.sentiment === 'positive' ? '✅' : insight.sentiment === 'attention' ? '⚠️' : '📊';
      md += `${emoji} ${insight.message}\n`;
    });
    md += `\n`;
  }

  // Habits Performance Section
  if (habits.length > 0) {
    md += `## Habits Performance\n\n`;
    md += `| Habit | 7-Day Avg | 30-Day Avg | Trend | Days Tracked |\n`;
    md += `|-------|-----------|------------|-------|-------------|\n`;

    habits.forEach((habit: any) => {
      const trend = habit.weekly_amount_change_pct || 0;
      const trendEmoji = trend > 5 ? '📈' : trend < -5 ? '📉' : '➡️';
      const trendStr = `${trendEmoji} ${trend >= 0 ? '+' : ''}${trend.toFixed(1)}%`;
      
      md += `| ${habit.habit_name} | ${(habit.last_7_days_avg || 0).toFixed(1)} | ${(habit.last_30_days_avg || 0).toFixed(1)} | ${trendStr} | ${habit.days_with_data || 0} |\n`;
    });
    md += `\n`;
  }

  // Top Performers
  const improving = habits.filter((h: any) => (h.weekly_amount_change_pct || 0) > 10);
  const declining = habits.filter((h: any) => (h.weekly_amount_change_pct || 0) < -10);

  if (improving.length > 0) {
    md += `### 🌟 Top Performers\n\n`;
    improving.slice(0, 3).forEach((h: any) => {
      md += `- **${h.habit_name}** up ${h.weekly_amount_change_pct?.toFixed(0)}%\n`;
    });
    md += `\n`;
  }

  if (declining.length > 0) {
    md += `### 💡 Needs Attention\n\n`;
    declining.slice(0, 3).forEach((h: any) => {
      md += `- **${h.habit_name}** down ${Math.abs(h.weekly_amount_change_pct || 0).toFixed(0)}%\n`;
    });
    md += `\n`;
  }

  // Footer
  md += `---\n\n`;
  md += `*Generated by Ritual on ${new Date().toLocaleDateString()}*\n`;

  return md;
}
