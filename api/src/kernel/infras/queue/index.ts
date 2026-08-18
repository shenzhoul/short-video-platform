// Main exports for queue infrastructure
export { CoreQueueModule } from './core-queue.module';
export { QueueService } from './queue.service';
export { QueueMessageService } from './queue-message.service';

// Type alias for semantic naming - QueueMessageService provides pub-sub functionality
export { QueueMessageService as PubSubService } from './queue-message.service';

// Types and constants
export * from './constants';
export { QueueWorkerHolderSingleton } from './queue-workers-holder';

/**
 * Service Selection Guide:
 *
 * Use **QueueService** for:
 * - Background job processing (image resize, email sending, data processing)
 * - Scheduled/delayed tasks
 * - Tasks where only ONE worker should process each job
 * - Traditional work queues
 *
 * Use **QueueMessageService/PubSubService** for:
 * - Event notifications (user registered completed)
 * - Real-time system updates
 * - Cases where multiple services need to react to same event
 * - Microservices communication
 * - Audit logging, analytics tracking
 */
