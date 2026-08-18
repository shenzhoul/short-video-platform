# API Agent Guide

Start with `../.agents/instructions`.

## Read In This Area

1. `../.agents/project-structure.md`
2. `../.agents/rules/shared.md`
3. `../.agents/rules/api.md`
4. For new features, refactors, or structural changes:
   - `../.agents/rules/maintenance.md`
   - `../.agents/checklists/feature-update.md`
5. Research the nearest implementation in `src/` before adding a new pattern.

## Key Folders

- `src/controllers/`: HTTP adapters
- `src/services/`: business logic and orchestration
- `src/dtos/`: response DTOs and mapping helpers
- `src/payloads/`: validated controller inputs
- `src/jobs/`: scheduled and background work
- `src/listeners/`: event adapters
- `src/gateways/socket/`: socket adapters

## Skills

Load the matching repo skill before changing specialized workflows:

- `../.agents/skills/queue-message/SKILL.md`
- `../.agents/skills/system-settings/SKILL.md`
- `../.agents/skills/media-response-standardization/SKILL.md`
- `../.agents/skills/file-service-integration/SKILL.md`
- `../.agents/skills/websocket-integration/SKILL.md`

Supplement with vendored general-purpose skills when the task calls for them:

- `../.agents/skills/api-design-reviewer/SKILL.md`
- `../.agents/skills/api-test-suite-builder/SKILL.md`
- `../.agents/skills/dependency-auditor/SKILL.md`
- `../.agents/skills/security-best-practices/SKILL.md`
- `../.agents/skills/code-reviewer/SKILL.md`
- `../.agents/skills/focused-fix/SKILL.md`
- `../.agents/skills/gh-fix-ci/SKILL.md`

## Minimum Delivery Bar

- Keep controllers, listeners, jobs, and gateways thin. Put business logic in services.
- Keep controller filename prefixes aligned with route prefixes:
  - admin surface: `admin-*.controller.ts` with `/admin/...`
  - creator surface: `creator-*.controller.ts` with `/creator/...`
  - normal user or public surface: no `admin-` or `creator-` prefix, for example `user.controller.ts` with `/users`
- Use payload classes for controller inputs and DTOs for controller-facing responses.
- Treat DTOs as the response privacy boundary and expose only intentionally mapped fields.
- Add focused Jest unit tests beside touched services using the `.spec.ts` suffix.
- Run `yarn test` and `yarn build` before finishing API code changes. The API package has no lint script.
- Add a migration when persistent data or system settings change.
