'use client';

import Button from '@components/ui/button';
import { recordShare } from '@services/reaction.service';
import { ReactNode, useState } from 'react';
import { AiOutlineShareAlt } from 'react-icons/ai';

import SharePanel from './share-panel';

interface ShareButtonProps {
  /** The URL to share. If not provided, will use current page URL with postId */
  url?: string;
  /** Post ID to construct the URL */
  postId?: string;
  /** Button variant */
  content?: 'icon' | 'text';
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Custom className */
  className?: string;
  /** Children to render inside button */
  children?: ReactNode;
  /** Disabled state */
  disabled?: boolean;
  variant?: 'primary' | 'grey' | 'grey-light' | 'border';
  iconSize?: number;
  /** Title for share (used in navigator.share) */
  shareTitle?: string;
  /** Text for share (used in navigator.share) */
  shareMessage?: string;
  /** Notifies the owner view so the share counter can move without a refetch. */
  onShared?: () => void;
}

/**
 * ShareButton - opens the application's own share panel.
 *
 * The panel is the primary surface; the platform's native share sheet is offered
 * inside it as a secondary action rather than being the first thing a user sees.
 *
 * Recording a share is deliberately separate from opening the panel: the backend
 * counter and the owner's notification are meant to reflect real shares, so only
 * a completed copy or a completed native share reports one.
 *
 * @example
 * <ShareButton postId="123" content="icon" onShared={handleShared} />
 */
export default function ShareButton({
  url,
  postId,
  content,
  size = 'md',
  className = '',
  children,
  disabled = false,
  variant,
  iconSize,
  shareTitle = 'Check this out',
  shareMessage,
  onShared
}: ShareButtonProps) {
  const [panelOpen, setPanelOpen] = useState(false);

  const getShareUrl = (): string => {
    let link = url;

    // If URL is provided but is a relative path, prepend the origin
    if (link && link.startsWith('/')) {
      link = `${window.location.origin}${link}`;
    }

    // Post details are rendered by the feed modal rather than a standalone page.
    if (!link && postId) {
      const postUrl = new URL('/', window.location.origin);
      postUrl.searchParams.set('modal_id', postId);
      link = postUrl.toString();
    }

    // Fallback to current page URL
    if (!link) {
      link = window.location.href;
    }

    return link;
  };

  /**
   * Report a completed share so the owner is notified and the counter moves.
   *
   * The counter only advances when the backend reports it recorded a *new*
   * sharer. `totalShare` counts distinct users, so a repeat share by the same
   * person must leave it alone — deciding that here from a local guess would
   * duplicate a rule the backend already owns, so the response is authoritative.
   *
   * Failures are swallowed: the share already happened on the client, so a
   * reporting failure must not surface an error or undo it.
   */
  const handleShared = async () => {
    if (!postId) return;
    try {
      const response = await recordShare('post', postId);
      if (response?.data?.created) onShared?.();
    } catch {
      // Nothing to correct on screen: the counter was never moved.
    }
  };

  const renderContent = () => {
    if (children) return children;
    if (content === 'icon') return <AiOutlineShareAlt size={iconSize} />;
    if (content === 'text') return 'Share';
    return <><AiOutlineShareAlt size={iconSize} /> Share</>;
  };

  return (
    <>
      <Button
        onClick={() => setPanelOpen(true)}
        disabled={disabled}
        className={className}
        title="Share"
        variant={variant}
        size={size}
      >
        {renderContent()}
      </Button>

      {panelOpen ? (
        <SharePanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          shareUrl={getShareUrl()}
          shareTitle={shareTitle}
          shareMessage={shareMessage}
          onShared={handleShared}
        />
      ) : null}
    </>
  );
}
