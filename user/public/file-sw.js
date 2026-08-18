/**
 * Service Worker for Caching Signed URLs
 *
 * This service worker implements caching for signed URLs from the file server.
 * It handles:
 * - Intercepting fetch requests to signed URLs
 * - Caching responses with appropriate expiration
 * - Automatic cache invalidation when URLs expire
 * - Background refresh of expiring URLs
 */

const CACHE_NAME = 'douyin-clone-files-v1';
// Pattern for file download URLs - either our custom /files/download or S3 URLs
const SIGNED_URL_PATTERN = /\/files\/download\?key=/;
const CACHE_EXPIRY_BUFFER = 5 * 60 * 1000; // 5 minutes buffer before expiry

// Install event - set up cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      ).then(() => {
        return self.clients.claim();
      });
    })
  );
});

// Extract expiration time from signed URL
function getExpiryFromUrl(url) {
  try {
    const urlObj = new URL(url);

    // Check for expiresIn parameter (from API responses or modified URLs)
    const expiresIn = urlObj.searchParams.get('expiresIn');
    if (expiresIn) {
      const expiresInSeconds = parseInt(expiresIn, 10);
      return Date.now() + (expiresInSeconds * 1000);
    }

    // Check for X-Amz-Expires (S3)
    const amzExpires = urlObj.searchParams.get('X-Amz-Expires');
    if (amzExpires) {
      const expiresInSeconds = parseInt(amzExpires, 10);
      return Date.now() + (expiresInSeconds * 1000);
    }

    // Check for JWT token in 'key' parameter (download endpoint)
    const key = urlObj.searchParams.get('key');
    if (key) {
      try {
        // JWT format: header.payload.signature
        const payload = key.split('.')[1];
        if (payload) {
          // Decode base64 payload
          const decodedPayload = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
          if (decodedPayload.exp) {
            // exp is in seconds since epoch
            return decodedPayload.exp * 1000;
          }
        }
      } catch (jwtError) {
        // Failed to decode JWT token from key
      }
    }

    // Check for JWT token in 'hash' parameter (direct file URLs)
    const hash = urlObj.searchParams.get('hash');
    if (hash) {
      try {
        // JWT format: header.payload.signature
        const payload = hash.split('.')[1];
        if (payload) {
          // Decode base64 payload
          const decodedPayload = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
          if (decodedPayload.exp) {
            // exp is in seconds since epoch
            return decodedPayload.exp * 1000;
          }
        }
      } catch (jwtError) {
        // Failed to decode JWT token from hash
      }
    }
  } catch (error) {
    // Failed to parse URL expiry
  }
  return null;
}

// Check if URL is a signed file URL
function isSignedFileUrl(url) {
  // Our custom signed URLs: /files/download?key=jwt_token
  if (SIGNED_URL_PATTERN.test(url)) {
    return true;
  }

  // Direct file URLs with hash and expiresIn parameters
  if (url.includes('hash=') && url.includes('expiresIn=')) {
    return true;
  }

  // S3 signed URLs: contain X-Amz-Expires or X-Amz-Signature
  if (url.includes('X-Amz-Expires') || url.includes('X-Amz-Signature')) {
    return true;
  }

  // URLs with expiresIn parameter (from API responses)
  if (url.includes('expiresIn=')) {
    return true;
  }

  return false;
}

// Check if cached response is still valid
function isResponseValid(expiresAt) {
  return expiresAt > (Date.now() + CACHE_EXPIRY_BUFFER);
}

// Fetch event - intercept and cache signed URLs
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  // Only handle GET requests for signed file URLs
  if (request.method !== 'GET' || !isSignedFileUrl(url)) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Try to get from cache first
      const cachedResponse = await cache.match(request);

      if (cachedResponse) {
        // Check if cached response has expiry metadata
        const expiresAt = parseInt(cachedResponse.headers.get('x-cache-expires-at') || '0', 10);

        if (isResponseValid(expiresAt)) {
          return cachedResponse;
        } else {
          // Cache expired, fetching fresh
          // Remove expired cache entry
          await cache.delete(request);
        }
      }

      // Fetch fresh response
      try {
        const response = await fetch(request.clone());

        if (response.ok) {
          // Calculate expiry time
          const expiresAt = getExpiryFromUrl(url) || (Date.now() + 3600000); // Default 1 hour

          // Clone response and add cache metadata
          const responseClone = response.clone();
          const responseWithMetadata = new Response(responseClone.body, {
            status: responseClone.status,
            statusText: responseClone.statusText,
            headers: {
              ...Object.fromEntries(responseClone.headers.entries()),
              'x-cache-expires-at': expiresAt.toString(),
              'x-cache-cached-at': Date.now().toString(),
            }
          });

          // Cache the response
          await cache.put(request, responseWithMetadata);

          return response;
        }

        return response;
      } catch (error) {

        // If we have a cached response, serve it even if expired
        if (cachedResponse) {
          return cachedResponse;
        }

        throw error;
      }
    })
  );
});

// Message event - handle cache management messages from main thread
self.addEventListener('message', (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'CLEAR_CACHE':
      caches.delete(CACHE_NAME).then(() => {
        event.ports[0]?.postMessage({ success: true });
      });
      break;

    case 'GET_CACHE_INFO':
      caches.open(CACHE_NAME).then((cache) => {
        cache.keys().then((requests) => {
          const cacheInfo = requests.map(req => ({
            url: req.url,
            method: req.method
          }));
          event.ports[0]?.postMessage({ cacheInfo });
        });
      });
      break;

    case 'PRELOAD_URLS':
      // Preload multiple URLs into cache
      Promise.all(
        data.urls.map(async (url) => {
          try {
            const response = await fetch(url);
            if (response.ok) {
              const cache = await caches.open(CACHE_NAME);
              const expiresAt = getExpiryFromUrl(url) || (Date.now() + 3600000);
              const responseWithMetadata = new Response(response.clone().body, {
                status: response.status,
                statusText: response.statusText,
                headers: {
                  ...Object.fromEntries(response.headers.entries()),
                  'x-cache-expires-at': expiresAt.toString(),
                  'x-cache-cached-at': Date.now().toString(),
                }
              });
              await cache.put(new Request(url), responseWithMetadata);
            }
          } catch (error) {
            // Failed to preload
          }
        })
      ).then(() => {
        event.ports[0]?.postMessage({ success: true, preloaded: data.urls.length });
      });
      break;

    default:
    // Unknown message type
  }
});

// Periodic cleanup of expired cache entries
setInterval(async () => {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();

    let cleaned = 0;
    for (const request of requests) {
      const response = await cache.match(request);
      if (response) {
        const expiresAt = parseInt(response.headers.get('x-cache-expires-at') || '0', 10);
        if (!isResponseValid(expiresAt)) {
          await cache.delete(request);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      // Cleaned expired cache entries
    }
  } catch (error) {
    // Cache cleanup failed
  }
}, 60000); // Run every minute