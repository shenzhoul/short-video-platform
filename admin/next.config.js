/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // React Strict Mode - Enable for better development experience
  reactStrictMode: true,

  // Explicitly opt into Turbopack defaults in Next.js 16
  turbopack: {},

  // `@douyin-clone/shared-toast` is installed from `shared/toast` and ships
  // TypeScript source, so Next has to compile it rather than treat it as a
  // prebuilt dependency.
  transpilePackages: ['@douyin-clone/shared-toast'],

  // Custom build directory
  distDir: 'dist/.next',

  // Security headers
  poweredByHeader: false,

  // TypeScript configuration
  typescript: {
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors. Remove in production for stricter builds
    ignoreBuildErrors: false
  },

  // Environment variables (use env instead of runtime config for better performance)
  env: {
    API_SERVER_ENDPOINT: process.env.API_SERVER_ENDPOINT,
    SITE_URL: process.env.SITE_URL,
    // Expose NEXT_PUBLIC_* explicitly so they are available during build and at runtime
    NEXT_PUBLIC_API_ENDPOINT: process.env.NEXT_PUBLIC_API_ENDPOINT,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    PROXY_API_TARGET: process.env.PROXY_API_TARGET
  },

  // Experimental features
  experimental: {
    // Server Actions configuration
    serverActions: {
      bodySizeLimit: '2mb',
      allowedOrigins: ['localhost:8082']
    }
  },

  // Compiler options
  compiler: {
    // Remove console.log in production
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn']
    } : false
  },

  // Image optimization
  images: {
    // Disable image optimization for external hosting compatibility
    unoptimized: true,
    // Image formats
    formats: ['image/webp', 'image/avif']
  },

  // Performance optimizations
  compress: true,

  // Bundle analyzer (enable when needed)
  // bundleAnalyzer: {
  //   enabled: process.env.ANALYZE === 'true'
  // },

  /**
   * Proxy Configuration for Admin Panel
   *
   * Browser traffic reaches the backend through a single rewrite:
   *
   * /api/v1/* -> API server (default: localhost:8080), with the /api/v1 prefix stripped because
   * the API has no global route prefix.
   *
   * Files are deliberately NOT proxied. The client asks the API for an upload target and then talks
   * to the file server directly, so the file-server location is configured API-side through
   * FILE_SERVER_BASE_URL rather than here. The admin app also has no socket rewrite because it does
   * not open a socket connection.
   *
   * Environment Variables:
   * - PROXY_API_TARGET: Target URL for API server (fallback: http://localhost:8080)
   *
   * See user/src/PROXY_SETUP.md for the full routing picture.
   */
  async rewrites() {
    // Get proxy targets from environment variables with fallback defaults
    // Prefer NEXT_PUBLIC_* values (set via build args / runtime env), then legacy PROXY_*, then localhost
    const apiTarget = process.env.PROXY_API_TARGET || process.env.NEXT_PUBLIC_API_ENDPOINT || 'http://localhost:8080';

    return [
      // API Server Proxy - handles all /api/v1/* requests
      {
        source: '/api/v1/:path*',
        destination: `${apiTarget}/:path*`
      }
    ];
  },

  // Redirects
  async redirects() {
    return [
      {
        source: '/',
        destination: '/dashboard',
        permanent: true
      }
    ];
  },

  // Headers for security and performance
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          }
        ]
      }
    ];
  }
};

// Export the Next.js configuration directly
module.exports = nextConfig;
