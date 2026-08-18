---
title: Documentation Contribution Guide
description: Rules for keeping repository documentation aligned with implementation.
audience: [developer-agent]
domain: cross
status: active
updated: 2026-07-31
tags: [documentation, maintenance]
---

# Documentation Contribution Guide

## Principles

1. Verify behavior against routes, services, schemas, settings, migrations, package manifests, and UI pages before documenting it.
2. Describe shipped behavior only. Mark incomplete behavior explicitly; do not promote TODO comments or planned routes to product features.
3. Keep one canonical explanation per topic. Link to it instead of duplicating long descriptions.
4. Update `updated` with the current `YYYY-MM-DD` date when content changes.
5. Remove a document when its feature is removed and no historical or operational value remains.

## Frontmatter

Every maintained Markdown file uses:

```yaml
---
title: Short title
description: One-sentence purpose.
audience: [user, developer-agent]
domain: content
status: active
updated: 2026-07-31
tags: [post, feed]
---
```

Allowed `status` values are `active`, `draft`, and `deprecated`. Use domain names from [domains/README.md](./domains/README.md), or `cross` for repository-wide material.

## Placement

- `domains/`: canonical behavior and ownership by business/technical domain.
- `by-pages/`: current application routes and their owning components/services.
- `features/`: shipped workflows that combine one or more domains.
- `relationship/`: cross-app dependency maps and API-to-UI traceability.
- `questions/`: short user-facing answers that link to canonical domain docs.
- `_templates/`: reusable authoring templates only.

Add a separate feature document only when the feature spans domains and cannot be explained clearly in the canonical domain docs.

## Validation checklist

- All relative Markdown links resolve.
- Every referenced local path exists.
- Package/framework versions match `package.json`.
- Routes match the Next.js `app/` tree and NestJS controller decorators.
- Claims about storage, security, integrations, and deployment are backed by code/config.
- `docs/index.md` and `docs/README.md` include any new canonical document.
