---
name: continuous-improvement
description: Mandatory post-implementation completion workflow for all tasks. Use when finishing any feature, bug fix, refactor, optimization, audit, or documentation update to run performance review, bug hunting, regression review, documentation sync, and reusable knowledge extraction before final report.
---

# Continuous Improvement

Treat implementation as only one phase of delivery. A task is complete only after all post-implementation checks pass.

## Required End-of-Task Workflow

Run this sequence for every completed task:

1. Self Test
2. Performance Review
3. Bug Hunting
4. Regression Review
5. Documentation Review
6. Agent Skills & Knowledge Update (when reusable knowledge is discovered)
7. Final Report

Do not skip a step unless it is truly not applicable; state why in the final report.

## 1) Performance Review

Audit for avoidable performance issues, including:

- unnecessary database queries
- N+1 queries
- duplicate API calls
- excessive renders
- blocking operations
- memory usage spikes
- bundle size growth
- missing cache opportunities
- unnecessary loops
- duplicated computations

If a safe optimization does not change behavior, implement it in the same task.

## 2) Bug Hunting

Assume hidden bugs exist until disproven. Proactively check:

- edge cases and empty states
- race conditions and concurrency issues
- permission or security gaps
- null/undefined handling
- stale state and loading-state bugs
- rollback/cleanup failures
- resource leaks
- validation and error-handling gaps

Fix confirmed issues before closing the task.

## 3) Regression Review

Review related surfaces that could break:

- related pages and flows
- shared components and services
- APIs and permissions
- caching and background jobs
- responsive layouts, dark mode, accessibility

Update or add targeted tests when needed.

## 4) Documentation Review

If behavior, architecture, workflow, API, or conventions changed, update related docs in the same task. Keep docs aligned with shipped behavior.

## 5) Agent Skills & Knowledge Update

When reusable knowledge is discovered, update rules/skills/docs so future agents avoid repeating mistakes.

Add only broadly reusable guidance:

- patterns and conventions
- pitfalls and prevention
- security and performance practices
- debugging and testing techniques

Do not store one-off task details as reusable guidance.

## Completion Rule

If reusable knowledge was discovered but not documented, the task is not fully complete.
