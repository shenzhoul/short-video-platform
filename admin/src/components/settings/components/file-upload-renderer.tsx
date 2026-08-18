'use client';

import { ImageUpload } from '@components/file/image-upload';
import { appMessage as message } from '@lib/antd-message';
import { settingService } from '@services/setting.service';
import { FormInstance } from 'antd/lib/form';
import React from 'react';
import { ISetting } from 'src/interfaces';

interface FileUploadRendererProps {
  setting: ISetting;
  formRef: React.RefObject<FormInstance | null>;
  onValueChange: (field: string, val: any) => void;
}

export const FileUploadRenderer: React.FC<FileUploadRendererProps> = ({
  setting,
  formRef,
  onValueChange
}) => {
  if (!setting.meta?.upload) return null;

  return (
    <div key={setting._id} style={{ padding: '10px 0' }}>
      <ImageUpload
        image={setting.value}
        onUploaded={async (file: File) => {
          try {
            const result = await settingService.uploadFile(file);
            // Use the file ID as the value since the new workflow returns file ID
            const val = result.url || result.fileInfo?.url;

            // Update form field value using the correct method for nested keys
            formRef.current?.setFieldValue(setting.key, val);
            onValueChange(setting.key, val);
            message.success('Image uploaded successfully');
          } catch {
            message.error('Image upload failed');
          }
        }}
      />
    </div>
  );
};
