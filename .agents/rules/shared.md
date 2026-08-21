---
trigger: always_on
---

# Shared Rules

These rules apply across `api/`, `file-server/`, `user/`, and `admin/`.

## Naming

- Use lowercase kebab-case for filenames.
- Framework-reserved files keep their required names, for example `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, and `route.ts`.
- Use camelCase for variables, functions, and most TypeScript members.
- Choose friendly, descriptive names. Avoid vague names such as `data2`, `handler1`, or `tmp`.

## Code Organization

- Prefer small, focused files over large mixed-responsibility files.
- Split a file that grows too big into smaller cohesive units. Pull a controller, service, component, or helper apart by responsibility before it becomes a mixed-concern dumping ground. Treat a large file as a refactor signal, not normal.
- Reusable helpers that are not business logic belong in `utils/`, `common/utils/`, or similar shared utility folders.
- Avoid circular dependencies. Circular dependencies are not accepted — if two modules/services need each other, introduce a middle/orchestrator service that coordinates the flow instead of cross-importing both directions.
- For web toast notifications, use the shared package `@douyin-clone/shared-toast` from `shared/toast` in both `user/` and `admin/`. Do not add app-specific toast wrappers when shared APIs already cover the use case.
- In `admin/`, do not use Ant Design `message`/`notification` APIs for runtime toasts.

## Performance And Scalability

These rules apply to every app. Treat performance and horizontal scaling as defaults, not afterthoughts.

### Query And Database

- Avoid N+1 queries. Batch, join, or use a single aggregate/`$in` lookup instead of querying inside a loop.
- Add a database index for every field used in a frequent filter, sort, or join. Add the matching migration when you introduce a new query pattern.
- Page large result sets. Do not load unbounded collections into memory.

### Caching

- Add a cache layer for hot reads (settings, derived/aggregate data, expensive lookups).
- Every cache entry must have an explicit TTL. No TTL-less caches.
- Invalidate or version cache keys when the source data changes so stale reads cannot persist past their purpose.

### Statistics And Aggregates

- Do not compute heavy statistics on the read path against the raw transactional collections.
- Split stats into period-bucketed collections (for example by day, month, year) instead of one unbounded growing collection.
- Update stats asynchronously through the queue (`QueueService` / `QueueMessageService`), not inline in the request that triggers them.
- A stats query API may add its own cache layer on top of the bucketed collections; give that cache a TTL too.

### Multi-Instance / Cluster Safety

- The system runs behind a load balancer across multiple instances / a cluster. Code must be safe to run in many processes at once.
- Do not assume a single process. No in-process `Cron`, `setInterval`, manual timer loops, or in-memory-only schedulers — they fire on every instance and drift. Use the BullMQ scheduler / `QueueService` so a job runs once cluster-wide.
- Do not keep authoritative state in process memory (counters, locks, sessions, caches that must be consistent). Use the shared store (DB, Redis) so every instance sees the same state.
- Guard once-only work with a distributed lock or queue de-dup, not an in-process flag.

## Code Intelligence (CodeGraph)

This repo is indexed under `.code-review-graph/`, served by the `code-review-graph` MCP server declared in `.mcp.json`. For **structural** questions prefer it over grep — it is AST-accurate and sub-millisecond.

The tools are exposed as `mcp__code-review-graph__<tool>`. The ones worth knowing:

| Question | Tool |
|---|---|
| "What calls X / what does X call" | `query_graph_tool` with `pattern: callers_of` / `callees_of` |
| "Who imports X / what does X import" | `query_graph_tool` with `pattern: importers_of` / `imports_of` |
| "What is in this file / class" | `query_graph_tool` with `pattern: file_summary` / `children_of` |
| "What tests cover X" | `query_graph_tool` with `pattern: tests_for` |
| "What breaks if I change X" | `get_impact_radius_tool` before a refactor |
| "Where is X, I only know roughly what it does" | `semantic_search_nodes_tool` |
| "How is this system laid out" | `get_architecture_overview_tool`, `list_flows_tool`, `get_flow_tool` |
| "Give me just enough context on X" | `get_minimal_context_tool`, `get_review_context_tool` |

`query_graph_tool` requires both `pattern` and `target`. Valid patterns are exactly: `callers_of`, `callees_of`, `imports_of`, `importers_of`, `children_of`, `tests_for`, `inheritors_of`, `file_summary`. A bare name that matches several nodes returns `status: ambiguous` with candidates — re-query with the `qualified_name` from the candidate list.

- Use grep/Read only for literal text (strings, comments, logs) or once a specific file is open.
- The index does **not** auto-update. If `list_graph_stats_tool` shows a stale `Last updated`, refresh it — `build_or_update_graph_tool` for an incremental pass, or `node api/scripts/build-code-review-graph.js` for a full rebuild (that script moves `node_modules`/`dist`/`.next` out and back so the parser does not drown in generated files).

### Local setup

`.mcp.json` is gitignored because it holds machine-specific absolute paths (Python interpreter, repo root). Recreate it after cloning:

```bash
py -m code_review_graph install --platform claude-code   # Windows; python3 elsewhere
```

Then **delete what it overreaches on**: it also appends instructions to `CLAUDE.md`, writes its own skills into `.claude/skills/`, installs `PostToolUse`/`SessionStart` hooks into `.claude/settings.json`, and adds a git pre-commit hook. In this repo `.claude` is a junction to `.agents/`, so those writes land inside the curated agent docs. Keep only the generated `.mcp.json`. The `--no-instructions` / `--no-skills` / `--no-hooks` flags are accepted but not honoured — verify afterwards rather than trusting them.

If the graph has never been built on this machine, run `node api/scripts/build-code-review-graph.js` once. Restart the AI tool after writing `.mcp.json`; MCP servers are only loaded at session start.

## Issue Tracking

When you discover a problem **outside the scope** of the current task, do not fix it inline and do not lose it — record it. Load `.agents/skills/bug-tracking/SKILL.md` and file an evidence file under `.agents/bug-tracker/`:

- confirmed defect → `bug-<area>-<slug>.md`
- unconfirmed suspicion → `suspect-<area>-<slug>.md`
- improvement / recommendation → `rec-<area>-<slug>.md`

Every file carries concrete evidence (`path:line`, snippet, repro/reasoning, logs). Confirmed money/security defects are `severity: critical` and must also be raised in your task summary.

Any recommendation, suspicion, or improvement idea you have — performance, scaling, refactor, file split, missing index, missing cache, anything — gets filed as `rec-*` / `suspect-*` rather than dropped. Do not silently skip it because it is out of scope; record it so it is not lost.

## Clarity

- Functions should have clear intent.
- Add brief descriptions or comments when the logic is not obvious, especially to explain why a rule or branch exists.
- Prefer straightforward code over clever shortcuts.

## Documentation

- Update or create related docs in the same task for every new feature and change request.
- If a matching doc does not exist, create a concise baseline doc from the implemented behavior and current understanding.
- Keep end-user and operator docs current for affected roles. Document how guests, users, creators, admins, or operators use the feature and call out the exact admin area when configuration is required.
- Document third-party service setup when a feature depends on it, including API key acquisition, dashboard steps, env vars, and webhook configuration.
- Update the original requirement, spec, or `README.md` when the implementation leads to a better approach so the source-of-truth doc matches the shipped result.
- Add the current date in `YYYY-MM-DD` format to changed feature docs or change-request notes.

## Verification

- Add or update unit tests for important flows and edge cases.
- Keep tests proportional to the task. Focus on changed behavior and the main risks instead of adding broad coverage for unrelated paths.
- Prefer targeted test runs while iterating:
  - `api/`: `yarn test <file-path-or-pattern>`
  - `file-server/`: `yarn test <file-path-or-pattern>`
  - `user/`: `yarn test <file-path-or-pattern>`
  - `admin/`: `yarn test <file-path-or-pattern>`
- Run `yarn lint` in the touched project before finishing.
- In cross-platform `package.json` scripts, wrap glob arguments in escaped double quotes. Do not use
  single quotes: POSIX shells interpret them, but Windows `cmd.exe` passes them through literally.
- If you change `api/`, `file-server/`, `user/`, or `admin/`, also verify the touched project with `yarn build` or the relevant `yarn dev` command before finishing.

## Process Teardown (Mandatory)

Anything you start, you stop. **Never leave a process running after a task ends** — dev servers, API/user/admin/file-server instances, test runners, workers, Playwright/preview browsers, background jobs, tunnels. This applies to processes started by subagents too: a subagent that boots a stack for verification MUST tear it down before reporting back.

- Kill spawned processes the moment the task stops, completes, or is interrupted — including on failure and on abort, not just on the happy path.
- Prefer foreground/one-shot commands over long-lived background servers when a one-shot will do. If you must background something, record its PID and kill that exact PID.
- Before claiming a task is done, **verify** nothing is left behind:
  ```bash
  lsof -nP -iTCP -sTCP:LISTEN | grep -iE "node|next"   # dev ports: 8080 api, 8081 user, 8082 admin, 8000 file-server
  pgrep -fl "node|jest|next" | grep -i douyin-clone
  ```
  Kill the specific PIDs you started (`kill <pid>`, then `kill -9` only if it will not exit).
- Do not kill processes you did not start. Another project's dev server, an unrelated session's test run, and the user's long-running native `mongod`/`redis-server` are off limits — report them instead. Local dev DB services are shared infrastructure and must stay up.
- Test suites must not rely on `--forceExit` to hide leaked handles. If a suite cannot exit cleanly, that is a shutdown defect in the app — file it under `.agents/bug-tracker/` rather than papering over it.

## Mandatory Post-Implementation Responsibilities

Completing the requested implementation is **not** the final step of any task.

After every completed task (feature, bug fix, refactor, optimization, audit, documentation update, etc.), the agent MUST perform the following activities before considering the task complete.

### 1. Performance Review

Review the implementation for performance issues, including but not limited to:

- unnecessary database queries
- N+1 queries
- duplicate API calls
- excessive renders
- blocking operations
- memory usage
- bundle size
- caching opportunities
- unnecessary loops
- duplicated computations

If safe optimizations are identified, implement them.

### 2. Bug Hunting

Assume the implementation may still contain hidden issues.

Proactively review for:

- edge cases
- race conditions
- concurrency issues
- permission/security gaps
- null/undefined cases
- stale state
- loading state issues
- rollback failures
- cleanup issues
- resource leaks
- validation gaps
- error handling

Fix confirmed issues before closing the task.

### 3. Regression Review

Review all related functionality that could be affected.

This includes:

- related pages
- shared components
- APIs
- services
- permissions
- caching
- background jobs
- responsive layouts
- dark mode
- accessibility

Update or add tests where appropriate.

### 4. Documentation Review

If the implementation changes behavior, architecture, workflows, APIs, conventions, or developer experience, update the relevant documentation.

Examples include:

- README
- Architecture docs
- API documentation
- Developer guides
- ADRs
- Internal project documentation

Documentation should always reflect the current implementation.

### 5. Agent Skills & Knowledge

Determine whether the completed task introduces reusable knowledge.

If yes, update the appropriate AI agent documentation, rules, or skills with:

- reusable implementation patterns
- project conventions
- architectural decisions
- debugging techniques
- performance improvements
- security best practices
- testing strategies
- common pitfalls
- lessons learned

Do not store task-specific details. Only add reusable knowledge that will improve future work.

### Completion Rule

A task is only considered complete after:

- the requested implementation is finished;
- a performance review has been completed;
- bug hunting has been performed;
- regression risks have been reviewed;
- relevant documentation has been updated (when applicable);
- agent rules/skills have been updated if new reusable knowledge was discovered;
- every process started during the task has been killed and verified gone (see "Process Teardown").

## Continuous Improvement

The agent should continuously improve the project and itself.

Every completed task is an opportunity to:

- improve project documentation;
- improve coding standards;
- improve agent rules;
- improve reusable skills;
- eliminate recurring mistakes;
- document newly discovered best practices.

If reusable knowledge is discovered and not documented, the task is not fully complete.
