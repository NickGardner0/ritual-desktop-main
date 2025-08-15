/** @type {import('next').NextConfig} */
const nextConfig = {
  // Removed output: 'export' for desktop app
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  env: { // Added env block
    NEXT_PUBLIC_SUPABASE_URL: 'https://bvwgycgdmrozxfmyxpuy.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2d2d5Y2dkbXJvenhmbXl4cHV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzczNDEwMDIsImV4cCI6MjA1MjkxNzAwMn0.ENcTaG68l8hZS8jW8nne8gqQuSqtdknJ5gck-Pg5PCg',
  },
}

export default nextConfig 