import { Request } from 'express';
import * as requestIp from 'request-ip';

function normalizeIp(ip?: string | string[] | null): string | null {
  if (!ip) return null;
  const rawIp = Array.isArray(ip) ? ip[0] : ip;
  let normalized = rawIp.split(',')[0]?.trim();

  if (!normalized) return null;

  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice(7);
  }

  if (normalized.includes('.') && normalized.includes(':') && !normalized.includes('::')) {
    normalized = normalized.split(':')[0];
  } else if (normalized.startsWith('[') && normalized.includes(']:')) {
    normalized = normalized.substring(1, normalized.indexOf(']:'));
  } else if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }

  return normalized || null;
}

function normalizeForwardedForIp(ip?: string | string[] | null): string | null {
  if (!ip) return null;
  const rawIp = Array.isArray(ip) ? ip[0] : ip;
  const forwardedChain = rawIp
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  // Public clients can prepend spoofed X-Forwarded-For entries. In the common
  // nginx proxy_add_x_forwarded_for setup, the proxy appends the real socket
  // client at the end, so use the right-most value for a stable abuse key.
  return normalizeIp(forwardedChain[forwardedChain.length - 1]);
}

function isLoopbackOrPrivate(ip?: string | null): boolean {
  if (!ip) return false;
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'].includes(ip)) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;

  const [first, second] = ip.split('.').map((part) => parseInt(part, 10));
  return first === 172 && second >= 16 && second <= 31;
}

function getRemoteAddress(req: Request | Record<string, any>): string | null {
  return normalizeIp(
    req.socket?.remoteAddress
    || req.connection?.remoteAddress
    || req.ip
  );
}

function shouldTrustProxyHeaders(req: Request | Record<string, any>, remoteAddress: string | null): boolean {
  if (['true', '1'].includes(String(process.env.TRUST_PROXY_HEADERS).toLowerCase())) {
    return true;
  }

  const trustedProxies = (process.env.TRUSTED_PROXY_IPS || '')
    .split(',')
    .map((ip) => normalizeIp(ip))
    .filter(Boolean);

  if (remoteAddress && trustedProxies.includes(remoteAddress)) {
    return true;
  }

  return isLoopbackOrPrivate(remoteAddress);
}

function getProxyHeaderIp(req: Request | Record<string, any>): string | null {
  return normalizeIp(req.headers?.['x-detected-real-ip'])
    || normalizeIp(req.headers?.['x-real-ip'])
    || normalizeIp(req.headers?.['cf-connecting-ip'])
    || normalizeIp(req.headers?.['x-client-ip'])
    || normalizeForwardedForIp(req.headers?.['x-forwarded-for']);
}

export function getTrustedClientIp(req: Request | Record<string, any>): string {
  const remoteAddress = getRemoteAddress(req);

  if (shouldTrustProxyHeaders(req, remoteAddress)) {
    const proxyHeaderIp = getProxyHeaderIp(req);
    const detectedIp = normalizeIp(requestIp.getClientIp(req as Request));
    return proxyHeaderIp || detectedIp || remoteAddress || 'unknown';
  }

  return remoteAddress || 'unknown';
}
