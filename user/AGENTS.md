# User App Agent Guide

Start with `../.agents/instructions`.

## Read In This Area

1. `../.agents/project-structure.md`
2. `../.agents/rules/shared.md`
3. `../.agents/rules/user.md`
4. For new features, refactors, or structural changes:
   - `../.agents/rules/maintenance.md`
   - `../.agents/checklists/feature-update.md`
5. Research the nearest implementation in `src/app/`, `src/components/`, `src/services/`, and `src/hooks/` before adding a new pattern.

## Key Folders

- `src/app/(public)/`: SEO-sensitive public routes
- `src/app/(private)/`: authenticated routes
- `src/app/auth/`: auth flows
- `src/components/`: reusable UI grouped by feature (`src/components/content/post/media-lightbox.tsx` for generic media galleries and `post-detail-modal.tsx` for the shared video/graphics detail experience)
- `src/services/`: API clients and request helpers
- `src/hooks/`: reusable UI and data hooks
- `src/socket/`: real-time client utilities

## Skills

Load the matching repo skill before changing specialized workflows:

- `../.agents/skills/vercel-react-best-practices/SKILL.md`
- `../.agents/skills/vercel-composition-patterns/SKILL.md`
- `../.agents/skills/web-ssr/SKILL.md`
- `../.agents/skills/web-seo/SKILL.md`
- `../.agents/skills/file-service-integration/SKILL.md`
- `../.agents/skills/media-response-standardization/SKILL.md`
- `../.agents/skills/websocket-integration/SKILL.md`
- `../.agents/skills/feed-infinite-scroll/SKILL.md`
- `../.agents/skills/following-feed/SKILL.md`
- `../.agents/skills/notification-system/SKILL.md`

Supplement with vendored general-purpose skills when the task calls for them:

- `../.agents/skills/frontend-design/SKILL.md`
- `../.agents/skills/web-design-guidelines/SKILL.md`
- `../.agents/skills/webapp-testing/SKILL.md`
- `../.agents/skills/playwright/SKILL.md`
- `../.agents/skills/web-artifacts-builder/SKILL.md`
- `../.agents/skills/security-best-practices/SKILL.md`
- `../.agents/skills/code-reviewer/SKILL.md`
- `../.agents/skills/focused-fix/SKILL.md`
- `../.agents/skills/gh-fix-ci/SKILL.md`

## Minimum Delivery Bar

- Keep fetching and API request helpers in `src/services/`.
- Be explicit about SSR versus client rendering instead of mixing patterns accidentally.
- Keep metadata intentional: public routes should have real SEO metadata, while private and utility routes should usually remain `noindex`.
- Use `@douyin-clone/shared-toast` for toast notifications; do not import toast directly from `react-toastify` in feature code.
- Add or update focused tests when rendering or component logic is important.
- Run targeted tests while iterating, then `yarn lint` and `yarn build` before finishing.
