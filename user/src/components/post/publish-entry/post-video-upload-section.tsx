import { CREATOR_VIDEO_ACCEPT } from '@lib/creator-publish';
import type {
  ChangeEventHandler,
  DragEventHandler
} from 'react';
import {
  VideoQualityIcon,
  VideoRatioIcon,
  VideoSizeIcon
} from 'src/icons';

import PostGuidelineTooltip from './post-guideline-tooltip';
import PostUploadDropzone from './post-upload-dropzone';
import PostUploadGuidelines from './post-upload-guidelines';

interface PostVideoUploadSectionProps {
  onChange: ChangeEventHandler<HTMLInputElement>;
  onDrop: DragEventHandler<HTMLLabelElement>;
}

export default function PostVideoUploadSection({
  onChange,
  onDrop
}: PostVideoUploadSectionProps) {
  return (
    <section aria-label="Upload videos">
      <PostUploadGuidelines
        items={[
          {
            title: 'Video size and format',
            description: 'Supports submission of videos under 1 hour and 16GB, encouraging high-quality medium- and long-form videos to express their content fully',
            icon: <VideoSizeIcon />
          },
          {
            title: 'Video image quality',
            description: (
              <>
                Supports submitting 4K videos, allowing good content to be seen in higher definitions and giving you a chance to be selected for Douyin Selects{' '}
                <PostGuidelineTooltip title="The platform will match more suitable image quality for different audiences to play videos according to factors such as viewing equipment, network environment, traffic consumption, etc" />
              </>
            ),
            icon: <VideoQualityIcon />
          },
          {
            title: 'Video frame size',
            description: 'It is recommended to upload videos with aspect ratios of 16:9, 9:16, 3:4, 4:3, and 9:19.5 (5.8 inches).',
            icon: <VideoRatioIcon />
          }
        ]}
      />
      <PostUploadDropzone
        accept={CREATOR_VIDEO_ACCEPT}
        actionLabel="Upload Video"
        description="For a better viewing experience and platform security, the uploaded videos will be reviewed. Videos over 40 seconds are recommended to upload horizontal."
        inputLabel="Upload video"
        title="Drag and drop video files to upload"
        show4kBadge
        onChange={onChange}
        onDrop={onDrop}
      />
    </section>
  );
}
