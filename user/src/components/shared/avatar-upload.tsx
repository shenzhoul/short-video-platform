/**
 * AvatarUpload Component
 *
 * A specialized file upload component for user avatars with cropping functionality.
 * Features drag-and-drop, image cropping, size validation, and automatic API updates.
 *
 * @example
 * // Basic usage
 * <AvatarUpload
 *   previewUrl={user.avatar}
 *   onUploaded={(result) => console.log('Avatar uploaded:', result)}
 * />
 *
 * // With custom size and crop options
 * <AvatarUpload
 *   size="lg"
 *   cropOptions={{ aspect: 1, width: 400, height: 400 }}
 *   cropShape="round"
 *   limitSizeMB={10}
 * />
 *
 * Features:
 * - Image cropping with customizable aspect ratio
 * - Multiple size variants (sm, md, lg, xl)
 * - File size validation
 * - Drag and drop support
 * - Hover effects and loading states
 * - Automatic API integration for avatar updates
 * - Toast notifications for success/error
 */

import ImageCropModal from '@components/ui/image-crop-modal';
import { useFileUpload } from '@hooks/use-file-upload-server';
import { userService } from '@services/user.service';
import {
  ChangeEvent, useEffect, useRef, useState
} from 'react';
import { toast } from 'react-toastify';

// won't allow heic, heif images - they cannot preview in non-Safari browsers
const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif', 'image/tiff', 'image/tif'];
const acceptTypes = '.jpg,.jpeg,.png,.webp,.avif,.tiff,.tif';

interface LocalUploadResult {
  fileId: string;
  fileInfo?: {
    url: string;
  };
}

interface AvatarUploadProps {
  previewUrl?: string;
  limitSizeMB?: number;
  accept?: string;
  autoStart?: boolean;
  onStartUpload?: (file: File) => void;
  onUploaded?: (data: LocalUploadResult) => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  disabled?: boolean;
  cropOptions?: {
    aspect?: number;
    width?: number;
    height?: number;
  };
  cropShape?: 'rect' | 'round';
}

function AvatarUpload({
  previewUrl = '',
  limitSizeMB = 50,
  accept = acceptTypes,
  autoStart = true,
  onStartUpload = () => { },
  onUploaded,
  size = 'md',
  className = '',
  disabled = false,
  cropOptions = {
    aspect: 1,
    width: 300,
    height: 300
  },
  cropShape = 'round'
}: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(previewUrl || null);
  const [showCrop, setShowCrop] = useState(false);

  const { state, uploadFile } = useFileUpload({
    endpoint: '/identity/files/user/avatar/upload',
    uploadOptions: {},
    showSuccessMessage: false,
    maxSizeMB: limitSizeMB,
    allowedTypes,
    onUploadStart: (f) => {
      if (onStartUpload) onStartUpload(f);
    },
    onUploadSuccess: async (result) => {
      // call API to update immediately
      const avatarResponse = await userService.updateAvatar(result.fileId);
      const updatedAvatar = avatarResponse?.data || {};
      const nextAvatarUrl = updatedAvatar.url || result.fileInfo?.url;
      toast.success('Avatar updated successfully');
      if (nextAvatarUrl) setPreview(nextAvatarUrl);
      if (onUploaded) {
        onUploaded({
          fileId: result.fileId,
          fileInfo: nextAvatarUrl ? { url: nextAvatarUrl } : undefined
        });
      }
    }
  });

  // Update preview when previewUrl changes
  useEffect(() => {
    setPreview(previewUrl || null);
  }, [previewUrl]);

  // Size classes
  const sizeClasses = {
    sm: 'w-16 h-16',
    md: 'w-24 h-24',
    lg: 'w-32 h-32',
    xl: 'w-40 h-40'
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const selected = e.target.files?.[0];
    if (!selected) return;

    if (selected.size > (limitSizeMB * 1024 * 1024)) {
      toast.error(`File size exceeds ${limitSizeMB}MB limit.`);
      return;
    }

    setFile(selected);
    setShowCrop(true);
    setPreview(URL.createObjectURL(selected));
  };

  const handleCropDone = async (blob: Blob) => {
    setShowCrop(false);
    // setCroppedBlob(blob);
    setPreview(URL.createObjectURL(blob));

    if (autoStart) {
      try {
        // Convert blob to file for upload
        const uploadableFile = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
        await uploadFile(uploadableFile);
      } catch {
        // Error handling is done by the hook
      }
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !state.isUploading && inputRef.current) {
      inputRef.current.click();
    }
  };

  return (
    <>
      <div className={`relative  ${sizeClasses[size]} ${className}`}>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={handleFileChange}
          disabled={disabled || state.isUploading}
        />

        {/* Avatar Container */}
        <div
          className={`relative w-full h-full rounded-full overflow-hidden shadow-lg
          transition-all duration-200 ${disabled || state.isUploading ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-xl'
            }`}
          onMouseEnter={() => !disabled && !state.isUploading}
          onMouseLeave={() => !disabled && !state.isUploading}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleClick}
        >
          {/* Avatar Image */}
          {preview ? (
            <div>
              <img
                src={preview}
                alt="Avatar"
                className="w-full h-full object-cover"
              />
              <span
                className="absolute inset-0 z-1 block h-full w-full cursor-pointer bg-[rgba(0,0,0,0.3)] bg-center bg-no-repeat bg-size-[32px_32px]"
                style={{ backgroundImage: 'url(/icons/ic_camera.svg)' }}
              />
            </div>
          ) : null}

          {/* Default Avatar Placeholder */}
          {!preview && (
            <div className="w-full h-full bg-linear-to-br from-gray-200 to-gray-300 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
          )}

          {/* Upload Overlay */}
          <div
            className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 transition-opacity duration-200 opacity-0"
          >
            {state.isUploading ? (
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white mx-auto" />
            ) : null}
          </div>
        </div>
      </div>
      {/* Crop Modal */}
      {showCrop && file && cropOptions ? (
        <ImageCropModal
          file={file}
          aspect={cropOptions.aspect}
          width={cropOptions.width}
          height={cropOptions.height}
          onDone={handleCropDone}
          onCancel={() => setShowCrop(false)}
          shape={cropShape || 'round'}
        />
      ) : null}
    </>
  );
}

AvatarUpload.displayName = 'AvatarUpload';

export default AvatarUpload;
