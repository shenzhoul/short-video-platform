'use client';

import { CameraOutlined, LoadingOutlined } from '@ant-design/icons';
import { appMessage as message } from '@lib/antd-message';
import { showError } from '@lib/utils';
import { Upload } from 'antd';
import { type CSSProperties, useCallback, useState } from 'react';

interface IProps {
  image?: string;
  onUploaded?: (file: File) => void;
  options?: any;
}

export function ImageUpload({ image = undefined, onUploaded = () => { }, options = {} }: IProps) {
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState('');

  const beforeUpload = useCallback(async (file: File) => {
    // Validate file size
    const isMaxSize = file.size / 1024 / 1024 < 50;
    if (!isMaxSize) {
      showError(`Image must be smaller than 50MB!`);
      return false;
    }

    // Show loading and preview
    setLoading(true);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setImageUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    try {
      // Immediately upload the file using the new workflow
      if (onUploaded) {
        await onUploaded(file);
      }
    } catch {
      message.error('Upload failed');
    } finally {
      setLoading(false);
    }

    // Prevent Antd's default upload behavior
    return false;
  }, [onUploaded]);

  const hasImage = Boolean(imageUrl || image);

  const cameraWrapperStyle: CSSProperties = hasImage
    ? {
      position: 'absolute',
      top: '50%',
      right: -10,
      transform: 'translateY(-50%)',
      backgroundColor: 'var(--white)',
      borderRadius: '50%',
      boxShadow: '0 0 4px rgba(0,0,0,0.25)',
      width: 24,
      height: 24,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
    : {
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    };

  return (
    <Upload
      accept="image/*"
      name={options.fieldName || 'file'}
      listType="picture-card"
      disabled={loading}
      className="avatar-uploader"
      showUploadList={false}
      beforeUpload={beforeUpload}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%'
        }}
      >
        {hasImage ? (
          <img
            src={imageUrl || image}
            alt="file"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : null}

        <div style={cameraWrapperStyle}>
          {loading ? <LoadingOutlined /> : <CameraOutlined />}
        </div>
      </div>
    </Upload>
  );
}
