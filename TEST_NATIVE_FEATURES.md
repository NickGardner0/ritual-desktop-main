# Testing Native Features with Webview Approach

## Quick Test Checklist

After starting the desktop app with the new two-process architecture, verify these features still work:

### ✅ Basic Tauri APIs
- [ ] Window controls (minimize, maximize, close)
- [ ] Window resizing and dragging
- [ ] System tray icon (if you have one)

### ✅ Your Custom Features
- [ ] **Swift Speech Recognition** - Test voice input
- [ ] **Native Timer Widget** - Click "Tracker" button to create timer
- [ ] **File System** - Any file upload/download features
- [ ] **Notifications** - Test if app can send system notifications

### ✅ Performance
- [ ] Desktop app loads in ~2-3 seconds
- [ ] Hot reload works (change code, see it update)
- [ ] No "compiling" message in terminal

## How to Test

1. **Terminal 1:**
   ```bash
   npm run dev
   ```
   Wait for "Ready in Xms"

2. **Terminal 2:**
   ```bash
   npm run desktop
   ```
   Should open instantly!

3. **Test a native feature:**
   - Click the "Tracker" button (⌘T)
   - This should open a native Swift timer window
   - If it works → native features are working! ✅

## Expected Behavior

The desktop app should:
1. Open in 2-3 seconds (not 20+ seconds)
2. All buttons and features work normally
3. Native APIs accessible from JavaScript
4. Hot reload when you change code

## Debugging Native Issues

If native features don't work, check:

```javascript
// In your component
import { invoke } from '@tauri-apps/api/tauri';

// This should work from the webview
const testNative = async () => {
  try {
    const result = await invoke('your_command_name');
    console.log('Native call works!', result);
  } catch (error) {
    console.error('Native call failed:', error);
  }
};
```

The `@tauri-apps/api` package works the same whether Next.js is bundled or loaded via URL!

