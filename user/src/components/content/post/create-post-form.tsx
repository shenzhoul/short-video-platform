'use client';

import { PostForm } from '@components/content/post/post-form';
import { IPost } from '@interfaces/post';
import { showErrorMessage } from '@lib/utils';
import { create, uploadPhoto, uploadTeaser, uploadThumbnail, uploadVideo } from '@services/post.service';
import { getUserFriendlyUploadErrorMessage, isUploadSizeLimitError } from '@utils/file-validation';
import { FileUploadItem, uploadFilesInParallel, UploadProgress } from '@utils/upload-utils';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'react-toastify';

export default function CreatePostForm({ showCancelButton = true }: { showCancelButton?: boolean }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [uploadPercentage, setUploadPercentage] = useState(0);

  const handleSubmit = async (
    data: Partial<IPost>,
    files: { files: File[], thumbnail: File | null, teaser: File | null },
    _removedData: { files: string[], thumbnailId: boolean, teaserId: boolean, oldThumbnailId: string | null, oldTeaserId: string | null } // Not used in create
  ) => {
    setUploading(true);
    setUploadPercentage(0);

    try {
      const payload = { ...data };

      const filesToUpload: FileUploadItem[] = [];
      if (files.thumbnail) filesToUpload.push({ file: files.thumbnail, type: 'thumbnail' });
      if (files.teaser) filesToUpload.push({ file: files.teaser, type: 'teaser' });
      // Handle all media files (photos and videos)
      files.files.forEach((file) => {
        // use payload.type to determine the type of file
        filesToUpload.push({ file, type: payload.type as 'photo' | 'video' });
      });

      if (filesToUpload.length === 0) {
        // If no files are uploaded, create the post without files
        await create(payload);
        toast.success('Post created successfully!');
        router.push('/content/posts');
        return;
      }

      const fileIds: string[] = [];
      const uploadErrors: string[] = [];

      // Upload files in parallel
      const uploadFunction = async (file: File, type: string, onProgress?: (progress: UploadProgress) => void) => {
        // Convert from file-upload.service UploadProgress to upload-utils UploadProgress
        const progressAdapter = onProgress ? (serviceProgress: any) => {
          onProgress({
            percentage: serviceProgress.percentage,
            bytesUploaded: serviceProgress.loaded,
            totalBytes: serviceProgress.total,
            speed: serviceProgress.speed
          });
        } : undefined;

        if (type === 'thumbnail') {
          return await uploadThumbnail(file, undefined, progressAdapter);
        } else if (type === 'photo') {
          return await uploadPhoto(file, progressAdapter);
        } else if (type === 'teaser') {
          return await uploadTeaser(file, undefined, progressAdapter);
        } else if (type === 'video') {
          return await uploadVideo(file, undefined, progressAdapter);
        }
      };

      const parallelUploadResult = await uploadFilesInParallel(
        filesToUpload,
        uploadFunction,
        {
          maxConcurrency: 3,
          onProgress: (progress) => {
            setUploadPercentage(progress.percentage);
          },
          onFileComplete: (result) => {
            if (result.success) {
              const fileId = result.fileId;
              if (fileId) {
                if (result.type === 'thumbnail') {
                  payload.thumbnailId = fileId;
                } else if (result.type === 'teaser') {
                  payload.teaserId = fileId;
                } else {
                  fileIds.push(fileId);
                }
              }
            } else {
              const friendlyError = getUserFriendlyUploadErrorMessage(result.error, 'Unknown error');
              const errorMsg = isUploadSizeLimitError(result.error)
                ? friendlyError
                : `Failed to upload ${result.type} "${result.file.name}": ${friendlyError}`;
              uploadErrors.push(errorMsg);
            }
          }
        }
      );

      // Check if there were any upload errors
      if (uploadErrors.length > 0) {
        // Show specific error messages
        uploadErrors.forEach(error => toast.error(error));

        // If all uploads failed, don't proceed with post creation
        if (parallelUploadResult.summary.successful === 0) {
          setUploading(false);
          return;
        }

        // If some uploads succeeded, show a warning but continue
        if (parallelUploadResult.summary.successful > 0) {
          toast.warning(`Some files failed to upload. Proceeding with ${parallelUploadResult.summary.successful} successful uploads.`);
        }
      }

      payload.fileIds = fileIds;

      await create(payload);

      toast.success('Post created successfully!');
      router.push('/content/posts');
    } catch (error: any) {
      showErrorMessage(error);
      setUploading(false);
    }
  };

  return (
    <PostForm
      showCancelButton={showCancelButton}
      onSubmit={handleSubmit}
      uploading={uploading}
      uploadPercentage={uploadPercentage}
    />
  );
}
