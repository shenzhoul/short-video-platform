# File Server Agent Guide

Start with `../.agents/instructions`.

## Read In This Area

1. `../.agents/project-structure.md`
2. `../.agents/rules/shared.md`
3. `../.agents/rules/api.md`
4. For new features, refactors, or structural changes:
   - `../.agents/rules/maintenance.md`
   - `../.agents/checklists/feature-update.md`
5. Research the nearest implementation in `src/controllers/` and `src/services/` before adding a new pattern.

## Key Folders

- `src/controllers/internal/`: signed upload and internal file APIs
- `src/controllers/health/`: health checks
- `src/services/file/`: file orchestration
- `src/services/tus/`: resumable upload flows
- `src/services/monitoring/`: monitoring hooks

## Skills

Load the matching repo skill before changing specialized workflows:

- `../.agents/skills/file-service-integration/SKILL.md`
- `../.agents/skills/queue-message/SKILL.md`
- `../.agents/skills/media-response-standardization/SKILL.md`

Supplement with vendored general-purpose skills when the task calls for them:

- `../.agents/skills/api-test-suite-builder/SKILL.md`
- `../.agents/skills/dependency-auditor/SKILL.md`
- `../.agents/skills/security-best-practices/SKILL.md`
- `../.agents/skills/code-reviewer/SKILL.md`
- `../.agents/skills/focused-fix/SKILL.md`
- `../.agents/skills/gh-fix-ci/SKILL.md`

## Minimum Delivery Bar

- Keep controllers thin and put upload, storage, and processing logic in services.
- Follow the same DTO, payload, scheduling, and service-layer rules used by `api/` unless the file-server implementation clearly requires something different.
- Add focused tests when introducing file-server test infrastructure; the current package has no test script.
- Run `yarn lint` and `yarn build` before finishing file-server code changes.
