'use client';

import { AccountForm } from '@components/user/account-form';
import BalanceManagementModal from '@components/user/balance-management-modal';
import { UpdatePasswordForm } from '@components/user/update-password-form';
import { Breadcrumb as BreadcrumbComponent, Page } from "@layout/components";
import { appMessage as message } from '@lib/antd-message';
import { authService } from '@services/auth.service';
import { userService } from '@services/user.service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Space, Tabs, Typography } from 'antd';
import { useState } from 'react';

const { Text } = Typography;

interface IProps {
  userId: string;
}

export default function UserUpdateForm({ userId }: IProps) {
  const queryClient = useQueryClient();

  // Fetch user data
  const { data: user, isLoading: isLoadingUser } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => userService.findById(userId),
    select: (res) => res.data
  });

  const [balanceModalVisible, setBalanceModalVisible] = useState(false);

  // Mutation for updating user
  const updateUserMutation = useMutation({
    mutationKey: ['updateUser', userId],
    mutationFn: (payload: any) => userService.update(userId, payload),
    onSuccess: () => {
      message.success('User updated successfully');
      // Invalidate and refetch user data
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to update user, please try again!');
    }
  });

  // Mutation for updating password
  const updatePasswordMutation = useMutation({
    mutationKey: ['updatePassword', userId],
    mutationFn: async (password: string) => {
      // Password is already hashed by UpdatePasswordForm component
      // Don't hash it again to avoid double-hashing issue
      return authService.updatePassword(password, userId);
    },
    onSuccess: () => {
      message.success('Password updated successfully');
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to update password, please try again!');
    }
  });

  const handleBasicSubmit = (data: any) => {
    updateUserMutation.mutate(data);
  };

  const handlePasswordSubmit = (vals: { password: string }) => {
    updatePasswordMutation.mutate(vals.password);
  };

  const onAvatarUploaded = async ({ response }) => {
    await userService.updateAvatar(userId, response.data._id);

    message.success('Avatar updated successfully');
    queryClient.invalidateQueries({ queryKey: ['user', userId] });
  };

  const isSubmitting = updateUserMutation.isPending || updatePasswordMutation.isPending;

  // Handle balance management modal
  const handleBalanceModalOpen = () => {
    setBalanceModalVisible(true);
  };

  const handleBalanceModalClose = () => {
    setBalanceModalVisible(false);
  };

  const handleBalanceAdjustmentSuccess = (_result: any) => {
    // Refresh user data to show updated balance
    queryClient.invalidateQueries({ queryKey: ['user', userId] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
    // message.success(`Balance updated successfully. New balance: $${result.newBalance?.toFixed(2)}`);
  };

  if (!user) {
    return <Page loading><div /></Page>;
  }

  return (
    <>
      <BreadcrumbComponent
        breadcrumbs={[
          { title: 'Home', href: '/' },
          { title: 'Users', href: '/identity/users' },
          { title: 'Update User' }
        ]}
      />
      <Page loading={isLoadingUser || isSubmitting}>
        <Tabs
          defaultActiveKey="basic"
          tabPlacement="top"
          items={[
            {
              key: 'basic',
              label: 'Basic Information',
              children: (
                <AccountForm
                  onFinish={handleBasicSubmit}
                  user={user}
                  updating={updateUserMutation.isPending}
                  options={{
                    onAvatarUploaded
                  }}
                />
              )
            },
            {
              key: 'password',
              label: 'Change Password',
              children: (
                <UpdatePasswordForm
                  onFinish={handlePasswordSubmit}
                  updating={updatePasswordMutation.isPending}
                />
              )
            },
            {
              key: 'balance',
              label: 'Balance Management',
              children: (
                <div style={{ padding: '20px 0' }}>
                  <Space orientation="vertical" size="large" style={{ width: '100%' }}>
                    {/* Current Balance Display */}
                    <div>
                      <Text strong style={{ fontSize: '16px' }}>Current Balance:</Text>
                      <Text
                        style={{
                          fontSize: '24px',
                          color: '#1890ff',
                          fontWeight: 'bold',
                          marginLeft: '12px'
                        }}
                      >
                        ${(parseFloat(user.balance) || 0).toFixed(2)}
                      </Text>
                    </div>

                    {/* Balance Management Actions */}
                    <div>
                      <Text type="secondary" style={{ display: 'block', marginBottom: '12px' }}>
                        Use the button below to adjust the user&apos;s balance (add or deduct tokens). This will create a system transaction record for audit purposes.
                      </Text>
                      <Button
                        type="primary"
                        size="large"
                        onClick={handleBalanceModalOpen}
                      >
                        Adjust Balance
                      </Button>
                    </div>

                    {/* Important Notes */}
                    <div style={{
                      background: '#f6f8fa',
                      padding: '16px',
                      borderRadius: '6px',
                      border: '1px solid #e1e4e8'
                    }}
                    >
                      <Text strong style={{ color: '#24292e' }}>Important Notes:</Text>
                      <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                        <li>Balance adjustments create permanent transaction records</li>
                        <li>Positive amounts add balance, negative amounts deduct balance</li>
                        <li>All adjustments require admin notes for audit compliance</li>
                      </ul>
                    </div>
                  </Space>
                </div>
              )
            }
          ]}
        />

        {/* Balance Management Modal */}
        <BalanceManagementModal
          user={user}
          visible={balanceModalVisible}
          onCancel={handleBalanceModalClose}
          onSuccess={handleBalanceAdjustmentSuccess}
        />
      </Page>
    </>
  );
}
