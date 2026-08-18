/**
 * FileThumb Component
 *
 * A thumbnail component for displaying files with support for images, videos, and generic files.
 * Features progress indicators, remove buttons, and click handlers.
 *
 * @example
 * // Basic usage with uploaded file
 * <FileThumb
 *   file={uploadedFile}
 *   onClick={() => openPreview(file)}
 * />
 *
 * // With progress and remove button
 * <FileThumb
 *   file={file}
 *   showProgress
 *   progress={75}
 *   status="uploading"
 *   showRemove
 *   onRemove={() => removeFile(file.id)}
 * />
 *
 * Features:
 * - Support for images, videos, and generic files
 * - Thumbnail generation for images
 * - Progress indicators for uploads
 * - Remove button with confirmation
 * - Click handlers for preview/selection
 * - Customizable size and styling
 * - Status indicators (uploading, completed, failed)
 */

'use client';

import { useEffect, useState } from 'react';
import { FiFile, FiVideo, FiX } from 'react-icons/fi';

type ThumbnailValue = string | {
  url?: string;
  path?: string;
};

type FileThumbProps = {
  file: {
    _id?: string;
    url?: string;
    previewUrl?: string;
    thumbnailUrl?: string;
    thumbUrl?: string;
    thumbnails?: ThumbnailValue[];
    blurImage?: string;
    mimeType?: string;
    name?: string;
    percentage?: number;
    preview?: string;
    uid?: string;
    status?: string;
    processingStatus?: string;
  } | File;
  size?: number;
  showProgress?: boolean;
  progress?: number;
  status?: 'uploading' | 'completed' | 'failed';
  showRemove?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  className?: string;
};

function isNativeFile(f: unknown): f is File {
  return typeof File !== 'undefined' && f instanceof File;
}

function getThumbnailUrl(thumbnail?: ThumbnailValue): string {
  if (!thumbnail) return '';
  return typeof thumbnail === 'string' ? thumbnail : thumbnail.url || thumbnail.path || '';
}

function getFilePreviewUrl(f: any, includeOriginalUrl = false): string {
  return f.previewUrl
    || f.thumbnailUrl
    || getThumbnailUrl(f.thumbnails?.[0])
    || f.thumbUrl
    || f.preview
    || f.blurImage
    || (includeOriginalUrl ? f.url : '')
    || '';
}

export function FileThumb({ file, size = 96, showProgress, progress, status, showRemove, onClick, onRemove, className = '' }: FileThumbProps) {
  const [src, setSrc] = useState<string>('');
  const [fileType, setFileType] = useState<'image' | 'video' | 'file'>('file');
  const [imageFailed, setImageFailed] = useState(false);

  const fileStatus = !isNativeFile(file) ? (file as any)?.status : undefined;
  const processingStatus = !isNativeFile(file) ? (file as any)?.processingStatus : undefined;
  const hasProcessingStatus = ['pending', 'processing'].includes(fileStatus || '')
    || ['pending', 'processing'].includes(processingStatus || '');
  const isBusy = status === 'uploading' || hasProcessingStatus;
  const statusLabel = hasProcessingStatus ? 'Processing' : 'Uploading';

  useEffect(() => {
    if (!file) return;
    setImageFailed(false);

    // Browser File
    if (isNativeFile(file)) {
      const type = file.type || '';
      if (type.startsWith('image/')) {
        setFileType('image');
        const url = URL.createObjectURL(file);
        setSrc(url);
        return () => URL.revokeObjectURL(url);
      }
      if (type.startsWith('video/')) {
        setFileType('video');
        setSrc(''); // Will show video icon
        return;
      }
      setFileType('file');
      setSrc(''); // Will show file icon
      return;
    }

    // API File or file with preview
    const f: any = file || {};

    const mime = f.mimeType || '';
    const previewUrl = getFilePreviewUrl(f, mime.startsWith('image/'));

    if (mime.startsWith('image/') && previewUrl) {
      setFileType('image');
      setSrc(previewUrl);
      return;
    }

    if (mime.startsWith('video/')) {
      setFileType('video');
      setSrc(previewUrl);
      return;
    }
    setFileType('file');
    setSrc(f.url || '');
  }, [file]);

  const getFileIcon = () => {
    switch (fileType) {
      case 'video':
        return <FiVideo className="opacity-60" size={24} />;
      case 'file':
        return <FiFile className="opacity-60" size={24} />;
      default:
        return <FiFile className="opacity-60" size={24} />;
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClick) {
      onClick();
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRemove) {
      onRemove();
    }
  };

  return (
    <div className={`relative inline-block ${className}`} style={{ width: size, height: size }}>
      <div
        className={`w-full h-full ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
        onClick={handleClick}
      >
        {/* Thumbnail */}
        {fileType === 'image' && src && !imageFailed ? (
          <img
            src={src}
            alt={(file as any)?.name || 'file'}
            className="w-full h-full object-cover rounded"
            onError={() => setImageFailed(true)}
          />
        ) : fileType === 'video' && src && !imageFailed ? (
          <div className="relative w-full h-full">
            <img
              src={src}
              alt={(file as any)?.name || 'video'}
              className="w-full h-full object-cover rounded"
              onError={() => setImageFailed(true)}
            />
            {/* Video play icon overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-black bg-opacity-50 rounded-full p-2">
                <FiVideo className="text-white" size={20} />
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full h-full bg-surface-muted rounded flex items-center justify-center">
            {getFileIcon()}
          </div>
        )}

        {isBusy ? (
          <div className="absolute inset-0 rounded bg-black/45 text-white flex flex-col items-center justify-center gap-1">
            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            <span className="text-[10px] leading-none font-medium">{statusLabel}</span>
          </div>
        ) : null}

        {/* File name overlay for non-images */}
        {fileType !== 'image' && !isBusy && (
          <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-60 text-white text-xs p-1 rounded-b truncate">
            {(file as any)?.name || 'File'}
          </div>
        )}

        {/* Progress bar (for uploads) */}
        {showProgress && (progress != null || (file as any)?.percentage != null) ? (
          <div className="absolute left-0 right-0 bottom-0 h-2 bg-surface-muted rounded-b">
            <div
              className={`h-2 rounded-b transition-all duration-300 ${status === 'failed' ? 'bg-red-500' :
                status === 'completed' ? 'bg-green-500' :
                  'bg-indigo-500'
                }`}
              style={{ width: `${Math.round(progress ?? (file as any)?.percentage ?? 0)}%` }}
            />
          </div>
        ) : null}

        {/* Status indicator */}
        {status ? (
          <div className={`absolute top-1 left-1 w-3 h-3 rounded-full ${status === 'uploading' ? 'bg-primary-500 animate-pulse' :
            status === 'completed' ? 'bg-green-500' :
              status === 'failed' ? 'bg-red-500' : ''
            }`}
          />
        ) : null}
      </div>

      {/* Remove button */}
      {showRemove && onRemove ? (
        <button
          type="button"
          onClick={handleRemove}
          className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
        >
          <FiX size={14} />
        </button>
      ) : null}
    </div>
  );
}

export default FileThumb;
