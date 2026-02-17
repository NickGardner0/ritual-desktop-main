# 📊 Analytics Implementation Guide

## ✅ What Was Created

### 1. New Tinybird Pipes

#### `habit_logs_time_range.pipe`
**Purpose:** Flexible query for AI chat - allows querying any date range  
**Endpoint:** `/api/analytics/habits/time-range?start_date=2025-01-01&end_date=2025-11-12&habit_id=xxx`

**Use case:** Powers AI natural language queries
- "How many times did I work out in October?"
- "Show me my meditation logs from last month"

#### `user_habits_summary.pipe` (ENHANCED)
**Purpose:** Habit stats with time-based comparisons (7-day & 30-day changes)  
**Returns:**
- Current metrics (count, amount, duration)
- Last 7 days vs previous 7 days
- Last 30 days vs previous 30 days
- **Percentage changes** (for ticker view!)

**Example Response:**
```json
{
  "habit_id": "abc123",
  "habit_name": "Workout",
  "unit": "minutes",
  "last_7_days_avg": 45.5,
  "prev_7_days_avg": 38.2,
  "weekly_amount_change_pct": 19.1,  // ↑ 19.1%
  "monthly_amount_change_pct": 12.3
}
```

---

### 2. New UI Components

#### `apps/dashboard/components/analytics/habit-ticker-view.tsx`
**3 new components created:**

**a) `<HabitTickerCard />` - Perplexity Finance-style card**
- Habit name + unit
- Percentage change badge (↑/↓ with color)
- Sparkline chart
- Large current value
- Absolute change indicator

**b) `<HabitTickerGrid />` - Grid of ticker cards**
- Responsive grid layout (1-4 columns)
- Dark mode support
- Click to expand

**c) `<AnalyticsViewToggle />` - Switch between views**
- 📊 Charts (your existing view)
- 📈 Ticker (new Perplexity-style view)

---

### 3. Updated Analytics Page

**File:** `apps/dashboard/app/(dashboard)/analytics/analytics-client.tsx`

**New features:**
- ✅ View toggle button (Charts vs Ticker)
- ✅ Ticker view renders Perplexity-style cards
- ✅ Chart view preserved (your existing design)
- ✅ Both views support:
  - Multi-habit selection
  - Click to expand for details
  - Date range filtering

---

## 🚀 How to Deploy

### Step 1: Deploy Tinybird Pipes

```bash
cd apps/tinybird

# Build pipes
tb build

# Deploy to Tinybird Cloud
tb deploy

# Verify deployment
tb pipe ls
```

You should see:
- ✅ `habit_logs_time_range`
- ✅ `user_habits_summary` (updated)
- ✅ `habit_trends`
- ✅ `whoop_analytics`
- ✅ `recent_habit_logs`

---

### Step 2: Test the New Pipes

#### Test Enhanced Summary:
```bash
curl "http://localhost:3000/api/analytics/habits/summary?days_back=30" \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN"
```

**Look for:**
- `weekly_amount_change_pct` - This powers the ticker % changes
- `last_7_days_avg` vs `prev_7_days_avg` - For comparison

#### Test Time Range Query:
```bash
curl "http://localhost:3000/api/analytics/habits/time-range?start_date=2025-11-01&end_date=2025-11-12" \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN"
```

---

### Step 3: Test the UI

1. **Start your app:**
```bash
npm run dev
```

2. **Navigate to Analytics page:**  
http://localhost:3000/analytics

3. **Test Both Views:**
   - Click "📊 Charts" - See your existing chart cards (unchanged)
   - Click "📈 Ticker" - See new Perplexity-style ticker cards

4. **Test Interactions:**
   - Select multiple habits from dropdown
   - Toggle between views
   - Click a ticker card to expand
   - Notice the % change badges (↑/↓)

---

## 🎨 Visual Comparison

### Chart View (Original)
```
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ Coding         │  │ Meditation     │  │ Workout        │
│                │  │                │  │                │
│ 3.0 count      │  │ 0.2 count      │  │ 1.0 count      │
│ ↑              │  │                │  │                │
│ [Line Chart]   │  │ [Line Chart]   │  │ [Line Chart]   │
└────────────────┘  └────────────────┘  └────────────────┘
```

### Ticker View (NEW - Perplexity-style)
```
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ Coding      ↑19%│  │ Meditation  ↑5%│  │ Workout   ↓12%│
│ MINUTES         │  │ COUNT           │  │ MINUTES        │
│                 │  │                 │  │                │
│ ~~~sparkline~~~ │  │ ~~~sparkline~~~ │  │ ~~~sparkline~~~│
│                 │  │                 │  │                │
│ 45.2            │  │ 0.8             │  │ 38.5           │
│ minutes (7d avg)│  │ count (7d avg)  │  │ min (7d avg)   │
│                 │  │                 │  │                │
│ +7.3 min        │  │ +0.04 count     │  │ -5.2 min       │
│ vs prev week    │  │ vs prev week    │  │ vs prev week   │
└────────────────┘  └────────────────┘  └────────────────┘
```

---

## 🎯 What Each View Is For

### 📊 Chart View (Default)
**Best for:**
- Seeing detailed trends over time
- Understanding patterns and cycles
- Comparing multiple time periods

**When to use:**
- "How has my meditation practice changed?"
- "What's my workout trend?"
- Deep analysis

---

### 📈 Ticker View (NEW)
**Best for:**
- Quick at-a-glance status
- Seeing % improvements
- Motivating "up/down" indicators
- Finance-minded users

**When to use:**
- "Am I improving this week?"
- "Quick daily check-in"
- Gamification / motivation

---

## 🎨 Customization Options

### Enable Dark Mode
In `analytics-client.tsx`, change:

```typescript
<HabitTickerGrid
  habits={habits}
  darkMode={true}  // ← Enable dark mode
/>

<AnalyticsViewToggle
  currentView={viewMode}
  onViewChange={setViewMode}
  darkMode={true}  // ← Enable dark mode
/>
```

### Change Time Period
The ticker shows "7-day avg vs previous 7 days" by default.

To show 30-day comparison instead, modify the data mapping in `analytics-client.tsx`:

```typescript
last_7_days_avg: cardData.currentValue,  // Change to 30-day data
prev_7_days_avg: cardData.previousValue, // Change to prev 30-day data
weekly_amount_change_pct: cardData.change, // Update to monthly_amount_change_pct
```

---

## 📊 Data Flow

```
User Action: Select habits + Toggle to Ticker View
     ↓
Analytics Client Component
     ↓
Fetch: /api/analytics/habits/summary (enhanced)
     ↓
Tinybird: user_habits_summary.pipe
     ↓
Returns: Metrics + % Changes
     ↓
Render: <HabitTickerGrid />
     ↓
Display: Perplexity-style cards with sparklines & % changes
```

---

## 🔧 Troubleshooting

### Issue: Ticker cards show 0% change
**Cause:** Not enough historical data (< 14 days of logs)

**Solution:** 
- Add more habit logs
- Or adjust comparison period in the pipe

---

### Issue: Sparklines not rendering
**Cause:** Missing chart data

**Solution:** Verify `chartData` array has values:
```typescript
console.log('Chart data:', cardData.chartData);
// Should show: [{ value: 1 }, { value: 2 }, ...]
```

---

### Issue: View toggle not working
**Cause:** Import error

**Solution:** Verify import path:
```typescript
import { HabitTickerGrid, AnalyticsViewToggle } from '@/components/analytics/habit-ticker-view';
```

---

## 🎯 Next Steps

### Phase 1: Basic Analytics (DONE ✅)
- ✅ Time-series charts
- ✅ Summary statistics
- ✅ Ticker view with % changes
- ✅ Two view modes

### Phase 2: AI Integration (Next)
Use `habit_logs_time_range.pipe` to power AI chat:

```typescript
// User asks: "How many times did I meditate last month?"
const response = await fetch(
  '/api/analytics/habits/time-range?' +
  'start_date=2025-10-01&end_date=2025-10-31&habit_id=meditation_id'
);

// AI processes and responds:
"You meditated 18 times in October, averaging 12 minutes per session."
```

### Phase 3: Advanced Analytics (Later)
- Biometric correlations (Whoop + habits)
- Anomaly detection
- Pattern discovery
- Predictive insights

---

## 📋 Summary of Your Pipe Architecture

| Pipe | Purpose | Powering |
|------|---------|----------|
| `user_habits_summary` | Overview + comparisons | Summary cards, Ticker view |
| `habit_trends` | Time-series data | Chart view |
| `habit_logs_time_range` | Flexible queries | AI chat (future) |
| `whoop_analytics` | Biometric data | Whoop integrations |
| `recent_habit_logs` | Latest entries | Activity feed |

**Total: 5 focused pipes** - Simple, maintainable, powerful

---

## ✨ You Now Have:

✅ **Clean data foundation** (what, when, how much)  
✅ **Time-based comparisons** (% changes over 7d/30d)  
✅ **Two visualization modes** (Charts + Ticker)  
✅ **Finance-style UI** (Perplexity-inspired)  
✅ **Scalable architecture** (ready for AI integration)  

**Ship it! 🚀**
