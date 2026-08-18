'use client';

import { DeleteOutlined, EditOutlined, UserOutlined } from '@ant-design/icons';
import MenuAction from '@components/common/list-action';
import { appMessage as message } from '@lib/antd-message';
import { userService } from '@services/user.service';
import { Checkbox, Modal, Typography } from 'antd';
import React, { useState } from 'react';

const { Text } = Typography;

interface UserActionsProps {
  userId: string;
  userName: string;
  userStatus?: string;
  isDeleting?: boolean;
}

export const UserActions: React.FC<UserActionsProps> = ({
  userId,
  userName,
  userStatus = 'active',
  isDeleting: _isDeletingProp = false
}) => {
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = () => {
    setIsModalVisible(true);
    setIsConfirmed(false); // Reset confirmation state
  };

  const handleOk = async () => {
    if (!isConfirmed) {
      message.error('Please confirm that you understand this action is permanent');
      return;
    }

    try {
      setIsDeleting(true);
      await userService.delete(userId);
      message.success('User account has been deleted successfully');
      setIsModalVisible(false);
      // Refresh the page to update the list
      window.location.reload();
    } catch (error) {
      message.error('Failed to delete user account');
      console.error('Delete user error:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    setIsModalVisible(false);
    setIsConfirmed(false);
  };

  const menuOptions: any[] = [
    {
      key: 'edit',
      label: 'Edit Profile',
      href: `/identity/users/update/${userId}`,
      icon: <EditOutlined />
    }
  ];

  // Add status management option if user has payment-related issues
  if (userStatus && ['payment-restricted', 'payment-suspended', 'under-review'].includes(userStatus)) {
    menuOptions.push({
      key: 'manage-status',
      label: 'Manage Payment Status',
      href: `/finance/disputes?userId=${userId}`,
      icon: <UserOutlined />
    });
  }

  // Add delete option if user is not already deleted
  if (userStatus !== 'deleted') {
    menuOptions.push({
      key: 'delete',
      label: 'Delete Account',
      onClick: handleDelete,
      icon: <DeleteOutlined />,
      danger: true
    });
  }

  return (
    <>
      <MenuAction
        menuOptions={menuOptions}
      />

      <Modal
        title={(
          <div style={{ color: 'var(--danger-accent-color)' }}>
            🗑️ Delete User Account - PERMANENT ACTION
          </div>
        )}
        open={isModalVisible}
        onOk={handleOk}
        onCancel={handleCancel}
        width={600}
        okText="Delete Account Permanently"
        okType="danger"
        cancelText="Cancel"
        okButtonProps={{
          disabled: !isConfirmed,
          loading: isDeleting
        }}
        cancelButtonProps={{
          disabled: isDeleting
        }}
        centered
      >
        <div>
          <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'var(--danger-surface)', border: '1px solid var(--danger-border-color)', borderRadius: '6px' }}>
            <Text type="danger" strong>⚠️ CRITICAL WARNING</Text>
            <br />
            <Text type="danger">This action will permanently delete the user account and cannot be undone.</Text>
          </div>

          <p>You are about to delete the user account for <strong>{userName}</strong>.</p>

          <div style={{ marginBottom: '16px' }}>
            <Text strong>This action will:</Text>
            <ul style={{ marginTop: '8px', paddingLeft: '18px' }}>
              <li>🔒 <strong>Anonymize</strong> all personal information (username, email, name, phone)</li>
              <li>🚫 <strong>Block</strong> the user from logging in permanently</li>
              <li>📊 <strong>Preserve</strong> purchase history and content access for existing purchases</li>
              <li>💰 <strong>Maintain</strong> financial records for compliance</li>
              <li>🗃️ <strong>Keep</strong> user ID for referential integrity</li>
            </ul>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <Text strong type="warning">Data Changes:</Text>
            <ul style={{ marginTop: '8px', paddingLeft: '18px' }}>
              <li>Username → <code>deleted-account-{userId}</code></li>
              <li>Email → <code>deleted-email-{userId}@deleted.local</code></li>
              <li>Status → <code>DELETED</code></li>
            </ul>
          </div>

          <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'var(--warning-surface)', border: '1px solid var(--warning-border-color)', borderRadius: '6px' }}>
            <Text type="warning" strong>⚠️ GDPR Compliance Notice</Text>
            <br />
            <Text>This deletion method complies with data protection regulations by anonymizing personal data while preserving business-critical information.</Text>
          </div>

          <Checkbox
            checked={isConfirmed}
            onChange={(e) => setIsConfirmed(e.target.checked)}
            style={{ marginTop: '16px' }}
          >
            <Text strong>I understand this action is permanent and cannot be undone</Text>
          </Checkbox>
        </div>
      </Modal>
    </>
  );
};

export default UserActions;
