---
name: queue-message
description: BullMQ queue and distributed message patterns for Douyin Clone API and file server. Use when adding workers, delayed work, asynchronous fan-out, QueueService, or QueueMessageService behavior.
---

# Queue And Message Integration

## Choose The Primitive

- Use `QueueService` for a worker that should process a job once.
- Use `QueueMessageService` when one event may have multiple distributed subscribers.
- Use the scheduled-jobs skill for recurring schedulers and delayed one-shot jobs.
- Keep business logic in a service and let the worker/listener adapt the queue payload.

## Current References

- `api/src/kernel/infras/queue/queue.service.ts`
- `api/src/kernel/infras/queue/queue-message.service.ts`
- `file-server/src/kernel/infars/queue/queue.service.ts`
- `file-server/src/kernel/infars/queue/queue-message.service.ts`
- `api/src/jobs/content/cleanup-unused-files.job.ts`
- `api/src/jobs/socket/socket-cleanup.job.ts`

## Invariants

- Use serializable, versionable payloads.
- Make handlers idempotent because jobs may retry.
- Configure bounded retries and backoff for transient failures.
- Avoid acknowledging work before durable side effects complete.
- Close workers, queues, and subscriptions during application shutdown.
- Do not keep once-only state in process memory.
- For destructive fan-out, tombstone the source before publishing a versioned
  snapshot. Make cleanup derive final counters from surviving source data, and
  delete external files last, so duplicate delivery and partial retries converge
  on the same state.

## Verification

- Cover success, retryable failure, terminal failure, duplicate delivery, and shutdown.
- Run the verification scripts for the touched backend service.
