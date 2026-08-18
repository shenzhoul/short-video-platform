'use client';

import Modal from '@components/ui/modal';
import { IUser } from '@interfaces/user';
import { useState } from 'react';
import { FiCopy, FiMinusCircle } from 'react-icons/fi';
import { toast } from 'react-toastify';

interface FollowingCreatorActionsModalProps {
  creator: IUser | null;
  onClose: () => void;
  onUnfollow: (creatorId: string) => Promise<void>;
}

export default function FollowingCreatorActionsModal({
  creator,
  onClose,
  onUnfollow
}: FollowingCreatorActionsModalProps) {
  const [unfollowing, setUnfollowing] = useState(false);

  const copyDouyinId = async () => {
    if (!creator?.username) return;
    try {
      await navigator.clipboard.writeText(creator.username);
      toast.success('Douyin ID copied');
    } catch {
      toast.error('Unable to copy Douyin ID');
    }
  };

  const handleUnfollow = async () => {
    if (!creator || unfollowing) return;
    setUnfollowing(true);
    try {
      await onUnfollow(creator._id);
      toast.success(`Unfollowed ${creator.name || creator.username}`);
      onClose();
    } catch (error: any) {
      toast.error(error?.message || 'Unable to unfollow this creator');
    } finally {
      setUnfollowing(false);
    }
  };

  return (
    <Modal
      open={Boolean(creator)}
      onCancel={onClose}
      footer={false}
      noPadding
      width={320}
      className="overflow-hidden border border-(--border-faint) bg-(--surface-raised) text-(--text-strong) shadow-(--shadow-popover)"
    >
      {creator ? (
        <div>
          <div className="px-4 pb-4 pt-4 pr-12">
            <p className="truncate text-[15px] font-semibold">{creator.name || creator.username}</p>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-(--text-muted)">
              <span>Douyin ID: {creator.username}</span>
              <button
                type="button"
                onClick={() => void copyDouyinId()}
                className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-base transition hover:bg-(--hover-bg) hover:text-(--text-strong) focus-visible:outline-2 focus-visible:outline-[#fe2c55]"
                aria-label={`Copy Douyin ID ${creator.username}`}
              >
                <FiCopy />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleUnfollow()}
            disabled={unfollowing}
            className="flex h-13 w-full cursor-pointer items-center justify-between border-t border-(--border-faint) px-4 text-left text-sm font-medium text-[#fe2c55] transition hover:bg-(--hover-bg) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#fe2c55] disabled:cursor-wait disabled:opacity-60"
          >
            <span>{unfollowing ? 'Unfollowing...' : 'Cancel following'}</span>
            <FiMinusCircle className="text-lg" />
          </button>
        </div>
      ) : null}
    </Modal>
  );
}
