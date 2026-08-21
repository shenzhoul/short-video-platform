---
name: api-auth-guards
description: Authentication and authorization guard patterns for the Douyin Clone NestJS API. Use when protecting controllers, loading the current user, enforcing admin or creator roles, or extracting authenticated identity.
---

# API Auth Guards

Read `api/src/common/guards/`, the target controller, and the called service before changing access control.

## Choose The Guard

- Use `AuthGuard` when a valid authenticated session is mandatory.
- Use `LoadUser` when a route may continue without a user but should attach one when credentials are valid.
- Use `RoleGuard` with the existing role decorators for audience-restricted controllers.
- Preserve `CustomThrottlerGuard` where the nearest controller applies rate limiting.

Do not treat a guard as the only authorization layer. Services must still validate ownership and feature-specific eligibility.

## Current References

- `api/src/common/guards/auth.guard.ts`
- `api/src/common/guards/user.guard.ts`
- `api/src/common/guards/role.guard.ts`
- `api/src/common/decorators/auth-user.decorator.ts`
- `api/src/controllers/content/post/creator-post.controller.ts`
- `api/src/controllers/identity/user/admin-user.controller.ts`

## Verification

- Check anonymous, authenticated, wrong-role, and correct-role behavior.
- Verify the service rejects unauthorized ownership mutations.
- Run `yarn build` in `api/`.
