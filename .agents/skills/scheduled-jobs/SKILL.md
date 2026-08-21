---
name: scheduled-jobs
description: Cluster-safe recurring and delayed BullMQ jobs for Douyin Clone. Use when creating or changing cleanup schedules, job schedulers, delayed execution, worker registration, or repeat configuration.
---

# Scheduled Jobs

Use BullMQ through the repository `QueueService`. Do not use NestJS cron decorators, `setInterval`, or process-local scheduling for application jobs.

## Workflow

1. Put the job under `api/src/jobs/<domain>/` or the corresponding file-server area.
2. Define stable queue and job names.
3. Register the scheduler idempotently.
4. Register one worker handler that delegates to a service.
5. Make the handler safe for retries and overlapping attempts.
6. Close queue resources on shutdown.

## Current References

- `api/src/jobs/content/cleanup-unused-files.job.ts`
- `api/src/jobs/socket/socket-cleanup.job.ts`
- `api/src/kernel/infras/queue/queue.service.ts`
- `file-server/src/kernel/infars/queue/queue.service.ts`

## Verification

- Check repeated registration, due execution, retry/backoff, duplicate prevention, multi-instance behavior, and graceful shutdown.
- Run the verification scripts for the touched backend service.
