import { CREATOR_PHOTO_ACCEPT } from '@lib/creator-publish';
import type { ChangeEventHandler, DragEventHandler } from 'react';
import {
  ImageExtIcon,
  VideoRatioIcon,
  VideoSizeIcon
} from 'src/icons';

import PostGuidelineTooltip from './post-guideline-tooltip';
import PostUploadDropzone from './post-upload-dropzone';
import PostUploadGuidelines from './post-upload-guidelines';

interface PostPhotoUploadSectionProps {
  onChange: ChangeEventHandler<HTMLInputElement>;
  onDrop: DragEventHandler<HTMLLabelElement>;
}

export default function PostPhotoUploadSection({
  onChange,
  onDrop
}: PostPhotoUploadSectionProps) {
  return (
    <section aria-label="Upload graphics">
      <PostUploadGuidelines
        items={[
          {
            title: 'Image formats',
            description: (
              <>
                Recommended formats include jpg, jpeg, png, and webp; gif format is not supported{' '}
                <PostGuidelineTooltip title="More supported formats: bmp, tif, raw" />
              </>
            ),
            icon: <ImageExtIcon />
          },
          {
            title: 'Image size',
            description: 'Image file size must not exceed 50MB',
            icon: <VideoSizeIcon />
          },
          {
            title: 'Image scale',
            description: (
              <>
                It is not recommended to have a aspect ratio greater than 1:2; the recommended image aspect ratio is 3:4, 4:3{' '}
                <PostGuidelineTooltip title="Other recommended upload image ratios: 1:1, 9:16, 16:9" />
              </>
            ),
            icon: <VideoRatioIcon />
          }
        ]}
      />
      <PostUploadDropzone
        accept={CREATOR_PHOTO_ACCEPT}
        actionLabel="Upload Photos"
        description="Select photo files to prepare a graphic post."
        inputLabel="Upload photos"
        multiple
        onChange={onChange}
        onDrop={onDrop}
        title="Drag and drop image files to upload"
      />
    </section>
  );
}
