import { CREATOR_VIDEO_ACCEPT } from '@lib/creator-publish';
import { toast } from 'react-toastify';
import {
  VideoExtIcon,
  VideoQualityIcon,
  VideoSizeIcon
} from 'src/icons';

import PostGuidelineTooltip from './post-guideline-tooltip';
import PostUploadDropzone from './post-upload-dropzone';
import PostUploadGuidelines from './post-upload-guidelines';

export default function PostVrUploadSection() {
  return (
    <section aria-label="Upload VR">
      <PostUploadGuidelines
        items={[
          {
            title: 'Video formats',
            description: 'Supports common video formats; recommended are mp4 and mov',
            icon: <VideoExtIcon />
          },
          {
            title: 'Size and duration',
            description: 'Size not exceeding 16GB, duration within 10 minutes',
            icon: <VideoSizeIcon />
          },
          {
            title: 'Video resolutions',
            description: (
              <>
                The recommended resolution is 4K (3840x1920) or above{' '}
                <PostGuidelineTooltip title="Video bit rate, encoding format and other parameters are unlimited" />
              </>
            ),
            icon: <VideoQualityIcon />
          }
        ]}
      />
      <PostUploadDropzone
        accept={CREATOR_VIDEO_ACCEPT}
        actionLabel="Upload Panoramic Video"
        description="For a better experience and platform security, the uploaded videos will be reviewed."
        inputLabel="Upload panoramic video"
        title="Drag and drop panoramic video files to upload"
        show4kBadge
        onChange={() => toast.warning('Coming soon')}
        onDrop={() => toast.warning('Coming soon')}
      />
    </section>
  );
}
