---
trigger: always_on
---

# Web Admin Rules

These rules apply to `admin/`.

## Baseline

- Follow the same structural expectations as `user/` for naming, component size, service boundaries, and linting.
- Use lowercase kebab-case for filenames, except for framework-reserved files.
- Use clear, friendly names for components, functions, variables, and props.
- Keep API request logic in `src/services/`.

## UI Library

- This app uses Ant Design.
- Treat `admin/package.json` as the source of truth for the supported antd version.
- Prefer current antd APIs and patterns that match the installed version.
- Avoid deprecated props, deprecated component APIs, and examples copied from older antd releases.

## React Patterns

- Use React hooks correctly and idiomatically — respect the rules of hooks, and reach for the right hook (`useMemo`/`useCallback` for stable identity and fewer re-renders, `useEffect` only for real side effects, custom hooks to reuse stateful logic).
- Keep data-fetching and stateful logic in hooks/services, not inlined across JSX.

## Composition

- Build smaller feature-related components instead of very large admin pages.
- Split a component or page that grows too big into smaller components and extract logic into custom hooks.
- Keep layout and data concerns separated where possible.
- For any new design or UI/UX change, follow `.agents/skills/taste-skill/SKILL.md` (and `.agents/skills/redesign-skill/SKILL.md` when polishing an existing screen).

## Settings

- When you introduce a new settings group or tab, add it to `admin/src/components/settings/components/settings-menu.tsx` so admins can reach it.
- When a feature needs admin-side configuration, update the related docs with the exact admin navigation path and setting labels.

## Skills To Use

Load the relevant repo skills when the task matches them:

- `.agents/skills/system-settings/SKILL.md`
- `.agents/skills/vercel-react-best-practices/SKILL.md`
- `.agents/skills/vercel-composition-patterns/SKILL.md`
- `.agents/skills/taste-skill/SKILL.md` — any new design or UI/UX change
- `.agents/skills/redesign-skill/SKILL.md` — audit-first polish of an existing screen
- `.agents/skills/file-service-integration/SKILL.md`
- `.agents/skills/media-response-standardization/SKILL.md`
- `.agents/skills/websocket-integration/SKILL.md`

## Quality

- Run targeted `yarn test` commands for changed behavior, then `yarn lint` and `yarn build`.
- Add or update focused tests when component logic or rendering behavior is important.
