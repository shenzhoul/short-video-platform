'use client';

import { PostForm } from '@components/content/post/post-form';
import { IPost } from '@interfaces/post';
import { showErrorMessage } from '@lib/utils';
import { update, uploadPhoto, uploadTeaser, uploadThumbnail, uploadVideo } from '@services/post.service';
import { FileUploadItem, uploadFilesInParallel, UploadProgress } from '@utils/upload-utils';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'react-toastify';

interface Props {
  post: IPost;
}

export default function UpdatePostForm({ post }: Props) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [uploadPercentage, setUploadPercentage] = useState(0);

  const handleSubmit = async (
    data: Partial<IPost>,
    files: { files: File[], thumbnail: File | null, teaser: File | null },
    removedData: { files: string[], thumbnailId: boolean, teaserId: boolean, oldThumbnailId: string | null, oldTeaserId: string | null }
  ) => {
    setUploading(true);
    setUploadPercentage(0);

    try {
      const payload: any = { ...data };

      const filesToUpload: FileUploadItem[] = [];
      if (files.thumbnail) filesToUpload.push({ file: files.thumbnail, type: 'thumbnail' });
      if (files.teaser) filesToUpload.push({ file: files.teaser, type: 'teaser' });
      files.files.forEach((file) => {
        // const type = file.type.startsWith('image/') ? 'photo' : file.type.startsWith('audio/') ? 'audio' : 'video';
        // use payload.type to determine the type of file
        filesToUpload.push({ file, type: payload.type as 'photo' | 'video' });
      });

      const newFileIds: string[] = [];
      const uploadErrors: string[] = [];

      if (filesToUpload.length > 0) {
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
                    newFileIds.push(fileId);
                  }
                }
              } else {
                const errorMsg = `Failed to upload ${result.type} "${result.file.name}": ${result.error || 'Unknown error'}`;
                uploadErrors.push(errorMsg);
              }
            }
          }
        );

        // Check if there were any upload errors
        if (uploadErrors.length > 0) {
          // Show specific error messages
          uploadErrors.forEach(error => toast.error(error));

          // If all uploads failed, don't proceed with post update
          if (parallelUploadResult.summary.successful === 0) {
            throw new Error('All file uploads failed');
          }

          // If some uploads succeeded, show a warning but continue
          if (parallelUploadResult.summary.successful > 0) {
            toast.warning(`Some files failed to upload. Proceeding with ${parallelUploadResult.summary.successful} successful uploads.`);
          }
        }
      }

      // Handle existing file IDs
      const existingFileIds = (post.fileIds || []).filter((id) => !removedData.files.includes(id));
      payload.fileIds = [...existingFileIds, ...newFileIds];
      // Handle thumbnail and teaser removal
      if (removedData.thumbnailId) {
        payload.thumbnailId = null;
      }
      if (removedData.teaserId) {
        payload.teaserId = null;
      }

      // Include old file IDs for deletion when replacing
      if (files.thumbnail && removedData.oldThumbnailId) {
        payload.deleteThumbnailId = removedData.oldThumbnailId;
      }
      if (files.teaser && removedData.oldTeaserId) {
        payload.deleteTeaserId = removedData.oldTeaserId;
      }

      await update(post._id, payload);

      toast.success('Post updated successfully!');
      router.push('/content/posts');
    } catch (error: any) {
      showErrorMessage(error);
      setUploading(false);
    }
  };

  return (
    <PostForm
      post={post}
      onSubmit={handleSubmit as any}
      uploading={uploading}
      uploadPercentage={uploadPercentage}
    />
  );
}
