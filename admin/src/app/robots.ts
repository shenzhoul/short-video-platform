import type { MetadataRoute } from 'next';

/**
 * Nothing in the admin dashboard should be crawled.
 *
 * Paired with the `robots: { index: false }` metadata in `layout.tsx`, which is
 * the half that survives a direct link — robots.txt only asks a crawler not to
 * fetch, while the meta/header tells it not to index what it did fetch.
 *
 * Neither is access control. The API enforces admin role on every request; this
 * only stops the panel being advertised in search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }]
  };
}
