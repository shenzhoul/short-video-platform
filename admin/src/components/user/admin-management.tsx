'use client';

import { PlusOutlined } from '@ant-design/icons';
import UserSelector from '@components/user/user-selector';
import { appMessage as message } from '@lib/antd-message';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Col, Modal, Row, Space, Table, Tag, Typography } from 'antd';
import { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useProfile } from 'src/context/profile.context';
import { IUser } from 'src/interfaces';
import { formatDate } from 'src/lib';
import { userService } from 'src/services/user.service';

const { Title, Text } = Typography;

/**
 * Admin Management Component
 *
 * This component allows superadmin users to manage admin permissions.
 * Features:
 * - View all admin users
 * - Toggle admin permissions for users
 * - Protect superadmin account from modification
 * - Only accessible to superadmin users
 */
export function AdminManagement() {
  const { current: profile } = useProfile();
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<IUser | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedUserToPromote, setSelectedUserToPromote] = useState<string>('');
  const [isPromoteModalVisible, setIsPromoteModalVisible] = useState(false);
  const [promoteLoading, setPromoteLoading] = useState(false);

  // Check if current user is superadmin
  const isSuperadmin = profile?.username === 'superadmin';

  // Fetch admin users
  const { data: adminUsers, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => userService.getAdminUsers(),
    enabled: isSuperadmin,
    select: (response) => response.data || []
  });

  // Handle permission toggle
  const handleTogglePermission = async (user: IUser) => {
    if (user.username === 'superadmin') {
      message.error('Cannot modify superadmin account permissions');
      return;
    }

    setLoading(true);
    try {
      const response = await userService.toggleAdminPermission(user._id);
      message.success(response.data.message);

      // Refresh the admin users list
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setIsModalVisible(false);
      setSelectedUser(null);
    } catch (error: any) {
      message.error(error.message || 'Failed to update admin permissions');
    } finally {
      setLoading(false);
    }
  };

  // Handle promoting user to admin
  const handlePromoteUser = async () => {
    if (!selectedUserToPromote) {
      message.error('Please select a user to promote');
      return;
    }

    setPromoteLoading(true);
    try {
      const response = await userService.toggleAdminPermission(selectedUserToPromote);
      message.success(response.data.message);

      // Refresh the admin users list
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setIsPromoteModalVisible(false);
      setSelectedUserToPromote('');
    } catch (error: any) {
      message.error(error.message || 'Failed to promote user to admin');
    } finally {
      setPromoteLoading(false);
    }
  };

  // Show confirmation modal
  const showConfirmModal = (user: IUser) => {
    setSelectedUser(user);
    setIsModalVisible(true);
  };

  // Show promote modal
  const showPromoteModal = () => {
    if (!selectedUserToPromote) {
      message.error('Please select a user first');
      return;
    }
    setIsPromoteModalVisible(true);
  };

  // Table columns
  const columns: ColumnsType<IUser> = [
    {
      title: 'User',
      key: 'user',
      render: (_, record) => (
        <Space orientation="vertical" size="small">
          <Text strong>{record.name || `${record.firstName} ${record.lastName}`}</Text>
          <Text type="secondary">@{record.username}</Text>
          <Text type="secondary">{record.email}</Text>
        </Space>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'active' ? 'green' : 'red'}>
          {status.toUpperCase()}
        </Tag>
      )
    },
    {
      title: 'Admin Type',
      key: 'adminType',
      render: (_, record) => (
        <Tag color={record.username === 'superadmin' ? 'gold' : 'blue'}>
          {record.username === 'superadmin' ? 'SUPERADMIN' : 'ADMIN'}
        </Tag>
      )
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => formatDate(new Date(date))
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => (
        <Space>
          {record.username !== 'superadmin' && (
            <Button
              type="primary"
              danger={record.isAdmin}
              size="small"
              onClick={() => showConfirmModal(record)}
            >
              {record.isAdmin ? 'Remove Admin' : 'Make Admin'}
            </Button>
          )}
          {record.username === 'superadmin' && (
            <Text type="secondary">Protected</Text>
          )}
        </Space>
      )
    }
  ];

  // If not superadmin, show access denied
  if (!isSuperadmin) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '50px 0' }}>
          <Title level={3}>Access Denied</Title>
          <Text>Only superadmin users can access admin management.</Text>
        </div>
      </Card>
    );
  }

  return (
    <div>
      <Row gutter={[16, 16]}>
        {/* Add New Admin Section */}
        <Col span={24}>
          <Card>
            <div style={{ marginBottom: 16 }}>
              <Title level={4}>Add New Admin</Title>
              <Text type="secondary">
                Search and select a user to grant admin permissions.
              </Text>
            </div>

            <Space orientation="vertical" style={{ width: '100%' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ flex: 1, maxWidth: '400px' }}>
                  <UserSelector
                    placeholder="Search for a user to make admin..."
                    onSelect={(userId: string) => setSelectedUserToPromote(userId)}
                    noEmpty
                  />
                </div>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={showPromoteModal}
                  disabled={!selectedUserToPromote}
                >
                  Add as Admin
                </Button>
              </div>
            </Space>
          </Card>
        </Col>

        {/* Current Admins Section */}
        <Col span={24}>
          <Card>
            <div style={{ marginBottom: 16 }}>
              <Title level={4}>Current Admins</Title>
              <Text type="secondary">
                Manage existing admin users. You can remove admin permissions here.
              </Text>
            </div>

            <Table
              columns={columns}
              dataSource={adminUsers}
              loading={isLoading}
              rowKey="_id"
              pagination={{
                pageSize: 10,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) => `Total ${total} admin users`
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* Confirmation Modal */}
      <Modal
        title="Confirm Permission Change"
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false);
          setSelectedUser(null);
        }}
        centered
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setIsModalVisible(false);
              setSelectedUser(null);
            }}
          >
            Cancel
          </Button>,
          <Button
            key="confirm"
            type="primary"
            danger={selectedUser?.isAdmin}
            loading={loading}
            onClick={() => selectedUser && handleTogglePermission(selectedUser)}
          >
            {selectedUser?.isAdmin ? 'Remove Admin Rights' : 'Grant Admin Rights'}
          </Button>
        ]}
      >
        {selectedUser ? (
          <div>
            <p>
              Are you sure you want to{' '}
              <strong>
                {selectedUser.isAdmin ? 'remove admin rights from' : 'grant admin rights to'}
              </strong>{' '}
              the following user?
            </p>
            <Card size="small" style={{ marginTop: 16 }}>
              <Space orientation="vertical" size="small">
                <Text strong>{selectedUser.name || `${selectedUser.firstName} ${selectedUser.lastName}`}</Text>
                <Text type="secondary">@{selectedUser.username}</Text>
                <Text type="secondary">{selectedUser.email}</Text>
              </Space>
            </Card>
          </div>
        ) : null}
      </Modal>

      {/* Promote User Modal */}
      <Modal
        title="Confirm Admin Promotion"
        open={isPromoteModalVisible}
        onCancel={() => {
          setIsPromoteModalVisible(false);
          setSelectedUserToPromote('');
        }}
        centered
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setIsPromoteModalVisible(false);
              setSelectedUserToPromote('');
            }}
          >
            Cancel
          </Button>,
          <Button
            key="confirm"
            type="primary"
            loading={promoteLoading}
            onClick={handlePromoteUser}
          >
            Grant Admin Rights
          </Button>
        ]}
      >
        <div>
          <p>
            Are you sure you want to <strong>grant admin rights</strong> to the selected user?
          </p>
          <p>
            <Text type="secondary">
              This will give the user administrative privileges in the system.
            </Text>
          </p>
        </div>
      </Modal>
    </div>
  );
}
