'use client';

import { toast } from '@douyin-clone/shared-toast';
import { useAuthModal } from '@providers/auth-modal.provider';
import { useProfile } from '@providers/profile.provider';
import { followCreator, unfollowCreator } from '@services/user.service';
import { useCallback, useEffect, useState } from 'react';

const followedInSession = new Set<string>();
const unfollowedInSession = new Set<string>();
const FOLLOW_EVENT = 'douyin:creator-followed';

interface FollowChange {
  creatorId: string;
  isFollowed: boolean;
}

function resolveInitialState(creatorId?: string, initialIsFollowed = false) {
  if (!creatorId) return initialIsFollowed;
  if (followedInSession.has(creatorId)) return true;
  if (unfollowedInSession.has(creatorId)) return false;
  return initialIsFollowed;
}

export function useFollowCreator(
  creatorId?: string,
  initialIsFollowed = false,
  onFollow?: (creatorId: string) => void,
  onFollowChange?: (creatorId: string, isFollowed: boolean) => void
) {
  const { current } = useProfile();
  const { openAuthModal } = useAuthModal();
  const [isFollowed, setIsFollowed] = useState(() => resolveInitialState(creatorId, initialIsFollowed));
  const [following, setFollowing] = useState(false);
  const isOwner = Boolean(creatorId && current?._id === creatorId);

  useEffect(() => {
    setIsFollowed(resolveInitialState(creatorId, initialIsFollowed));
  }, [creatorId, initialIsFollowed]);

  useEffect(() => {
    const sync = (event: Event) => {
      const change = (event as CustomEvent<FollowChange>).detail;
      if (change?.creatorId === creatorId) setIsFollowed(change.isFollowed);
    };
    window.addEventListener(FOLLOW_EVENT, sync);
    return () => window.removeEventListener(FOLLOW_EVENT, sync);
  }, [creatorId]);

  const applyChange = useCallback((nextIsFollowed: boolean) => {
    if (!creatorId) return;
    if (nextIsFollowed) {
      followedInSession.add(creatorId);
      unfollowedInSession.delete(creatorId);
    } else {
      unfollowedInSession.add(creatorId);
      followedInSession.delete(creatorId);
    }
    setIsFollowed(nextIsFollowed);
    window.dispatchEvent(new CustomEvent<FollowChange>(FOLLOW_EVENT, {
      detail: { creatorId, isFollowed: nextIsFollowed }
    }));
    if (nextIsFollowed) onFollow?.(creatorId);
    onFollowChange?.(creatorId, nextIsFollowed);
  }, [creatorId, onFollow, onFollowChange]);

  const follow = useCallback(async () => {
    if (!creatorId || isOwner || isFollowed || following) return;
    if (!current?._id) {
      // The dialog is the message. Following is not retried automatically after
      // signing in: a queued follow that fires later is a follow the visitor did
      // not press.
      openAuthModal();
      return;
    }

    setFollowing(true);
    try {
      await followCreator(creatorId);
      applyChange(true);
      toast.success('Successfully followed creator');
    } catch (error: any) {
      toast.error(error?.message || 'Unable to follow this creator');
    } finally {
      setFollowing(false);
    }
  }, [applyChange, creatorId, current?._id, following, isFollowed, isOwner, openAuthModal]);

  const unfollow = useCallback(async () => {
    if (!creatorId || isOwner || !isFollowed || following) return;
    if (!current?._id) {
      openAuthModal();
      return;
    }

    setFollowing(true);
    try {
      await unfollowCreator(creatorId);
      applyChange(false);
      toast.success('Unfollowed creator');
    } catch (error: any) {
      toast.error(error?.message || 'Unable to unfollow this creator');
    } finally {
      setFollowing(false);
    }
  }, [applyChange, creatorId, current?._id, following, isFollowed, isOwner, openAuthModal]);

  const toggleFollow = useCallback(async () => {
    if (isFollowed) await unfollow();
    else await follow();
  }, [follow, isFollowed, unfollow]);

  return { isFollowed, isOwner, following, follow, unfollow, toggleFollow };
}
