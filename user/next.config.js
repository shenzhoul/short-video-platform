/**
 * @type { import('next').NextConfig }
 */
let withBundleAnalyzer;

try {
  withBundleAnalyzer = require('@next/bundle-analyzer')({
    enabled: process.env.ANALYZE === 'true'
  });
} catch {
  // Fallback if @next/bundle-analyzer is not available (e.g., in production)
  withBundleAnalyzer = (config) => config;
}

const nextConfig = {
  compress: true,
  // react 18 about strict mode https://reactjs.org/blog/2022/03/29/react-v18.html#new-strict-mode-behaviors
  reactStrictMode: false,
  distDir: 'dist/.next',
  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    // !! WARN !!
    // ignoreBuildErrors: true
  },
  images: {
    // Disable image optimization for export
    unoptimized: true,
    minimumCacheTTL: 60 * 60 * 7, // 7 days
    remotePatterns: [{
      protocol: 'https',
      hostname: '**.googleusercontent.com'
    }, {
      protocol: 'http',
      hostname: 'localhost'
    }, {
      protocol: 'https',
      hostname: 'localhost'
    }],
    formats: ['image/webp']
  },
  experimental: {
    scrollRestoration: true
  },
  // Clean build configuration
  trailingSlash: false,
  outputFileTracingRoot: __dirname,
  // Increase timeout for static generation
  staticPageGenerationTimeout: 60,
  // Skip static generation for error pages
  generateBuildId: async () => `build-${Date.now()}`,
  // rewrites() {
  //   return {
  //     afterFiles: [{
  //       // default landing page is login page
  //       source: '/',
  //       destination: '/auth/login'
  //     }]
  //   };
  // },
  poweredByHeader: false,
  // `@douyin-clone/shared-toast` is installed from `shared/toast` and ships
  // TypeScript source, so Next has to compile it rather than treat it as a
  // prebuilt dependency.
  transpilePackages: [
    'rc-picker',
    '@douyin-clone/shared-toast'
  ],
  env: {
    // Server-side environment variables
    API_SERVER_ENDPOINT: process.env.API_SERVER_ENDPOINT || process.env.API_ENDPOINT,
    // Make NEXT_PUBLIC_* available on server-side runtime too (explicit)
    NEXT_PUBLIC_API_ENDPOINT: process.env.NEXT_PUBLIC_API_ENDPOINT,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    SITE_URL: process.env.SITE_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    PROXY_API_TARGET: process.env.PROXY_API_TARGET
  },

  /**
   * Proxy Configuration
   *
   * Browser traffic reaches the backend through two rewrites, both pointing at the API:
   *
   * 1. /api/v1/* -> API server (default: localhost:8080), with the /api/v1 prefix stripped
   *    because the API has no global route prefix.
   * 2. /socket.io/* -> the same target, path preserved, so WebSocket upgrades are forwarded.
   *
   * Files are deliberately NOT proxied. The client asks the API for an upload target and then
   * talks to the file server directly, so the file-server location is configured API-side through
   * FILE_SERVER_BASE_URL rather than here.
   *
   * Environment Variables:
   * - PROXY_API_TARGET: Target URL for API server (fallback: http://localhost:8080)
   *
   * See user/src/PROXY_SETUP.md for the full routing picture.
   */
  /**
   * Legacy Creator Management routes.
   *
   * Publishing used to live under /post while management was added under /creator, which split one
   * section across two namespaces. Everything now lives under /creator/*; these keep old links,
   * bookmarks and open tabs working.
   *
   * Handled here rather than by redirecting page components so there is exactly one implementation
   * of each screen. Sources are exact paths, so nothing else under /post is affected, and Next
   * forwards the query string automatically — `?enter_from=…` and `?tab=uploadGraphic` survive.
   *
   * Temporary (307) on purpose: a permanent redirect is cached hard by browsers and is painful to
   * walk back if these paths move again.
   */
  async redirects() {
    return [
      { source: '/post', destination: '/creator/publish', permanent: false },
      { source: '/post/create', destination: '/creator/publish/video', permanent: false },
      { source: '/post/image', destination: '/creator/publish/image', permanent: false }
    ];
  },

  async rewrites() {
    // Get proxy targets from environment variables with fallback defaults.
    // Prefer NEXT_PUBLIC_* values (set via build args / runtime env),
    // fall back to PROXY_* envs (legacy) and finally to localhost defaults.
    const apiTarget = process.env.PROXY_API_TARGET || process.env.NEXT_PUBLIC_API_ENDPOINT || 'http://localhost:8080';

    return [
      // API Server Proxy - handles all /api/v1/* requests
      {
        source: '/api/v1/:path*',
        destination: `${apiTarget}/:path*`
      },
      // Socket.io WebSocket Proxy - handles socket.io connections
      {
        source: '/socket.io/:path*',
        destination: `${apiTarget}/socket.io/:path*`
      }
    ];
  }
};

module.exports = withBundleAnalyzer(nextConfig);
