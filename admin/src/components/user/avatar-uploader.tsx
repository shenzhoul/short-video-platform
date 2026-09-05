'use client';

import './index.module.css';

/* eslint-disable react/require-default-props */
import { CameraOutlined, LoadingOutlined } from '@ant-design/icons';
import { hasCustomAvatar, resolveAvatarUrl } from '@lib/avatar';
import { message, Upload } from 'antd';
import ImgCrop from 'antd-img-crop';
import { useEffect, useState } from 'react';

function getBase64(img: any, callback: (result: string) => void) {
  const reader = new FileReader();
  reader.addEventListener('load', () => callback(reader.result as string));
  reader.readAsDataURL(img);
}

interface IProps {
  imageUrl?: string;
  uploadUrl?: string;
  headers?: any;
  onUploaded?: ((data: any) => void) | ((file: File) => void) | Function;
  onFileRead?: ((file: any) => void) | Function;
  options?: any;
  accept?: string;
}

export function AvatarUploader({
  imageUrl = '',
  uploadUrl = '',
  headers = {},
  onUploaded,
  onFileRead,
  options = {},
  accept = 'image/*'
}: IProps) {
  const [loading, setLoading] = useState(false);
  const [currentImageUrl, setCurrentImageUrl] = useState(imageUrl);

  useEffect(() => {
    setCurrentImageUrl(imageUrl);
  }, [imageUrl]);

  const beforeUpload = (file: any) => {
    const isJpgOrPng = file.type === 'image/jpeg' || file.type === 'image/png';
    if (!isJpgOrPng) {
      message.error('You can only upload JPG/PNG file!');
      return false;
    }
    const isLt2M = file.size / 1024 / 1024 < 50;
    if (!isLt2M) {
      message.error('Image must smaller than 2MB!');
      return false;
    }

    if (options.beforeUpload) {
      return options.beforeUpload(file);
    }

    return true;
  };

  const handleChange = (info: any) => {
    if (info.file.status === 'uploading') {
      setLoading(true);
      return;
    }
    if (info.file.status === 'done') {
      setLoading(false);
      const { response } = info.file;
      setCurrentImageUrl(response.data ? response.data.url : response.url);
      onUploaded && onUploaded(response.data || response);
    }
    if (info.file.status === 'error') {
      setLoading(false);
      message.error('Upload failed, please try again!');
    }
  };

  const handleFileRead = (file: any) => {
    getBase64(file, (url: string) => {
      setCurrentImageUrl(url);
      onFileRead && onFileRead(file);
    });
  };

  const uploadButton = (
    <div className="ant-upload-text">
      {loading ? <LoadingOutlined /> : <CameraOutlined />}
      <div style={{ marginTop: 8 }}>Upload</div>
    </div>
  );

  const uploadProps = {
    name: 'file',
    listType: 'picture-card' as const,
    className: 'avatar-uploader',
    showUploadList: false,
    action: uploadUrl,
    headers,
    beforeUpload,
    onChange: handleChange,
    accept,
    disabled: loading
  };

  // If no upload URL, handle file reading only or use new upload workflow
  if (!uploadUrl) {
    uploadProps.beforeUpload = (file: any) => {
      const isValid = beforeUpload(file);
      if (isValid) {
        setLoading(true);
        if (onFileRead) {
          handleFileRead(file);
        } else if (onUploaded) {
          // New workflow: pass file directly to onUploaded
          onUploaded(file);
          handleFileRead(file);
        } else {
          handleFileRead(file);
        }
        // Reset loading after a short delay to allow UI updates
        setTimeout(() => setLoading(false), 500);
      }
      return false; // Prevent upload
    };
    delete (uploadProps as any).action;
    delete (uploadProps as any).onChange;
  }

  /*
    The tile always draws an image: a user who has never set an avatar shows
    the shared placeholder, the same one the admin user list and the whole user
    app show, instead of an empty square that looked like a loading failure.

    The camera/"Upload" cue is kept as an overlay rather than replaced by the
    placeholder. Drawing the placeholder *instead of* the button would have
    removed the only affordance telling an admin the tile is clickable — the
    picture would look final when in fact nothing has been uploaded yet.
  */
  const showUploadHint = loading || !hasCustomAvatar(currentImageUrl);

  return (
    <ImgCrop>
      <Upload {...uploadProps}>
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <img
            src={resolveAvatarUrl(currentImageUrl)}
            alt="avatar"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {showUploadHint ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0, 0, 0, 0.45)',
                color: '#fff'
              }}
            >
              {uploadButton}
            </div>
          ) : null}
        </div>
      </Upload>
    </ImgCrop>
  );
}

export default AvatarUploader;
