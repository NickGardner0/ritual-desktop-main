/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Configuration for Tauri desktop app
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  devIndicators: false, // Key setting from Midday - disables dev indicators
  swcMinify: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // Webpack configuration for Tauri compatibility
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
  env: { // Added env block
    NEXT_PUBLIC_SUPABASE_URL: 'https://bvwgycgdmrozxfmyxpuy.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2d2d5Y2dkbXJvenhmbXl4cHV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzczNDEwMDIsImV4cCI6MjA1MjkxNzAwMn0.ENcTaG68l8hZS8jW8nne8gqQuSqtdknJ5gck-Pg5PCg',
  },
}

export default nextConfig 