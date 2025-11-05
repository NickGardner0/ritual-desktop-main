# Desktop Development Setup

Following Midday's architecture: separate web server + desktop wrapper for **instant load times**!

## Architecture

```
┌─────────────────────────────────────────┐
│  Tauri Desktop App (loads webview)     │
│  ↓ Points to                            │
│  http://localhost:3000                   │
└─────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│  Next.js Dev Server (Port 3000)         │
│  Your full app - pre-compiled & cached  │
└─────────────────────────────────────────┘
```

## Development Workflow

### Terminal 1: Start Next.js
```bash
npm run dev
```
Wait for "Ready in Xms" message. This stays running.

### Terminal 2: Start Tauri Desktop
```bash
npm run desktop
```
Opens instantly! ⚡ (~2-3 seconds)

## Benefits

✅ **Instant desktop app loads** (~2-3s instead of 20s)  
✅ **Next.js stays fast** - pre-compiled and cached  
✅ **All native features work** - Tauri APIs, Swift code, etc.  
✅ **Easy debugging** - inspect Next.js in browser, desktop separately  
✅ **Hot reload** - changes reflect immediately in desktop app  

## Native Features Still Work!

The desktop app is a webview pointing to localhost, but you have **full native access**:

- ✅ File system operations
- ✅ System notifications
- ✅ Native menus & shortcuts
- ✅ System tray
- ✅ Your Swift speech recognition
- ✅ Native timer widgets
- ✅ All `@tauri-apps/api` features

## Production Build

For production, Tauri bundles the Next.js export:

```bash
npm run build        # Build Next.js
npm run tauri:build  # Bundle into desktop app
```

## Troubleshooting

**"Failed to connect" error?**  
→ Make sure Next.js is running on port 3000 first

**Changes not showing?**  
→ Next.js hot reload works automatically, just refresh if needed

**Native features not working?**  
→ They should work! The webview can call Tauri APIs normally

