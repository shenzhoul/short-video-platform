'use client';

import { AccountForm, UpdatePasswordForm } from "@components/user";
import { Breadcrumb as BreadcrumbComponent, Page } from "@layout/components";
import { appMessage as message } from '@lib/antd-message';
import { authService } from '@services/auth.service';
import { userService } from '@services/user.service';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Tabs } from 'antd';
import { useProfile } from 'src/context/profile.context';

export default function AdminAccountSettingsPage() {
  const queryClient = useQueryClient();
  const { current: user } = useProfile();

  const updateUserMutation = useMutation({
    mutationKey: ['updateUser', user?._id],
    mutationFn: (payload: any) => userService.update(user?._id || '', payload),
    onSuccess: () => {
      message.success('Profile updated successfully');
      queryClient.invalidateQueries({ queryKey: ['user', user?._id] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      window.location.reload();
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to update profile, please try again!');
    }
  });

  const updatePasswordMutation = useMutation({
    mutationKey: ['updatePassword', user?._id],
    mutationFn: async (password: string) => {
      return authService.updatePassword(password, user?._id || '');
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

  const onAvatarUploaded = async ({ response }: any) => {
    await userService.updateAvatar(user?._id || '', response.data._id);
    message.success('Avatar updated successfully');
    queryClient.invalidateQueries({ queryKey: ['user', user?._id] });
    queryClient.invalidateQueries({ queryKey: ['me'] });
    window.location.reload();
  };

  const isSubmitting = updateUserMutation.isPending || updatePasswordMutation.isPending;

  if (!user) {
    return <Page loading><div /></Page>;
  }

  return (
    <>
      <BreadcrumbComponent
        breadcrumbs={[
          { title: 'Home', href: '/' },
          { title: 'Account Settings' }
        ]}
      />
      <Page loading={isSubmitting}>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0, color: 'var(--color-main)' }}>Account Settings</h2>
          <p style={{ margin: '4px 0 0 0', color: 'var(--color-main)' }}>
            Manage your profile information and account settings
          </p>
        </div>
        <Tabs
          defaultActiveKey="basic"
          tabPlacement="top"
          items={[
            {
              key: 'basic',
              label: 'Profile Information',
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
            }
          ]}
        />
      </Page>
    </>
  );
}
