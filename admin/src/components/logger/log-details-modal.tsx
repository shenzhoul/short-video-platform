'use client';

import { Modal, Typography } from 'antd';
import React from 'react';

const { Title } = Typography;

interface LogDetailsModalProps {
  open: boolean;
  logData: any;
  title: string;
  onClose: () => void;
}

/**
 * Shared modal component for displaying detailed log information
 * Used across HTTP Exception, System, and Request log components
 */
export function LogDetailsModal({ open, logData, title, onClose }: LogDetailsModalProps) {
  return (
    <Modal
      open={open}
      onOk={onClose}
      onCancel={onClose}
      footer={null}
      width={900}
      title={<Title level={4}>Log Details - {title}</Title>}
      destroyOnHidden
      centered
    >
      <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
        <pre style={{
          fontSize: '12px',
          lineHeight: '1.4',
          background: 'var(--light-color)',
          padding: '16px',
          borderRadius: '4px',
          border: '1px solid var(--border-color-base)'
        }}
        >
          {JSON.stringify(logData, null, 2)}
        </pre>
      </div>
    </Modal>
  );
}

export default LogDetailsModal;
