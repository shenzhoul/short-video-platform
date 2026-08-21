# Feature Update Checklist

Use this checklist when adding a feature, changing a domain flow, or introducing a new reusable pattern.

## Before Coding

- Read `.agents/instructions`.
- Read the relevant local `AGENTS.md`.
- Read `.agents/rules/maintenance.md`.
- Read the relevant area rules.
- Write a short working checklist of the features or tasks to add or update before coding.
- Identify the touched apps, docs, tests, settings, migrations, and third-party services.
- Identify the original requirement, spec, or `README.md` that must stay in sync if the implementation improves or changes the approach.

## Research

- Search the repo for the nearest similar implementation.
- Read adjacent tests and docs for the touched domain.
- Load the matching skill if the feature touches a specialized workflow.

## Structure

- Put files in the correct app and domain folders.
- Keep adapters thin and business logic in services.
- Reuse existing DTO, payload, component, and service patterns where possible.
- Avoid introducing circular dependencies.
- Add migrations if persistent data or settings change.

## Documentation

- Update related docs in the same task for every new feature and change request.
- If no suitable doc exists, create a concise new doc from the implemented behavior and current understanding.
- Add the current date in `YYYY-MM-DD` format to the updated feature doc or change-request note.
- Update end-user or operator guidance for affected roles. Document how users, creators, admins, or operators use the feature and what role-specific limitations matter.
- If the feature needs admin setup, include the exact admin navigation path and setting names.
- If the feature depends on a third-party service, document API key acquisition, dashboard or webhook setup, env vars, and rollout notes in the relevant feature or deployment doc.
- Update the original requirement, spec, or `README.md` when implementation decisions materially improve or change the solution.

## Feature-Specific Updates

- Update DTOs, payloads, services, controllers, jobs, listeners, pages, or components as needed.
- If you introduce a new admin settings group, update `admin/src/components/settings/components/settings-menu.tsx`.
- For web toast notifications in `user/` or `admin/`, use `@douyin-clone/shared-toast` from `shared/toast` instead of app-local wrappers.
- In `admin/`, do not use `antd` `message`/`notification` APIs for runtime toasts.
- Mount `SharedToastProvider` only once at app root layout; do not add page/component-level `ToastContainer`.
- Add or update unit tests for the main user cases and important guards.
- Keep test scope proportional to the task. Cover the changed behavior and major risks without adding broad unrelated coverage.
- For `api/` or `file-server/` response changes, verify DTO mappings expose only the intended audience fields and add explicit helpers such as `toPublicInfo()` or `toPrivateInfo()` when needed.
- Run targeted test commands while iterating.
- If you change `api/`, `file-server/`, `user/`, or `admin/`, verify the touched project with `yarn build` or the relevant `yarn dev` command before finishing.

## Agent Maintenance

- Update `.agents/project-structure.md` if the repo layout or canonical feature placement changed.
- Update the relevant `.agents/rules/*.md` if a new convention is now expected.
- Update an existing skill if the feature extends a reusable specialized workflow.
- Add a new skill if the feature introduces a new reusable specialized workflow.
- Link new or updated skills from `.agents/instructions`, `AGENTS.md`, and the relevant local `AGENTS.md` files.

## Final Sanity Check

- The working checklist of features or tasks is complete.
- The original requirement or `README.md` reflects the final solution.
- End-user, admin, creator, or operator docs are updated or created and dated.
- Third-party setup steps are documented when needed.
- Tests cover the changed behavior at the right depth.
- Future agents can find the new structure quickly.
- Future agents can discover the right skill quickly.
- The repo docs now match the real implementation.
