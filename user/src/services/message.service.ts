import { APIRequest } from './api-request';
import { uploadFile, UploadProgress } from './file-upload.service';

export interface ConversationQuery {
  limit?: number;
  offset?: number;
  q?: string;
  cursor?: string;
  lastCreatedAt?: string;
}

export interface MessageQuery {
  limit?: number;
  offset?: number;
  cursor?: string;
  lastCreatedAt?: string;
}

export interface SendMessageBody {
  text?: string;
  type?: string;
  fileIds?: string[];
}

/**
 * Direct message API client.
 *
 * Every endpoint is scoped to the authenticated user by the backend, so no
 * reader identifier is ever sent from here.
 */
export class MessageService extends APIRequest {
  /** GET /api/conversations */
  searchConversations = (query?: ConversationQuery) => this.get(this.buildUrl('/conversations', query as any));

  /** POST /api/conversations — get-or-create the conversation with one user. */
  openConversation = (participantId: string) => this.post('/conversations', { participantId });

  /** GET /api/conversations/{id} */
  getConversation = (id: string) => this.get(`/conversations/${encodeURIComponent(id)}`);

  /** PUT /api/conversations/{id}/read */
  markConversationRead = (id: string) => this.put(`/conversations/${encodeURIComponent(id)}/read`);

  /** GET /api/messages/conversations/{conversationId} */
  searchMessages = (conversationId: string, query?: MessageQuery) => this.get(
    this.buildUrl(`/messages/conversations/${encodeURIComponent(conversationId)}`, query as any)
  );

  /** POST /api/messages/conversations/{conversationId} */
  sendMessage = (conversationId: string, body: SendMessageBody) => this.post(
    `/messages/conversations/${encodeURIComponent(conversationId)}`,
    body
  );

  /** GET /api/messages/unread-count */
  unreadCount = () => this.get('/messages/unread-count');

  /** PUT /api/messages/read-all */
  markAllRead = () => this.put('/messages/read-all');

  /**
   * Upload a photo for a message and resolve to its file id.
   *
   * Reuses the shared upload pipeline rather than posting the file with the
   * message, so a large attachment transfers with progress and the message
   * itself stays a small JSON request.
   */
  async uploadPhoto(file: File, onProgress?: (progress: UploadProgress) => void) {
    const result = await uploadFile('/content/files/message/photo/upload', file, {}, onProgress);
    if (!result.success) throw new Error(result.error || 'Photo upload failed');
    return result;
  }

  /** Upload a video for a message and resolve to its file id. */
  async uploadVideo(file: File, onProgress?: (progress: UploadProgress) => void) {
    const result = await uploadFile('/content/files/message/video/upload', file, {}, onProgress);
    if (!result.success) throw new Error(result.error || 'Video upload failed');
    return result;
  }
}

// === TREE SHAKING EXPORTS ===
const messageServiceInstance = new MessageService();

export const messageService = messageServiceInstance;

export const searchConversations = messageServiceInstance.searchConversations.bind(messageServiceInstance);
export const openConversation = messageServiceInstance.openConversation.bind(messageServiceInstance);
export const getConversation = messageServiceInstance.getConversation.bind(messageServiceInstance);
export const markConversationRead = messageServiceInstance.markConversationRead.bind(messageServiceInstance);
export const searchMessages = messageServiceInstance.searchMessages.bind(messageServiceInstance);
export const sendMessage = messageServiceInstance.sendMessage.bind(messageServiceInstance);
export const getMessageUnreadCount = messageServiceInstance.unreadCount.bind(messageServiceInstance);
export const markAllMessagesRead = messageServiceInstance.markAllRead.bind(messageServiceInstance);
export const uploadMessagePhoto = messageServiceInstance.uploadPhoto.bind(messageServiceInstance);
export const uploadMessageVideo = messageServiceInstance.uploadVideo.bind(messageServiceInstance);
