interface ApiErrorShape {
  statusCode?: number;
  message?: string | string[];
  details?: {
    code?: number;
    message?: string;
  };
  /** The API's machine-readable code, e.g. `RESET_TOKEN_INVALID`. */
  error?: string;
  response?: {
    status?: number;
    data?: {
      message?: string | string[];
      error?: string;
    };
  };
}

export type AccessRestrictionReason = 'creator-block' | 'region-block' | 'generic';

export function getApiErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const apiError = error as ApiErrorShape;

  if (typeof apiError.statusCode === 'number') {
    return apiError.statusCode;
  }

  if (typeof apiError.response?.status === 'number') {
    return apiError.response.status;
  }

  if (typeof apiError.details?.code === 'number') {
    return apiError.details.code;
  }

  return undefined;
}

export function hasApiErrorStatus(error: unknown, status: number): boolean {
  return getApiErrorStatus(error) === status;
}

/**
 * The API's machine-readable refusal code, when it sent one.
 *
 * Codes such as `RESET_TOKEN_INVALID` and `EMAIL_VERIFICATION_REQUIRED` are what
 * a caller should branch on. The `message` beside them is written for a person
 * and is translated, so matching on its text breaks the first time somebody
 * improves the copy.
 *
 * The three shapes are the same ones `getApiErrorStatus` walks, and for the same
 * reason: `APIRequest` throws the response *body* for anything that is not a 401
 * or 403 (so the code sits at `error.error`), a `PermissionError` for those two
 * (`error.details.error`), and a raw axios error only if a caller bypasses it.
 */
export function getApiErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const apiError = error as ApiErrorShape & { details?: { error?: string } };

  if (typeof apiError.error === 'string') {
    return apiError.error;
  }

  if (typeof apiError.details?.error === 'string') {
    return apiError.details.error;
  }

  if (typeof apiError.response?.data?.error === 'string') {
    return apiError.response.data.error;
  }

  return undefined;
}

/**
 * True when nothing reached the API at all — a network failure, an abort, CORS.
 *
 * The distinction matters wherever a refusal *the server made* has to be
 * indistinguishable from success. The forgot-password form is the live example:
 * its rate limit is per address, so rendering a 429 differently from a 200 would
 * make a limited address visibly different from an unlimited one and reopen the
 * account-enumeration channel the generic response exists to close.
 */
export function isTransportFailure(error: unknown): boolean {
  return getApiErrorStatus(error) === undefined;
}

export function getApiErrorMessage(error: unknown, fallback = ''): string {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const apiError = error as ApiErrorShape;

  if (typeof apiError.details?.message === 'string') {
    return apiError.details.message;
  }

  const responseMessage = apiError.response?.data?.message;
  if (typeof responseMessage === 'string') {
    return responseMessage;
  }

  if (Array.isArray(responseMessage)) {
    const [firstMessage] = responseMessage;
    return typeof firstMessage === 'string' ? firstMessage : fallback;
  }

  if (typeof apiError.message === 'string') {
    return apiError.message;
  }

  if (Array.isArray(apiError.message)) {
    const [firstMessage] = apiError.message;
    return typeof firstMessage === 'string' ? firstMessage : fallback;
  }

  return fallback;
}

export function getAccessRestrictionReason(error: unknown): AccessRestrictionReason | undefined {
  const message = getApiErrorMessage(error, '').toLowerCase();
  if (!message) {
    return undefined;
  }

  if (
    message.includes('your country has been blocked by this model')
    || message.includes('restricted in your region')
    || message.includes('access denied from your location')
  ) {
    return 'region-block';
  }

  if (
    message.includes('you have been blocked by this model')
    || message.includes('this creator profile is not available to you')
  ) {
    return 'creator-block';
  }

  return 'generic';
}
