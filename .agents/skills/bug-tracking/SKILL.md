---
name: bug-tracking
description: Evidence-based tracking for defects, suspicions, and recommendations discovered outside the current task. Use when an unrelated issue should be recorded under .agents/bug-tracker instead of fixed inline.
---

# Bug Tracking

Track only issues outside the current task. Fix in-scope problems as part of the task.

## Classification

- `bug-<area>-<slug>.md`: evidence confirms incorrect behavior.
- `suspect-<area>-<slug>.md`: evidence suggests a problem but confirmation is incomplete.
- `rec-<area>-<slug>.md`: a concrete improvement with an explained benefit.

Copy the matching template from `.agents/bug-tracker/templates/`.

## Evidence Requirements

- Include the observed behavior and expected behavior.
- Include reproducible steps or a precise code path.
- Cite file and line evidence when available.
- State user impact, severity, and affected apps.
- Do not copy stale issues from another repository or invent an issue to satisfy process.

Add the new filename to `.agents/bug-tracker/README.md`. Move it to the resolved section only when the implementing change has been verified.
