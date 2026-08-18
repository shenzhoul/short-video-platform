'use client';

interface CreatorProfileAvatarPreviewProps {
  avatar?: string;
  displayName: string;
  username: string;
  open: boolean;
  onClose: () => void;
}

export default function CreatorProfileAvatarPreview({
  avatar,
  displayName,
  username,
  open,
  onClose
}: CreatorProfileAvatarPreviewProps) {
  if (!open || !avatar) return null;

  return (
    <div
      className="fixed inset-0 z-1000 flex items-center justify-center bg-black/80"
      onClick={onClose}
      role="button"
      tabIndex={0}
      aria-label="Close avatar preview"
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
          onClose();
        }
      }}
    >
      <img
        src={avatar}
        alt={`${displayName || username} avatar`}
        className="max-h-[62vh] max-w-[62vw] object-contain"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
