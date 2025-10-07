# Ritual Desktop

A desktop version of the Ritual habit tracking app built with Tauri and Next.js.

## Prerequisites

- Node.js (v18 or higher)
- Rust (for Tauri)
- Your existing FastAPI backend running

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start your FastAPI backend:**
   Make sure your backend is running on `http://localhost:8000`

3. **Run the desktop app in development:**
   ```bash
   npm run tauri:dev
   ```

## Building for Production

1. **Build the app:**
   ```bash
   npm run tauri:build
   ```

The built app will be in `src-tauri/target/release/bundle/`.

## Configuration

- **Backend URL**: Edit `API_BASE_URL` in `app/page.tsx` to change the backend endpoint
- **Window settings**: Edit `src-tauri/tauri.conf.json` to customize the window size and behavior

## Features

- ✅ Connects to your existing FastAPI backend
- ✅ Uses the same shadcn/ui components as your web app
- ✅ Native desktop performance
- ✅ Cross-platform (macOS, Windows, Linux)

## Development

- The app runs on port 3001 to avoid conflicts with your web app
- All your existing components and styles are preserved
- The same API endpoints are used as your web version

## Troubleshooting

- **Backend connection issues**: Make sure your FastAPI backend is running on the correct port
- **Build failures**: Ensure Rust is properly installed and configured
- **Missing dependencies**: Run `npm install` to install all required packages 