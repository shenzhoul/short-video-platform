export const DEFAULT_POST_LOGIN_REDIRECT_URL = '/';

export const normalizeInternalRedirectUrl = (url: string | null) => {
  if (!url) return null;

  const normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith('/') || normalizedUrl.startsWith('//')) {
    return null;
  }

  return normalizedUrl;
};
