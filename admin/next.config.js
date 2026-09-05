/**
 * Vercel collects the built app from Next's DEFAULT output directory.
 *
 * Its Next.js builder looks for `<rootDirectory>/.next` after the build, and a
 * custom `distDir` is not what it reads — the user app's deployment failed at
 * finalization with "could not find /vercel/path0/user/.next" while the build
 * itself had succeeded into `dist/.next`. Setting Vercel's own "Output
 * Directory" to `dist/.next` does not help either: for a Next project that
 * field does not redirect where the framework's output is collected from.
 *
 * So on Vercel the key is left unset entirely and Next uses `.next`. Locally
 * `dist/.next` is preserved, which keeps this app's build output beside the
 * user app's and out of the repository root.
 *
 * `VERCEL` is set to "1" by Vercel for every build and every runtime, which is
 * why it is the detector rather than a hardcoded path or a branch name.
 */
const isVercelBuild = !!process.env.VERCEL;

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

  // Custom build directory, except on Vercel (see `isVercelBuild` above).
  ...(isVercelBuild ? {} : { distDir: 'dist/.next' }),

  /*
    Ship a self-contained server for the container image — same reasoning as
    the user app: the target VM is 2 vCPU / 4 GB already running MongoDB,
    Redis, the API and the file server. Standalone traces only the modules the
    server imports, so the image carries tens of megabytes rather than the
    whole node_modules tree.

    Additive: `next build` and `next start` are unchanged locally.
  */
  output: 'standalone',

  /*
    Pin the trace root to this app.

    Next otherwise infers it by walking up for lockfiles, and `admin` sits
    beside `user`, `api`, `file-server` and `shared/` — each with their own.
    An inferred repo-level root would nest the standalone output under
    `standalone/admin/`, silently changing the paths deploy/admin.Dockerfile
    copies. Pinning it makes `server.js` land at the root of `standalone/`,
    matching the user app.
  */
  outputFileTracingRoot: __dirname,

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
