'use client';

import { FileThumb } from '@components/shared/file-thumb';
import Button from '@components/ui/button';
import { CloseIcon } from '@components/ui/close-icon';
import Modal from '@components/ui/modal';
import { FILE_VALIDATION_PRESETS, validateFileSize } from '@utils/file-validation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FiImage, FiVideo } from 'react-icons/fi';
import { toast } from 'react-toastify';

type UploadMode = 'photo' | 'video';

const MODE_CONFIG: Record<UploadMode, { label: string; accept: string; icon: typeof FiImage }> = {
  photo: {
    label: 'Photos',
    accept: 'image/*,.heic,.heif,.avif,.tiff,.tif',
    icon: FiImage
  },
  video: {
    label: 'Videos',
    accept: 'video/*,.hevc,.mov',
    icon: FiVideo
  }
};

const MODE_VALIDATION_PRESET: Record<UploadMode, keyof typeof FILE_VALIDATION_PRESETS> = {
  photo: 'IMAGE',
  video: 'VIDEO'
};

export interface UploadMediaModalProps {
  open: boolean;
  onOk: (selectedFiles: File[], remainingExistingFiles: any[]) => void;
  onCancel: () => void;
  mode: UploadMode;
  existingFiles: any[];
  selectedFiles: File[];
  maxFiles?: number;
  onPreview: (file: any) => void;
}

export function UploadMediaModal({
  open,
  onOk,
  onCancel,
  mode,
  existingFiles,
  selectedFiles,
  maxFiles = 12,
  onPreview
}: UploadMediaModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [localExistingFiles, setLocalExistingFiles] = useState<any[]>(existingFiles);
  const [localSelectedFiles, setLocalSelectedFiles] = useState<File[]>(selectedFiles);

  useEffect(() => {
    if (open) {
      setLocalExistingFiles(existingFiles);
      setLocalSelectedFiles(selectedFiles);
    }
  }, [open, existingFiles, selectedFiles]);

  const config = MODE_CONFIG[mode];
  const Icon = config.icon;
  const validationPreset = FILE_VALIDATION_PRESETS[MODE_VALIDATION_PRESET[mode]];

  const handleAddFiles = useCallback(
    (newFiles: File[]) => {
      const validFiles = newFiles.filter(file => {
        const result = validateFileSize(file, validationPreset.maxSizeMB);
        if (!result.isValid && result.error) {
          toast.error(result.error);
          return false;
        }
        return true;
      });

      if (!validFiles.length) return;

      if (localSelectedFiles.length + validFiles.length + localExistingFiles.length > maxFiles) {
        toast.error(`Maximum ${maxFiles} files allowed. Please remove some files before adding new ones.`);
      }
      const validLimit = maxFiles - localExistingFiles.length;
      setLocalSelectedFiles(prev => [...prev, ...validFiles].slice(0, validLimit));
    },
    [localSelectedFiles, localExistingFiles, maxFiles, validationPreset.maxSizeMB]
  );

  const handleRemoveSelected = useCallback((index: number) => {
    setLocalSelectedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleRemoveExisting = useCallback((fileId: string) => {
    setLocalExistingFiles(prev => prev.filter(f => f._id !== fileId));
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;
      const newFiles = Array.from(files);
      handleAddFiles(newFiles);
      e.target.value = '';
    },
    [handleAddFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (!files.length) return;
      handleAddFiles(files);
    },
    [handleAddFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const hasChanges =
    localSelectedFiles.length !== selectedFiles.length ||
    localExistingFiles.length !== existingFiles.length;

  const handleCancel = useCallback(() => {
    if (hasChanges) {
      if (window.confirm('Are you sure you want to discard your changes?')) {
        onCancel();
      } else {
        return false;
      }
    } else {
      onCancel();
    }
  }, [hasChanges, onCancel]);

  const handleDiscard = useCallback(() => {
    if (window.confirm('Are you sure you want to revert your unconfirmed changes?')) {
      setLocalExistingFiles(existingFiles);
      setLocalSelectedFiles(selectedFiles);
    }
  }, [existingFiles, selectedFiles]);

  const handleOk = () => {
    onOk(localSelectedFiles, localExistingFiles);
  };

  const allFilesCount = localExistingFiles.length + localSelectedFiles.length;

  return (
    <Modal
      title={(
        <div className="flex justify-between items-center w-full">
          <span>Add {config.label}</span>
          <button
            type="button"
            className="absolute top-2 right-2 cursor-pointer hover:opacity-70 focus:outline-hidden bg-surface w-[30px] h-[30px] rounded-full z-10 flex justify-center items-center text-gray-500"
            onClick={handleCancel}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>
      )}
      open={open}
      onCancel={handleCancel}
      closable={false}
      footer={false}
      width={520}
      maskClosable={false}
    >
      <div className="space-y-4">
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`
              relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
              ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-surface-muted/30'}
            `}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={config.accept}
            className="hidden"
            onChange={handleFileSelect}
          />
          <div className="flex flex-col items-center gap-2 text-gray-600">
            <span className="rounded-full bg-surface-muted p-3">
              <Icon size={28} className="text-gray-500" />
            </span>
            <p className="text-sm font-medium">
              {isDragging ? 'Drop files here' : 'Drag and drop or click to browse'}
            </p>
            <p className="text-xs text-gray-400">
              {config.label} (Max {validationPreset.maxSizeMB}MB)
            </p>
          </div>
        </div>

        {allFilesCount > 0 ? (
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              Selected ({allFilesCount})
            </p>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2">
              {localExistingFiles.map((file, index) => (
                <FileThumb
                  key={file._id ?? `existing-${index}`}
                  file={file}
                  size={72}
                  showRemove
                  onClick={() => onPreview(file)}
                  onRemove={() => handleRemoveExisting(file._id)}
                />
              ))}
              {localSelectedFiles.map((file, index) => (
                <FileThumb
                  key={`${file.name}-${file.size}-${index}`}
                  file={file}
                  size={72}
                  showRemove
                  onClick={() => onPreview(file)}
                  onRemove={() => handleRemoveSelected(index)}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          {hasChanges ? (
            <Button variant="danger" onClick={handleDiscard}>
              Discard
            </Button>
          ) : null}
          <Button variant="grey-light" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleOk} disabled={!localSelectedFiles.length && !localExistingFiles.length}>
            Add to post
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default UploadMediaModal;
