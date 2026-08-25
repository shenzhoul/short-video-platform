import ImageCropModal from '@components/ui/image-crop-modal';
import { toast } from '@douyin-clone/shared-toast';
import { useFileUpload } from '@hooks/use-file-upload-server';
import { acceptAttributeFor, COVER_UPLOAD_TYPE, describeRejectedUpload } from '@lib/upload-policy';
import { updateCover } from '@services/creator.service';
import {
  ChangeEvent, CSSProperties, MouseEvent, useEffect, useRef, useState
} from 'react';

// won't allow heic, heif images - they cannot preview in non-Safari browsers
/**
 * What the picker advertises, from the cover policy.
 *
 * The hand-written list this replaces offered TIFF, which the image
 * pipeline has never decoded — so the picker invited a file the server was
 * always going to refuse. A hint either way: `accept` is bypassed by
 * choosing "All files" and ignored outright on some platforms.
 */
const acceptTypes = acceptAttributeFor(COVER_UPLOAD_TYPE);

interface LocalUploadResult {
  fileId: string;
  fileInfo?: {
    url: string;
    coverBgColor?: string;
  };
}

interface CoverUploadProps {
  previewUrl?: string;
  coverBgColor?: string;
  accept?: string;
  autoStart?: boolean;
  onStartUpload?: (file: File) => void;
  onUploaded?: (data: LocalUploadResult) => void;
  className?: string;
  editable?: boolean;
  disabled?: boolean;
  cropOptions?: {
    aspect?: number;
    width?: number;
    height?: number;
  };
  cropShape?: 'rect' | 'round';
}

/**
 * Cover Upload Component
 *
 * A reusable component for uploading and cropping cover images.
 * Follows the same pattern as AvatarUpload but optimized for cover images.
 *
 * Features:
 * - Image cropping with customizable aspect ratio (default 10:3 for covers)
 * - Automatic upload after cropping
 * - Progress tracking and error handling
 * - Preview functionality
 * - Hover effects for better UX
 *
 * @author ShenZhoul
 */
function CoverUpload({
  previewUrl = '',
  coverBgColor = 'hsl(313deg 26.38% 15%)',
  accept = acceptTypes,
  autoStart = true,
  onStartUpload = () => { },
  onUploaded,
  className = '',
  editable = true,
  disabled = false,
  cropOptions = {
    aspect: 10 / 3,
    width: 1200,
    height: 360
  },
  cropShape = 'rect'
}: CoverUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(previewUrl || null);
  const [showCrop, setShowCrop] = useState(false);
  const [isLocalPreview, setIsLocalPreview] = useState(false);
  const coverUrl = preview || previewUrl || '';
  const hasCover = !!coverUrl;
  const canUpload = editable && !disabled;

  const { state, uploadFile } = useFileUpload({
    endpoint: '/identity/files/creator/cover/upload',
    // The durable type the API writes onto the record, so the picker holds the
    // file to exactly the limits the upload will be judged by.
    uploadType: COVER_UPLOAD_TYPE,
    uploadOptions: {},
    showSuccessMessage: false,
    onUploadStart: (f) => {
      if (onStartUpload) onStartUpload(f);
    },
    onUploadSuccess: async (result) => {
      // Same as the avatar: the API claims the file before repointing the
      // profile and refuses (409) if it cannot, and this callback is not
      // awaited — so an uncaught rejection would leave the old cover in place
      // with no explanation.
      let coverResponse;
      try {
        coverResponse = await updateCover(result.fileId);
      } catch (error: any) {
        toast.error(error?.message || error?.data?.message || 'Could not update your cover. Please try again.');
        setIsLocalPreview(false);
        setPreview(previewUrl || null);
        return;
      }

      const updatedCover = coverResponse?.data || {};
      toast.success('Cover updated successfully');
      const nextCoverUrl = updatedCover.url || result.fileInfo?.url;
      if (nextCoverUrl) {
        setPreview(nextCoverUrl);
        setIsLocalPreview(false);
      }
      if (onUploaded) {
        onUploaded({
          fileId: result.fileId,
          fileInfo: nextCoverUrl ? {
            url: nextCoverUrl,
            coverBgColor: updatedCover.coverBgColor
          } : undefined
        });
      }
    }
  });
  const isUploadBlocked = !canUpload || state.isUploading;

  // Update preview when previewUrl changes
  useEffect(() => {
    if (!isLocalPreview) {
      setPreview(previewUrl || null);
    }
  }, [previewUrl, isLocalPreview]);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const selected = e.target.files?.[0];
    if (!selected) return;

    // Judged against the cover policy rather than a per-caller number. What is
    // uploaded is the cropped JPEG, so this is the early warning and the hook
    // checks the crop again before sending.
    const rejection = await describeRejectedUpload(selected, COVER_UPLOAD_TYPE);
    if (rejection) {
      toast.error(rejection);
      // Cleared so picking the same file again re-fires `change`.
      e.target.value = '';
      return;
    }

    setFile(selected);
    setShowCrop(true);
  };

  const handleCropDone = async (blob: Blob) => {
    setShowCrop(false);

    const croppedUrl = URL.createObjectURL(blob);
    setPreview(croppedUrl);
    setIsLocalPreview(true);

    if (autoStart) {
      const uploadableFile = new File([blob], 'cover.jpg', {
        type: 'image/jpeg'
      });
      await uploadFile(uploadableFile);
    }
  };

  const handleClick = (e: MouseEvent) => {
    if (isUploadBlocked || !inputRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    inputRef.current.click();
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (!isUploadBlocked) e.preventDefault();
  };

  return (
    <>
      <div className={`w-full h-[251px] mt-[-68px] relative overflow-hidden ${!hasCover ? 'bg-douyin' : ''} ${className}`}>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={handleFileChange}
          disabled={isUploadBlocked}
        />

        <div
          className={`relative h-full w-full transition-all duration-200 ${state.isUploading
            ? 'opacity-50 cursor-not-allowed'
            : canUpload
              ? 'cursor-pointer'
              : ''
            }`}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
        >
          {hasCover ? (
            <>
              <div className='h-[281px] w-[672px] absolute top-0 right-0'>
                <div
                  className='opacity-40 w-[672px] h-[277px] bg-no-repeat bg-cover mt-[-48px]'
                  style={{
                    backgroundImage: `url(${coverUrl})`
                  }}
                />
              </div>
              <div
                className='bg-douyin-gradient'
                style={
                  {
                    '--cover-bg': coverBgColor
                  } as CSSProperties & {
                    '--cover-bg': string;
                  }
                }
              />
              <div className='bg-mask-bottom' />
              <div className='bg-mask-top' />
              <div className='bg-mask-right' />
            </>
          ) : null}
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
          shape={cropShape || 'rect'}
        />
      ) : null}
    </>
  );
}

CoverUpload.displayName = 'CoverUpload';

export default CoverUpload;
