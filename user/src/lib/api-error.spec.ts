import { PermissionError } from '@lib/error';

import {
  getApiErrorCode, getApiErrorStatus, isTransportFailure
} from './api-error';

/**
 * Reading an API failure at a call site.
 *
 * Every test here is really one assertion: **the axios shape is not what
 * arrives.** `APIRequest` (`src/services/api-request.ts`) throws `response.data`
 * for anything that is not a 401 or 403, so `error.response.status` is
 * `undefined` inside a component's `catch`. Two auth forms were written against
 * that shape and both silently took their fallback path — one of them rendering
 * a rate-limited address differently from a non-limited one, which is an
 * account-enumeration signal.
 */

describe('the shape APIRequest actually throws', () => {
  it('reads the status off the response body', () => {
    // Verbatim what `throw response?.data` produces for a spent reset link.
    const thrown = { statusCode: 400, message: 'no longer valid', error: 'RESET_TOKEN_INVALID' };

    expect(getApiErrorStatus(thrown)).toBe(400);
    expect(getApiErrorCode(thrown)).toBe('RESET_TOKEN_INVALID');
  });

  it('is not an axios error, which is the whole trap', () => {
    const thrown = { statusCode: 429, message: 'slow down' };

    expect((thrown as any).response).toBeUndefined();
    // A check written as `error.response.status === 429` is dead code here.
    expect(getApiErrorStatus(thrown)).toBe(429);
  });

  it('reports a 429 as something the server answered, not a transport failure', () => {
    // The distinction the forgot-password form depends on.
    expect(isTransportFailure({ statusCode: 429, message: 'slow down' })).toBe(false);
  });
});

describe('the 401 and 403 path', () => {
  it('reads the code out of a PermissionError', () => {
    const error = new PermissionError('forbidden', {
      code: 403,
      message: 'Confirm your email address to continue.',
      error: 'EMAIL_VERIFICATION_REQUIRED'
    });

    expect(getApiErrorStatus(error)).toBe(403);
    expect(getApiErrorCode(error)).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(isTransportFailure(error)).toBe(false);
  });

  it('survives a PermissionError carrying no details', () => {
    const error = new PermissionError('unauthorized', undefined);

    expect(getApiErrorCode(error)).toBeUndefined();
  });
});

describe('a real axios error, for callers that bypass APIRequest', () => {
  it('reads status and code off the response', () => {
    const error = { response: { status: 400, data: { error: 'RESET_TOKEN_INVALID', message: 'nope' } } };

    expect(getApiErrorStatus(error)).toBe(400);
    expect(getApiErrorCode(error)).toBe('RESET_TOKEN_INVALID');
  });
});

describe('nothing reached the server', () => {
  it.each([
    ['a bare Error', new Error('Network Error')],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'boom']
  ])('reports %s as a transport failure', (_name, value) => {
    // The only case that earns its own message. Everything the server answered
    // is handled by the caller on its own terms.
    expect(isTransportFailure(value)).toBe(true);
    expect(getApiErrorStatus(value)).toBeUndefined();
    expect(getApiErrorCode(value)).toBeUndefined();
  });
});

describe('the functions this module already had still behave', () => {
  it('keeps reading a status from all three shapes', () => {
    expect(getApiErrorStatus({ statusCode: 410 })).toBe(410);
    expect(getApiErrorStatus({ response: { status: 404 } })).toBe(404);
    expect(getApiErrorStatus({ details: { code: 401 } })).toBe(401);
  });
});
