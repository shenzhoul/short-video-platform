import { APIRequest } from './api-request';

export interface NotificationQuery {
  limit?: number;
  offset?: number;
  type?: string;
  category?: string;
  cursor?: string;
  lastCreatedAt?: string;
}

/**
 * Notification Service
 *
 * Every endpoint is scoped to the authenticated user by the backend, so no
 * recipient identifier is ever sent from here.
 */
export class NotificationService extends APIRequest {
  /** GET /api/notifications */
  search = (query?: NotificationQuery) => this.get(this.buildUrl('/notifications', query as any));

  /** GET /api/notifications/unread-count */
  unreadCount = () => this.get('/notifications/unread-count');

  /** PUT /api/notifications/read-all */
  markAllRead = () => this.put('/notifications/read-all');

  /** DELETE /api/notifications/{id} — recipient-scoped on the server. */
  remove = (id: string) => this.del(`/notifications/${id}`);
}

// === TREE SHAKING EXPORTS ===
const notificationServiceInstance = new NotificationService();

export const notificationService = notificationServiceInstance;

export const searchNotifications = notificationServiceInstance.search.bind(notificationServiceInstance);
export const getUnreadNotificationCount = notificationServiceInstance.unreadCount.bind(notificationServiceInstance);
export const markAllNotificationsRead = notificationServiceInstance.markAllRead.bind(notificationServiceInstance);
export const deleteNotification = notificationServiceInstance.remove.bind(notificationServiceInstance);
