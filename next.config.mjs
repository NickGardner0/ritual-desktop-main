/** @type {import('next').NextConfig} */
const nextConfig = {
  // Output as static files for Tauri
  output: process.env.TAURI_BUILD ? 'export' : undefined,
  
  // Disable strict mode in production builds to avoid double-rendering issues
  reactStrictMode: false,
  
  // Add headers for Tauri webview compatibility
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization',
          },
        ],
      },
    ];
  },
}

export default nextConfig
