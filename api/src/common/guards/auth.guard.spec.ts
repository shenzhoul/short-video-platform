import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  function context(authorization?: string) {
    const request = { headers: authorization ? { authorization } : {} } as any;
    return {
      request,
      executionContext: {
        switchToHttp: () => ({ getRequest: () => request })
      } as any
    };
  }

  it('rejects an anonymous request before resolving a user', async () => {
    const tokenService = { validateToken: jest.fn() };
    const authService = { getUserFromTokenData: jest.fn() };
    const guard = new AuthGuard(authService as any, tokenService as any);

    await expect(guard.canActivate(context().executionContext)).resolves.toBe(false);
    expect(tokenService.validateToken).not.toHaveBeenCalled();
    expect(authService.getUserFromTokenData).not.toHaveBeenCalled();
  });

  it('accepts a valid authenticated user and attaches it to the request', async () => {
    const user = { _id: '66b8d12ea3cb73216db87111', status: 'active' };
    const tokenService = { validateToken: jest.fn().mockResolvedValue({ sub: user._id }) };
    const authService = { getUserFromTokenData: jest.fn().mockResolvedValue(user) };
    const guard = new AuthGuard(authService as any, tokenService as any);
    const testContext = context('Bearer valid-token');

    await expect(guard.canActivate(testContext.executionContext)).resolves.toBe(true);
    expect(testContext.request.user).toBe(user);
  });
});
