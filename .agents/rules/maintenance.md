# Feature Maintenance Rules

Use this guide when a task adds a new feature, changes project structure, introduces a new reusable pattern, or significantly refactors an existing flow.

## Auto Research Before Implementing

Agents should research the repo before coding instead of inventing a new structure from scratch.

Minimum research flow:

1. Identify the touched app and domain.
2. Read the relevant entry files:
   - `.agents/instructions`
   - local `AGENTS.md`
   - relevant `.agents/rules/*.md`
3. Find the nearest existing implementation. Prefer CodeGraph for structural lookups (`query_graph_tool` with `callers_of`/`callees_of`/`file_summary`, `semantic_search_nodes_tool`, `get_impact_radius_tool`; see `.agents/rules/shared.md` for the full table); fall back to `rg` for literal text. Cover:
   - controllers
   - services
   - DTOs
   - payloads
   - jobs
   - listeners
   - components
   - page patterns
   - tests
   - blast radius of any symbol you plan to change (`get_impact_radius_tool`)
4. Read adjacent docs or specs under `docs/`, app `README.md` files, the original requirement or change-request doc, and feature-specific docs when they exist.
5. Load the matching skill if the task touches a specialized workflow such as queues, sockets, file uploads, media response shaping, or React architecture.

## Checklist Before Coding

- Write a short checklist of the features or tasks to add or update before implementation starts.
- Note the touched apps, settings, migrations, docs, tests, and third-party services.
- Identify the source-of-truth requirement, spec, or `README.md` that must stay in sync if the solution changes during implementation.

## Reuse Before Creating

- Reuse the nearest existing domain pattern first.
- Mirror existing folder placement, naming, and data flow unless there is a clear reason to improve the structure.
- Prefer updating an existing service, DTO, payload, component group, or skill over creating a parallel abstraction with overlapping responsibility.

## When To Update Agent Docs

Update agent-facing docs in the same task when the feature changes how future agents should work.

### Update `.agents/project-structure.md` when:

- a new top-level app, service, or major folder is added
- a new canonical domain or subdomain is introduced
- the preferred location of feature files changes

### Update `.agents/rules/*.md` when:

- a new rule becomes broadly applicable
- a project convention changes
- there is a new standard for naming, routing, rendering, testing, queues, DTOs, payloads, or migrations

### Update local `AGENTS.md` files when:

- a new rule or skill must become easier to discover from that app folder
- a subproject has a new mandatory read path for feature work

## When To Update Product Docs

Update product-facing docs in the same task when the feature changes how operators, admins, creators, or users understand or use the product.

- Update an existing doc when the feature already has a canonical doc under `docs/` or a feature-specific `README.md`.
- Create a concise new doc when no suitable doc exists yet. Base it on the implemented behavior and current understanding instead of leaving the feature undocumented.
- Add the current date in `YYYY-MM-DD` format to changed feature docs or change-request notes.
- Update role-based guidance when guests, users, creators, admins, or operators are affected. Keep it brief but actionable.
- If the feature needs admin configuration, document the exact admin navigation path and setting names.
- If the feature depends on a third-party service, document API key acquisition, dashboard or webhook setup, env vars, and rollout steps in the relevant deployment or feature doc.
- If the implemented solution changes the original requirement, spec, or `README.md`, update that source-of-truth doc in the same task.

## When To Update Or Create Skills

Skills should be updated when a specialized workflow becomes reusable and important for future tasks.

Update an existing skill when:

- the workflow already fits an existing skill
- examples, file paths, or conventions in the skill are stale
- the feature adds an important new branch of the same workflow

**Modifying an existing feature → update its existing skill and docs in place. Do NOT create a new, parallel skill that overlaps an existing one.** A new skill is only for a genuinely new specialized workflow. If a feature already has a skill, the changed behavior, new file paths, and new branches go into that same skill.

Create a new skill when all of these are true:

- the workflow is specialized
- the workflow is likely to repeat
- the workflow has project-specific patterns that are easy for agents to miss
- the knowledge would be too bulky or too specific for the general rules files
- no existing skill already owns this workflow (otherwise update that one)

When adding a new skill:

1. create the skill folder under `.agents/skills/<skill-name>/`
2. add `SKILL.md`
3. link the skill from `.agents/instructions`
4. link the skill from `AGENTS.md`
5. link it from relevant local `AGENTS.md` files

## Checklist Discipline

- Use `.agents/checklists/feature-update.md` for every new feature or structural change.
- Use the checklist for change requests too when they change behavior, docs, or project conventions.
- If the checklist says a docs or skill update is needed, make that update in the same task instead of leaving it for later.

## Good Trigger Examples

- New async event workflow: update the queue skill or add a queue-related note.
- New media response standard: update the media response skill and related rules.
- New domain folder or canonical layout: update project structure docs.
- New repo-wide coding convention: update the shared or area-specific rules.
