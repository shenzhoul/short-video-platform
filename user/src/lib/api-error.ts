interface ApiErrorShape {
  statusCode?: number;
  message?: string | string[];
  details?: {
    code?: number;
    message?: string;
  };
  response?: {
    status?: number;
    data?: {
      message?: string | string[];
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
