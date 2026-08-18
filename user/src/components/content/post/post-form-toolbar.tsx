'use client';

import Button from '@components/ui/button';
import Modal from '@components/ui/modal';
import { Tooltip } from '@components/ui/tooltip';
import { useState } from 'react';
import {
  FiDollarSign,
  FiImage,
  FiMoreHorizontal,
  FiVideo
} from 'react-icons/fi';

export type PostTypeValue = 'text' | 'photo' | 'video';

type ToolbarModal = 'monetization' | 'more' | null;

interface ToolbarButtonProps {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ active, disabled, title, onClick, children }: ToolbarButtonProps) {
  return (
    <Tooltip title={title} placement="top">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 ${active ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

interface MoreOptionsModalContentProps {
  status: string;
  onConfirm: (status: 'active' | 'inactive') => void;
}

function MoreOptionsModalContent({
  status,
  onConfirm
}: MoreOptionsModalContentProps) {
  const [statusVal, setStatusVal] = useState<'active' | 'inactive'>(status as 'active' | 'inactive');

  return (
    <div className="space-y-4">
      <div>
        <label className="block mb-1 font-medium opacity-70">Status</label>
        <select
          value={statusVal}
          onChange={(e) => setStatusVal(e.target.value as 'active' | 'inactive')}
          className="w-full px-2 bg-input rounded-[8px] h-[40px] border border-border focus:outline-hidden focus:ring-2 focus:ring-primary"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button onClick={() => onConfirm(statusVal)}>
          Apply
        </Button>
      </div>
    </div>
  );
}

export interface PostFormToolbarProps {
  initialType: PostTypeValue;
  postType: PostTypeValue;
  setPostType: (type: PostTypeValue) => void;
  /** When user clicks Photo/Video/Audio, call this to open upload modal (e.g. in parent). */
  onPostTypeWithMedia?: (type: 'photo' | 'video') => void;
  status: string;
  setStatus: (status: 'active' | 'inactive') => void;
  isEditing?: boolean;
  uploading?: boolean;
}

export function PostFormToolbar({
  initialType,
  postType,
  setPostType,
  status,
  setStatus,
  onPostTypeWithMedia,
  uploading = false
}: PostFormToolbarProps) {
  const [openModal, setOpenModal] = useState<ToolbarModal>(null);

  const closeModalAndResetType = () => {
    setOpenModal(null);
    setPostType(initialType);
  };

  const handlePostTypeClick = (type: PostTypeValue) => {
    const nextType = postType === type ? 'text' : type;
    setPostType(nextType);
    if (nextType === 'photo' || nextType === 'video') {
      onPostTypeWithMedia?.(nextType);
    }
  };

  const handleMoreConfirm = (newStatus: 'active' | 'inactive') => {
    setStatus(newStatus);
    setOpenModal(null);
  };

  const showMonetization = ['photo', 'video'].includes(postType);
  const disabled = uploading;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 p-2 scrollbar-thin">
        <ToolbarButton
          active={postType === 'photo'}
          disabled={disabled}
          title="Photo"
          onClick={() => handlePostTypeClick('photo')}
        >
          <FiImage size={20} />
        </ToolbarButton>
        <ToolbarButton
          active={postType === 'video'}
          disabled={disabled}
          title="Video"
          onClick={() => handlePostTypeClick('video')}
        >
          <FiVideo size={20} />
        </ToolbarButton>
        {showMonetization ? (
          <ToolbarButton
            disabled={disabled}
            title="Monetization"
            onClick={() => setOpenModal('monetization')}
          >
            <FiDollarSign size={20} />
          </ToolbarButton>
        ) : null}
        <ToolbarButton
          active={openModal === 'more'}
          disabled={disabled}
          title="More options"
          onClick={() => setOpenModal('more')}
        >
          <FiMoreHorizontal size={20} />
        </ToolbarButton>
      </div>

      {/* More options modal */}
      {openModal === 'more' && (
        <Modal
          title="More options"
          open={openModal === 'more'}
          onCancel={closeModalAndResetType}
          footer={false}
          width={360}
          maskClosable={false}
        >
          <MoreOptionsModalContent
            status={status}
            onConfirm={handleMoreConfirm}
          />
        </Modal>
      )}
    </div>
  );
}

export default PostFormToolbar;
