# Project Structure

Use this map to route work to the correct app and supporting guidance.

## Top-Level Applications

- `api/`: NestJS API, domain services, MongoDB schemas, Redis, queues, and sockets.
- `user/`: Next.js App Router application for guests, users, and creators.
- `admin/`: Next.js App Router administration application.
- `file-server/`: NestJS upload, TUS, storage, and media-processing service.
- `docs/`: canonical product and architecture documentation.
- `.agents/`: repository-specific rules, checklists, skills, and issue-tracking templates.
- `.code-review-graph/`: generated structural code index.

There is no top-level `shared/` package in the current repository.

## Agent Guidance

- `.agents/instructions`: stable entry point.
- `.agents/rules/shared.md`: cross-app rules.
- `.agents/rules/api.md`: NestJS rules for `api/` and applicable `file-server/` code.
- `.agents/rules/user.md` and `.agents/rules/admin.md`: frontend-specific rules.
- `.agents/rules/maintenance.md` and `.agents/checklists/feature-update.md`: structural-change workflow.
- `api/AGENTS.md`, `user/AGENTS.md`, `admin/AGENTS.md`, and `file-server/AGENTS.md`: local navigation and verification.

## Documentation

- `docs/features/`: implemented feature behavior.
- `docs/domains/`: domain ownership and data flow.
- `docs/by-pages/`: current user and admin routes.
- `docs/relationship/`: cross-app dependencies and endpoint consumers.
- `docs/questions/`: role-oriented product guidance.
- `docs/highlights.md`: verified platform highlights and current boundaries.
- `docs/index.md`: maintained document index.

## API

Main code is under `api/src/`:

- `controllers/`: HTTP adapters grouped by `community`, `content`, `identity`, and `system`.
- `services/`: business logic and orchestration.
- `schemas/`: Mongoose models.
- `payloads/`: validated request inputs.
- `dtos/`: response shapes and mapping helpers.
- `jobs/`: BullMQ jobs, currently including cleanup work.
- `listeners/`: asynchronous event adapters.
- `gateways/socket/`: Socket.IO adapters.
- `kernel/`, `common/`, `config/`, `utils/`: infrastructure and cross-domain helpers.

Persistent migrations live in `api/migrations/`.

## User App

Main code is under `user/src/`:

- `app/(public)/`: public and SEO-sensitive pages.
- `app/(private)/(creator)/`: creator management — publishing and managing your own content. Uses the creator sidebar.
- `app/(private)/(app)/`: authenticated pages that are not creator management, such as `/messages`. Uses the Home shell.
- `app/auth/`: authentication routes.
- `components/`: feature and shared UI.
- `services/`: API request clients.
- `hooks/`, `providers/`, `socket/`, `interfaces/`, `utils/`: reusable client behavior.

The app uses Tailwind CSS and `react-toastify`.

## Admin App

Main code is under `admin/src/`:

- `app/(main)/`: authenticated administration pages.
- `app/auth/`: authentication and recovery pages.
- `components/`: user, file, settings, and system UI.
- `services/`: API clients.
- `hooks/`, `providers/`, `context/`, `layout/`, `lib/`: shared application behavior.

The app uses Ant Design, including its message API for user feedback.

## File Server

Main code is under `file-server/src/`:

- `controllers/internal/`: signed upload and internal file APIs.
- `controllers/health/`: health endpoints.
- `services/file/`: file orchestration.
- `services/tus/`: resumable uploads.
- `services/monitoring/`: operational hooks.
- `kernel/infars/queue/`: BullMQ queue infrastructure.
- `schemas/`, `common/`, `config/`, `lib/`: service infrastructure.

