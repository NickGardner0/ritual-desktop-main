# WHOOP Integration - What It Can & Can't Track

**Last Updated:** October 20, 2025  
**Status:** ✅ Fully Functional

---

## ✅ What WHOOP CAN Sync Automatically

### 1. Sleep Duration 🌙
- **Metric:** Total sleep time (hours)
- **API Endpoint:** `/activity/sleep`
- **Updates:** After each sleep session
- **Accuracy:** ✅ Excellent - Direct from WHOOP device
- **Your App:** ✅ Working perfectly (showing 47.97 Hours)

**Data Includes:**
- Total sleep duration
- Sleep performance score
- Sleep stages (REM, slow-wave, light, awake)
- Sleep efficiency percentage

---

### 2. Recovery Score 📊
- **Metric:** Daily recovery score (0-100)
- **API Endpoint:** `/recovery`
- **Updates:** Each morning after sleep
- **Accuracy:** ✅ Excellent - WHOOP's core metric

**Data Includes:**
- Recovery score (0-100)
- HRV (Heart Rate Variability)
- Resting heart rate
- SpO2 percentage
- Skin temperature

**To Enable:**
Create a habit named:
- "Recovery Score" or
- "Recovery" or  
- "Whoop Recovery"

Set it to track **Amount** with unit "Score"

---

### 3. Daily Strain 💪
- **Metric:** Total cardiovascular strain (0-21)
- **API Endpoint:** `/activity/workout` or `/cycle`
- **Updates:** Throughout the day as you exercise
- **Accuracy:** ✅ Excellent - WHOOP's signature metric

**Data Includes:**
- Strain score
- Average heart rate
- Max heart rate
- Calories burned (kilojoules)

**To Enable:**
Create a habit named:
- "Daily Strain" or
- "Strain" or
- "Whoop Strain"

Set it to track **Amount** with unit "Score"

---

### 4. Workout Data 🏃
- **Metric:** Individual workout sessions
- **API Endpoint:** `/activity/workout`
- **Updates:** After each workout
- **Accuracy:** ✅ Excellent

**Data Includes:**
- Workout type (running, cycling, etc.)
- Duration
- Strain contribution
- Heart rate data
- Distance (if available)

---

## ❌ What WHOOP CANNOT Sync

### 1. Daily Steps 👟
- **Status:** ❌ **NOT AVAILABLE**
- **Reason:** WHOOP does not track steps
- **WHOOP's Philosophy:** Focuses on strain/exertion, not step count
- **Their Statement:** "WHOOP measures strain, not steps"

**Alternative:**
- Track steps manually in Ritual
- Use Apple Watch integration (coming soon)
- Use Fitbit integration (coming soon)
- Use phone's built-in step counter

**Why WHOOP Doesn't Track Steps:**
- WHOOP is worn on the wrist (not hip/pocket like traditional pedometers)
- Focuses on cardiovascular strain as a better fitness metric
- Step count doesn't correlate with actual exertion
- Example: 10,000 easy steps ≠ intense 30-min workout

---

### 2. Nutrition/Food Intake 🍽️
- **Status:** ❌ Not tracked by WHOOP
- **Reason:** WHOOP is a fitness/recovery device, not nutrition tracker

---

### 3. Hydration 💧
- **Status:** ❌ Not tracked by WHOOP
- **Alternative:** Manual tracking or use separate app

---

### 4. Meditation/Mindfulness 🧘
- **Status:** ❌ Not directly tracked
- **Note:** WHOOP can detect "rest" but not meditation specifically

---

## 🎯 Recommended WHOOP Habits for Ritual

Based on what WHOOP actually provides, here are the best habits to track:

### Current (Working)
1. ✅ **Sleep Duration** - Already syncing (7.92 hours)
   - Type: Duration
   - Unit: Hours
   - Integration: WHOOP

### Recommended to Add
2. 📊 **Recovery Score** - WHOOP's signature metric
   - Type: Amount
   - Unit: Score (0-100)
   - Integration: WHOOP
   - **Why:** Shows how ready you are for exertion

3. 💪 **Daily Strain** - Total cardiovascular load
   - Type: Amount
   - Unit: Score (0-21)
   - Integration: WHOOP
   - **Why:** Tracks total day's physical stress

### Keep as Manual
4. 👟 **Daily Steps** - Not available via WHOOP
   - Type: Amount
   - Unit: Steps
   - Integration: Manual ✅ (Already updated)
   - **Track:** Input manually or wait for Apple Watch integration

---

## 📱 Future Integration Options

### For Step Counting:
- **Apple Watch** (Coming Soon) - Native step counter
- **Fitbit** (Coming Soon) - Accurate step tracking
- **Google Fit** (Coming Soon) - Android step counter
- **Strava** (Coming Soon) - Activity-based

### Other Wearables:
- **Oura Ring** (Coming Soon) - Sleep, readiness, activity
- **Garmin** (Coming Soon) - Steps, heart rate, VO2 max

---

## 🔄 How WHOOP Sync Works

### Current Sync Flow:
```
1. User clicks "Sync Now" in Integrations
2. Backend fetches last 7 days of data from WHOOP
3. Data is processed and matched to habits:
   - Sleep data → "Sleep Duration" habit
   - Recovery data → "Recovery Score" habit (if exists)
   - Workout data → "Daily Strain" habit (if exists)
4. Habit logs are created/updated in database
5. Dashboard displays new values
```

### What Gets Synced:
- ✅ Sleep: Total duration in hours
- ✅ Recovery: Score (0-100)
- ✅ Strain: Daily strain score (0-21)
- ❌ Steps: Not available from WHOOP

### Frequency:
- **Manual:** Click "Sync Now" anytime
- **Recommended:** Daily (after morning recovery is calculated)
- **Future:** Auto-sync every 6 hours (planned enhancement)

---

## 🐛 Troubleshooting

### "No new data found" after sync
**Possible Causes:**
1. WHOOP device hasn't synced to WHOOP app yet
2. No new sleep/recovery data since last sync
3. Time range issue (check date range in dashboard)

**Solution:**
- Open WHOOP app and ensure it's synced
- Wait until after sleep for recovery data
- Try syncing again in 10 minutes

### "Step count showing 0"
**This is expected!** WHOOP doesn't provide step data.

**Solution:**
- Track steps manually
- Or wait for Apple Watch/Fitbit integration

### OAuth token expired
**Symptoms:** Sync fails with authorization error

**Solution:**
1. Go to Integrations
2. Click "Disconnect" on WHOOP
3. Click "Connect" again
4. Re-authorize
5. Try syncing again

---

## 📊 WHOOP vs. Other Wearables

| Feature | WHOOP | Apple Watch | Fitbit | Oura Ring |
|---------|-------|-------------|--------|-----------|
| Sleep Duration | ✅ Excellent | ✅ Good | ✅ Good | ✅ Excellent |
| Recovery Score | ✅ Signature | ⚠️ Limited | ✅ Good | ✅ Excellent |
| Daily Strain | ✅ Signature | ✅ Activity Rings | ✅ Active Minutes | ⚠️ Limited |
| Step Count | ❌ No | ✅ Yes | ✅ Yes | ⚠️ Limited |
| Heart Rate | ✅ Continuous | ✅ Continuous | ✅ Continuous | ✅ Continuous |
| Workouts | ✅ Auto-detect | ✅ Manual/Auto | ✅ Auto | ⚠️ Limited |

**WHOOP's Strength:** Recovery & strain optimization  
**WHOOP's Weakness:** No step counting

---

## 🎯 Best Practices

### 1. Sync Daily
- Sync every morning after WHOOP calculates recovery
- Ensures all data is up-to-date

### 2. Create All Supported Habits
- Sleep Duration ✅
- Recovery Score ✅
- Daily Strain ✅

### 3. Track Steps Elsewhere
- Use phone's pedometer
- Or wait for Apple Watch integration
- Don't expect steps from WHOOP

### 4. Check WHOOP App First
- Ensure WHOOP device is synced
- Verify data appears in WHOOP app
- Then sync to Ritual

---

## 📚 WHOOP API Endpoints Used

```
Base URL: https://api.prod.whoop.com/developer/v1

✅ /activity/sleep
   - Sleep sessions
   - Sleep stages
   - Sleep performance

✅ /recovery
   - Recovery score
   - HRV, RHR
   - SpO2, skin temp

✅ /activity/workout
   - Individual workouts
   - Strain per workout
   - Heart rate data

✅ /cycle
   - Daily physiological cycles
   - Total strain
   - Kilojoules (energy)
   ❌ Does NOT include steps

❌ /steps (doesn't exist)
```

---

## 🔮 Future Enhancements

### Planned:
1. **Auto-sync** - Background sync every 6 hours
2. **Recovery trends** - Weekly/monthly recovery analytics
3. **Strain optimization** - Recommendations based on recovery
4. **Sleep quality alerts** - Notifications for poor sleep

### With Other Integrations:
1. **Apple Watch** - Step counting, activity rings
2. **Fitbit** - Steps, floors, active minutes
3. **Oura Ring** - Readiness score, body temperature
4. **Strava** - Activity-based tracking

---

## ✅ Summary

**What WHOOP Is Great For:**
- 🌙 Sleep tracking
- 📊 Recovery optimization
- 💪 Training load management
- ❤️ Heart rate monitoring

**What WHOOP Is NOT For:**
- 👟 Step counting (use Apple Watch/Fitbit)
- 🍽️ Nutrition tracking
- 💧 Hydration tracking
- 📍 GPS/Distance (use phone or watch)

**Bottom Line:**
WHOOP is a **recovery-focused wearable**, not a step counter. It excels at helping you understand your body's readiness and strain, but you'll need another device or manual tracking for step counts.

---

**Your Current Setup:** ✅ Perfect!
- Sleep Duration: Syncing from WHOOP
- Daily Steps: Manual tracking
- Future: Add Recovery Score & Daily Strain from WHOOP

🚀 You're all set!

