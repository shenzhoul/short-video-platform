'use client';

import type { IMessage, IMessageFile, IPendingMessage } from '@interfaces/message';
import { MESSAGE_TYPE } from '@interfaces/message';
import { FiAlertCircle, FiPlay } from 'react-icons/fi';

interface MessageBubbleProps {
  message: IMessage | IPendingMessage;
  outgoing: boolean;
  avatar?: string | null;
  /** Present only on a bubble that has not been confirmed by the server. */
  pending?: IPendingMessage;
  onRetry?: () => void;
  onDismiss?: () => void;
}

/**
 * Widest a bubble may grow.
 *
 * Applied to the column that holds the bubble, not to the bubble itself: the
 * column is shrink-to-fit, so a percentage on the bubble would resolve against
 * its own content and squeeze short messages into needless line breaks. On the
 * row — which is full width — the percentage means what it reads as.
 *
 * A bubble that stretches the whole column stops looking like a conversation,
 * and the pixel cap keeps a long message the same shape in the 360px panel and
 * on the wide page instead of turning into a paragraph on one of them.
 */
const BUBBLE_MAX_WIDTH = 'max-w-[min(78%,420px)]';

/**
 * Box a media attachment occupies before it loads.
 *
 * Derived from the file's real dimensions so the bubble reserves the right
 * shape up front. Without this the thread jumps as each image arrives, which is
 * especially bad here because the thread is pinned to the bottom.
 */
function resolveMediaSize(file: IMessageFile | undefined) {
  const maxWidth = 220;
  const maxHeight = 300;
  const width = file?.width || 0;
  const height = file?.height || 0;
  if (!width || !height) return { width: maxWidth, height: 165 };

  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale)
  };
}

function MediaAttachment({
  file,
  type,
  progress
}: {
  file?: IMessageFile;
  type: string;
  progress?: number;
}) {
  const size = resolveMediaSize(file);
  const poster = file?.thumbnails?.[0];
  const isUploading = typeof progress === 'number' && progress < 100;

  return (
    <div
      className="relative overflow-hidden rounded-xl bg-(--surface-muted)"
      style={{ width: size.width, height: size.height }}
    >
      {type === MESSAGE_TYPE.VIDEO ? (
        <>
          {poster || file?.url ? (
            <video
              src={file?.url}
              poster={poster}
              controls={!isUploading}
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : null}
          {isUploading ? (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 text-white">
              <FiPlay aria-hidden="true" className="text-2xl" />
            </span>
          ) : null}
        </>
      ) : (
        file?.url ? (
          <img src={file.url} alt="" className="h-full w-full object-cover" />
        ) : null
      )}

      {isUploading ? (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/25">
          <div
            className="h-full bg-[#fe2c55] transition-[width] duration-200"
            style={{ width: `${Math.max(4, progress || 0)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One message, incoming or outgoing.
 *
 * Handles the confirmed and the still-pending forms together, because they are
 * the same bubble at different moments — rendering them from two components
 * would make a message visibly change shape at the instant it was confirmed.
 */
export default function MessageBubble({
  message,
  outgoing,
  avatar,
  pending,
  onRetry,
  onDismiss
}: MessageBubbleProps) {
  const files = message.files || [];
  const hasMedia = files.length > 0 && message.type !== MESSAGE_TYPE.TEXT;
  const failed = pending?.status === 'failed';

  return (
    <div className={`flex w-full items-end gap-2 ${outgoing ? 'flex-row-reverse' : 'flex-row'}`}>
      {!outgoing ? (
        <img
          src={avatar || '/no_avatar.jpeg'}
          alt=""
          className="h-7 w-7 shrink-0 rounded-full object-cover"
        />
      ) : null}

      <div className={`flex min-w-0 flex-col gap-1 ${BUBBLE_MAX_WIDTH} ${outgoing ? 'items-end' : 'items-start'}`}>
        {hasMedia ? (
          <div className={pending?.status === 'uploading' ? 'opacity-90' : ''}>
            <MediaAttachment
              file={files[0]}
              type={message.type}
              progress={pending?.progress}
            />
          </div>
        ) : null}

        {message.text ? (
          <div
            className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[14px] leading-5 ${
              outgoing
                ? 'bg-[#fe2c55] text-white'
                : 'bg-(--surface-soft) text-(--text-strong)'
            } ${failed ? 'opacity-60' : ''}`}
          >
            {message.text}
          </div>
        ) : null}

        {failed ? (
          <div className="flex items-center gap-2 text-[12px] text-[#ff2f5f]">
            <FiAlertCircle aria-hidden="true" />
            <span>{pending?.error || 'Not sent'}</span>
            {onRetry ? (
              <button type="button" onClick={onRetry} className="cursor-pointer font-semibold underline">
                Retry
              </button>
            ) : null}
            {onDismiss ? (
              <button type="button" onClick={onDismiss} className="cursor-pointer font-semibold underline">
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
