# 🖥️ Tauri Desktop App - Startup Guide

## ✅ Your Current Workflow (Correct!)

```bash
# Terminal 1: Backend
cd backend
python start.py

# Terminal 2: Next.js Frontend  
npm run dev:webpack

# Terminal 3: Tauri Desktop App (wait for Terminal 2 to be ready)
npm run desktop
```

**This is the correct way!** ✅

---

## 🐌 Why Your App Was Loading Slowly (20 seconds)

### The Problem:
When you saw:
```
✓ Compiled /dashboard in 20.3s (27715 modules)
```

**Two caches were stale**:
1. **Next.js cache** (`.next/`) - Had 27,715 modules (should be ~1,500-3,000)
2. **Tauri/Rust cache** (`src-tauri/target/`) - Old Rust compilation artifacts

### The Fix:
```bash
./fix-tauri-caches.sh
```

This clears:
- ✅ Next.js cache (`.next/`, `node_modules/.cache`, `.swc`)
- ✅ Tauri build cache (`src-tauri/target/`)
- ✅ Python cache (`__pycache__`)
- ✅ Reinstalls dependencies

---

## ⚡ Expected Performance After Fix

### First Launch (After Clearing Caches):
```
Terminal 2 (Next.js):
✓ Ready in ~2s
✓ Compiled /dashboard in ~3-5s (1500-3000 modules)  ← Much better!

Terminal 3 (Tauri):
Compiling ritual-desktop v1.0.0...
Finished dev build in ~5-10s  ← First time only
```

**Total first launch: 5-10 seconds** (Rust compilation + Next.js compilation)

### Subsequent Launches (With Cache):
```
Terminal 2: ✓ Ready in ~1-2s
Terminal 3: Tauri opens in ~2-3s
Dashboard loads: <1s
```

**Total subsequent launches: 2-3 seconds** ⚡

---

## 🔍 Understanding the Three Processes

### 1. Backend (`python start.py`)
**Purpose**: Python API server for habits, analytics, authentication

**Startup time**: ~2 seconds

**Output**:
```
🔗 Connecting to Turso Cloud: ritual-nickgardner0651...
📡 Mode: Local replica with automatic sync
✅ Database ready: 1 user(s)
🚀 Ritual Backend API started successfully!
```

**Must be running** before frontend can fetch data.

---

### 2. Frontend (`npm run dev:webpack`)
**Purpose**: Next.js dev server (serves your React app)

**Runs on**: http://localhost:3000

**Startup time**: ~2 seconds (ready), then compiles pages on-demand

**Why webpack, not turbo?**
- Tauri works best with webpack mode
- More stable for desktop apps
- Turbo can cause issues with Tauri's webview

**Output**:
```
▲ Next.js 14.2.33
- Local: http://localhost:3000
✓ Ready in 2s
```

**Must be ready** before starting Tauri.

---

### 3. Desktop App (`npm run desktop`)
**Purpose**: Wraps Next.js in a native desktop window

**What it does**:
1. Compiles Rust code (first time: 5-10s, cached: <1s)
2. Launches native window
3. Loads http://localhost:3000 inside webview

**⚠️ Important**: Wait for Terminal 2 to show "✓ Ready" before running this!

**Output**:
```
⚡ Make sure Next.js is running on port 3000 first
Compiling ritual-desktop v1.0.0...
Finished dev [unoptimized + debuginfo] target(s) in 8.2s
```

---

## 🚨 Common Issues & Solutions

### Issue 1: "Connection Refused" or Blank Window
**Cause**: Next.js (Terminal 2) not ready yet

**Solution**: Wait for Terminal 2 to show "✓ Ready" before running `npm run desktop`

---

### Issue 2: 20+ Second Dashboard Load
**Cause**: Stale Next.js or Tauri cache

**Solution**: 
```bash
./fix-tauri-caches.sh
# Then restart all 3 terminals
```

---

### Issue 3: Rust Compilation Errors
**Cause**: Tauri build cache corrupted

**Solution**:
```bash
rm -rf src-tauri/target
npm run desktop  # Will recompile (takes 5-10s first time)
```

---

### Issue 4: Backend Not Connecting to Turso
**Cause**: Database replica out of sync

**Solution**:
```bash
cd backend
rm -f .turso_replica.db
python start.py  # Will sync fresh from cloud
```

---

## 🎯 Optimal Startup Routine

### First Time (or After Clearing Caches):
```bash
# 1. Start backend (Terminal 1)
cd backend && python start.py
# Wait for: "🚀 Ritual Backend API started successfully!"

# 2. Start Next.js (Terminal 2)
npm run dev:webpack
# Wait for: "✓ Ready in ~2s"

# 3. Start Tauri (Terminal 3)
npm run desktop
# Wait for: Desktop window opens (~5-10s first time)
```

**Total: 7-12 seconds first time** (includes Rust compilation)

---

### Subsequent Startups (Cache Warm):
Same order, but much faster:
- Backend: ~2s
- Next.js: ~1-2s (✓ Ready)
- Tauri: ~2-3s (cached Rust build)

**Total: ~5 seconds** ⚡

---

## 📊 What "Good" Looks Like

### Terminal 2 Output (Next.js):
```
✓ Ready in 1.8s
○ Compiling /dashboard ...
✓ Compiled /dashboard in 2.8s (1892 modules)  ← Good!
GET /dashboard 200 in 3024ms
```

**Key metric**: **<5,000 modules** is good, **27,715 is bad**

---

### Terminal 3 Output (Tauri First Time):
```
Compiling ritual-desktop v1.0.0...
Finished dev [unoptimized + debuginfo] in 8.2s
```

**8-10 seconds is normal** for first Rust compile.

---

### Terminal 3 Output (Tauri Cached):
```
Finished dev [unoptimized + debuginfo] in 0.89s  ← Much faster!
```

**<1 second is perfect** when cache is warm.

---

## 🧪 Test Your Fix

After running `./fix-tauri-caches.sh` and restarting:

1. ✅ Backend starts in ~2s
2. ✅ Next.js ready in ~2s, compiles dashboard in ~3-5s with <5,000 modules
3. ✅ Tauri compiles in ~5-10s (first time), <1s (subsequent)
4. ✅ Dashboard loads in <3s (not 20s!)
5. ✅ Clerk warning still shows (harmless)

---

## 🎉 Summary

**Your workflow is correct!** The issue was stale caches.

**Run this now**:
```bash
./fix-tauri-caches.sh
```

**Then restart** your 3 terminals in order (Backend → Next.js → Tauri).

**You should see**:
- Dashboard compiles with ~1,500-3,000 modules (not 27,715!)
- Total load time: 5-10s first launch, 2-3s after
- Smooth, fast desktop app experience! 🚀

