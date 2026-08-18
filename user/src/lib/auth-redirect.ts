export const DEFAULT_POST_LOGIN_REDIRECT_URL = '/';

export const normalizeInternalRedirectUrl = (url: string | null) => {
  if (!url) return null;

  const normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith('/') || normalizedUrl.startsWith('//')) {
    return null;
  }

  return normalizedUrl;
};

export const normalizePostLoginRedirectUrl = (url: string | null) => {
  const normalizedUrl = normalizeInternalRedirectUrl(url);
  if (!normalizedUrl) return null;

  if (normalizedUrl.startsWith('/auth') || normalizedUrl.startsWith('/error')) {
    return DEFAULT_POST_LOGIN_REDIRECT_URL;
  }

  return normalizedUrl;
};
