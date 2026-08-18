# Douyin Clone Agent Guide

Start with `.agents/instructions`.

## Read Order

1. Repo map and ownership: `.agents/project-structure.md`
2. Shared rules: `.agents/rules/shared.md`
3. For new features, refactors, or structural changes:
   - `.agents/rules/maintenance.md`
   - `.agents/checklists/feature-update.md`
4. Area rules:
   - `api/` and `file-server/`: `.agents/rules/api.md`
   - `user/`: `.agents/rules/user.md`
   - `admin/`: `.agents/rules/admin.md`
5. Local app guides when you are inside that folder:
   - `api/AGENTS.md`
   - `user/AGENTS.md`
   - `admin/AGENTS.md`
   - `file-server/AGENTS.md`
6. Read adjacent product docs under `docs/` and the original requirement, spec, or `README.md` for the touched feature when they exist.
7. Research the nearest existing implementation in the touched app before adding a new pattern.

## Skills

`.claude` is a local link to `.agents`, so `.claude/skills/` and `.agents/skills/` are the same
directory — the harness matches a skill's `description` and loads the canonical file directly. There is
no second copy to keep in sync. The link is not committed; recreate it after cloning with
`cmd /c mklink /J .claude .agents` on Windows or `ln -s .agents .claude` elsewhere.

Load the matching repo skill before changing specialized areas:

- Queue and async events (pub/sub fanout): `.agents/skills/queue-message/SKILL.md`
- Recurring/cron and delayed BullMQ background jobs: `.agents/skills/scheduled-jobs/SKILL.md`
- i18n translation (`__t`) for user-facing messages/errors: `.agents/skills/i18n-translation/SKILL.md`
- Versioned MongoDB data migrations: `.agents/skills/mongo-migrations/SKILL.md`
- File uploads and file-server integration: `.agents/skills/file-service-integration/SKILL.md`
- Media payload formatting: `.agents/skills/media-response-standardization/SKILL.md`
- System settings and configuration: `.agents/skills/system-settings/SKILL.md`
- Socket flows: `.agents/skills/websocket-integration/SKILL.md`
- Feed infinite scroll (home + creator posts): `.agents/skills/feed-infinite-scroll/SKILL.md`
- One-way creator follows and the authenticated following feed: `.agents/skills/following-feed/SKILL.md`
- Interaction notifications (like/comment/reply/share/follow), realtime delivery, and the header panel: `.agents/skills/notification-system/SKILL.md`
- API auth guards, role-based access, and current user extraction: `.agents/skills/api-auth-guards/SKILL.md`
- API pagination — SearchRequest, cursor/offset, PageableData: `.agents/skills/api-pagination/SKILL.md`
- API payload and request class patterns: `.agents/skills/api-payload/SKILL.md`
- API exception handling — RuntimeException, service throws: `.agents/skills/api-exception-handling/SKILL.md`
- User app SSR request headers and session forwarding: `.agents/skills/web-ssr/SKILL.md`
- User app public SEO and metadata rules: `.agents/skills/web-seo/SKILL.md`
- React and Next.js implementation: `.agents/skills/vercel-react-best-practices/SKILL.md`
- Component composition refactors: `.agents/skills/vercel-composition-patterns/SKILL.md`
- High-quality UI implementation in `user/` or `admin/`: `.agents/skills/frontend-design/SKILL.md`
- Web Interface Guidelines review (accessibility, UX audit): `.agents/skills/web-design-guidelines/SKILL.md`
- Local browser QA with Playwright helper scripts: `.agents/skills/webapp-testing/SKILL.md`
- CLI-first browser automation, screenshots, and UI-flow debugging: `.agents/skills/playwright/SKILL.md`
- Standalone React/Tailwind demos and artifacts: `.agents/skills/web-artifacts-builder/SKILL.md`
- REST design review and consistency checks: `.agents/skills/api-design-reviewer/SKILL.md`
- API test suite generation and contract coverage: `.agents/skills/api-test-suite-builder/SKILL.md`
- Dependency risk, license, and upgrade audits: `.agents/skills/dependency-auditor/SKILL.md`
- Explicit security review or secure-by-default guidance: `.agents/skills/security-best-practices/SKILL.md`
- Structured review passes and review reports: `.agents/skills/code-reviewer/SKILL.md`
- Systematic end-to-end repair of a broken feature or module: `.agents/skills/focused-fix/SKILL.md`
- GitHub Actions failure investigation: `.agents/skills/gh-fix-ci/SKILL.md`
- MCP server or repo-local tool integration work: `.agents/skills/mcp-builder/SKILL.md`
- Authoring or updating repo-local skills under `.agents/skills/`: `.agents/skills/skill-creator/SKILL.md`
- Behavioral coding guardrails on any task: `.agents/skills/karpathy-guidelines/SKILL.md`
- Continuous post-implementation quality workflow (performance, bug hunting, regression, docs, reusable knowledge capture): `.agents/skills/continuous-improvement/SKILL.md`
- Tracking an out-of-scope bug, suspicion, or recommendation: `.agents/skills/bug-tracking/SKILL.md`
- High-craft public/marketing/landing UI (anti-slop): `.agents/skills/taste-skill/SKILL.md`
- Audit-first redesign or polish of an existing page/component: `.agents/skills/redesign-skill/SKILL.md`

## Code Intelligence

This repo is indexed under `.code-review-graph/`, served by the `code-review-graph` MCP server declared in `.mcp.json`. Prefer these tools over grep for structural questions such as definitions, callers/callees, impact, and system tracing. Use `rg` for literal text and file discovery. See `.agents/rules/shared.md` for the tool names and query patterns. The index does not auto-update; refresh it when `list_graph_stats_tool` reports a stale `Last updated`.

## Minimum Delivery Bar

- Research the nearest existing implementation before adding a new feature.
- Use `.agents/checklists/feature-update.md` when adding a feature, changing structure, or introducing a reusable pattern.
- Start feature work with a short checklist of the features or tasks to add or update, the apps touched, the docs to sync, and the tests to cover.
- When a new feature introduces a reusable pattern not yet covered by a skill, create a new skill under `.agents/skills/<feature-name>/SKILL.md` and register it in `.agents/instructions` and `AGENTS.md`.
- When modifying an existing feature, update its existing skill and docs in place — do not fork a new overlapping skill.
- When you find a bug, suspicion, or improvement outside the current task scope, file it under `.agents/bug-tracker/` per the `bug-tracking` skill (`bug-`/`suspect-`/`rec-`) with evidence instead of fixing it inline.
- Update or create related product docs in the same task for every new feature and change request. If the docs do not exist yet, create a concise version from the implemented behavior and current understanding.
- Keep role-based docs current. If guests, users, creators, admins, or operators are affected, document how they use the feature, what limits apply, and where they must go in the product. If an admin action is required, point to the exact admin area.
- Document third-party service setup when a feature depends on it, including how to obtain API keys, where to configure them, and any required env or webhook setup.
- Add the current date in `YYYY-MM-DD` format to changed feature docs or change-request notes so future readers can track when the guidance changed.
- If implementation choices improve or change the original requirement, spec, or `README.md`, update that source-of-truth doc in the same task so it matches the shipped solution.
- Keep business logic in services, not adapters.
- Return DTOs from API-facing service methods.
- Treat DTOs as the API response privacy boundary. Do not return private or internal data, and prefer explicit audience-specific mappers such as `toPublicInfo()` or `toPrivateInfo()` when responses have multiple shapes.
- Use payload classes for controller inputs.
- Add focused tests when the touched app has test infrastructure. Do not claim test coverage where no test suite exists.
- If you introduce a new admin settings group, add it to `admin/src/components/settings/components/settings-menu.tsx`.
- For `user/` and `admin/`, run `yarn lint` and `yarn build`.
- For `api/`, run focused or full `yarn test`, then `yarn build`; it has no lint script.
- For `file-server/`, run `yarn lint` and `yarn build`; its current package manifest has no test script.
- Update agent docs or skills, including local `AGENTS.md` files when relevant, when a new reusable pattern becomes part of the project.
