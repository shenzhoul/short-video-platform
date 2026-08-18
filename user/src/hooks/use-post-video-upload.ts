'use client';

import type { UploadProgress } from '@services/file-upload.service';
import { uploadVideo } from '@services/post.service';
import {
  FILE_VALIDATION_PRESETS,
  getUserFriendlyUploadErrorMessage,
  validateFileSize
} from '@utils/file-validation';
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { toast } from 'react-toastify';

export interface PostVideoUploadState {
  fileName: string;
  fileSize: number;
  progress: number;
  loaded: number;
  speed: number;
  timeRemaining: number;
}

interface UsePostVideoUploadOptions {
  initialPreviewUrl: string;
  initialUploadFile: File | null;
  onUploadStart: (fileName: string) => void;
  onUploadPrepared: (fileId: string, fileName: string) => void;
  onUploadComplete: (fileId: string) => void;
  onUploadInterrupted: (state: 'interrupted' | 'failed') => void;
  onUploadStateChange: (isUploading: boolean) => void;
  onPreviewUrlChange?: (previewUrl: string) => void;
}

const isAcceptedVideoFile = (file: File) => {
  if (file.type.startsWith('video/')) return true;
  const extension = file.name.toLowerCase().split('.').pop();
  return extension === 'hevc'
    || FILE_VALIDATION_PRESETS.VIDEO.allowedExtensions.includes(extension || '');
};

export function usePostVideoUpload({
  initialPreviewUrl,
  initialUploadFile,
  onUploadStart,
  onUploadPrepared,
  onUploadComplete,
  onUploadInterrupted,
  onUploadStateChange,
  onPreviewUrlChange
}: UsePostVideoUploadOptions) {
  const [upload, setUpload] = useState<PostVideoUploadState | null>(null);
  const [previewUrl, setPreviewUrl] = useState(initialPreviewUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadRequestIdRef = useRef(0);
  const uploadStartedAtRef = useRef(0);
  const initialUploadStartedRef = useRef(false);

  useEffect(() => () => {
    uploadRequestIdRef.current += 1;
  }, []);

  useEffect(() => {
    if (!initialPreviewUrl) return;
    setPreviewUrl(initialPreviewUrl);
    onPreviewUrlChange?.(initialPreviewUrl);
  }, [initialPreviewUrl, onPreviewUrlChange]);

  useEffect(() => () => {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const uploadSelectedFile = useCallback(async (file: File) => {
    const sizeValidation = validateFileSize(file, FILE_VALIDATION_PRESETS.VIDEO.maxSizeMB);
    if (!sizeValidation.isValid) {
      toast.error(sizeValidation.error || 'The selected video is too large.');
      return;
    }
    if (!isAcceptedVideoFile(file)) {
      toast.error('Please select a supported video file.');
      return;
    }

    const requestId = uploadRequestIdRef.current + 1;
    uploadRequestIdRef.current = requestId;
    uploadStartedAtRef.current = Date.now();
    const localPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(localPreviewUrl);
    onPreviewUrlChange?.(localPreviewUrl);
    setUpload({
      fileName: file.name,
      fileSize: file.size,
      progress: 0,
      loaded: 0,
      speed: 0,
      timeRemaining: 0
    });
    onUploadStart(file.name);
    onUploadStateChange(true);

    try {
      const result = await uploadVideo(
        file,
        undefined,
        (progress: UploadProgress) => {
          if (uploadRequestIdRef.current !== requestId) return;

          const elapsedSeconds = Math.max((Date.now() - uploadStartedAtRef.current) / 1000, 0.001);
          const speed = progress.speed || progress.loaded / elapsedSeconds;
          const timeRemaining = progress.timeRemaining
            || (speed > 0 ? Math.max(progress.total - progress.loaded, 0) / speed : 0);

          setUpload({
            fileName: file.name,
            fileSize: progress.total || file.size,
            progress: progress.percentage,
            loaded: progress.loaded,
            speed,
            timeRemaining
          });
        },
        prepared => {
          if (uploadRequestIdRef.current === requestId) {
            onUploadPrepared(prepared.fileId, file.name);
          }
        }
      );

      if (uploadRequestIdRef.current !== requestId) return;
      const fileId = result.fileId || result._id;
      if (!fileId) throw new Error('Video upload completed without a file ID.');

      setUpload(null);
      onUploadComplete(fileId);
    } catch (error) {
      if (uploadRequestIdRef.current !== requestId) return;
      setUpload(null);
      setPreviewUrl('');
      onPreviewUrlChange?.('');
      onUploadInterrupted('failed');
      toast.error(getUserFriendlyUploadErrorMessage(error, 'Video upload failed. Please try again.'));
    } finally {
      if (uploadRequestIdRef.current === requestId) onUploadStateChange(false);
    }
  }, [
    onPreviewUrlChange,
    onUploadComplete,
    onUploadInterrupted,
    onUploadPrepared,
    onUploadStart,
    onUploadStateChange
  ]);

  useEffect(() => {
    if (!initialUploadFile || initialUploadStartedRef.current) return;
    initialUploadStartedRef.current = true;
    void uploadSelectedFile(initialUploadFile);
  }, [initialUploadFile, uploadSelectedFile]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void uploadSelectedFile(file);
  };

  const cancelUpload = () => {
    uploadRequestIdRef.current += 1;
    setUpload(null);
    setPreviewUrl('');
    onPreviewUrlChange?.('');
    onUploadInterrupted('interrupted');
    onUploadStateChange(false);
  };

  return {
    upload,
    previewUrl,
    fileInputRef,
    handleFileChange,
    cancelUpload
  };
}
