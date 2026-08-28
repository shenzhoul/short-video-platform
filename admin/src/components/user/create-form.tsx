'use client';

import { AccountForm } from '@components/user/account-form';
import { Breadcrumb as BreadcrumbComponent, Page } from "@layout/components";
import { appMessage as message } from '@lib/antd-message';
import { userService } from '@services/user.service';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function UserCreateForm() {
  const router = useRouter();
  const [avatar, setAvatar] = useState<File | null>(null);

  // Mutation for creating user
  const createMutation = useMutation({
    mutationKey: ['createUser'],
    mutationFn: (payload: any) => userService.create(payload),
    onSuccess: async (response) => {
      const userData = response.data;

      // An account created with "Verified Email" left off is sent a
      // confirmation link and cannot log in until the recipient follows it.
      // `verificationEmailQueued: false` means the account exists but the email
      // did not reach the queue — a different outcome from "creation failed",
      // and one an administrator has to be told about, because the person they
      // just created an account for is otherwise locked out with no explanation.
      const awaitingConfirmation = userData?.verifiedEmail !== true;
      const verificationQueued = userData?.verificationEmailQueued !== false;

      if (avatar) {
        // Upload avatar after user creation
        try {
          const result = await userService.uploadAvatarUser(avatar);
          await userService.updateAvatar(userData._id, result.data._id);
          message.success('User created successfully with avatar');
        } catch {
          message.warning('User created but avatar upload failed');
        }
      } else {
        message.success('User created successfully');
      }

      if (awaitingConfirmation && !verificationQueued) {
        message.warning(
          'The confirmation email could not be sent. The account exists but cannot log in until '
          + 'its address is confirmed — the user can request a new link from the login screen.'
        );
      } else if (awaitingConfirmation) {
        message.info('A confirmation email has been sent. This account cannot log in until the address is confirmed.');
      }

      router.push('/identity/users');
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to create user, please try again!');
    }
  });

  const onBeforeUpload = (file: File) => {
    setAvatar(file);
    return false; // Prevent automatic upload
  };

  const handleSubmit = (data: any) => {
    createMutation.mutate(data);
  };

  const isSubmitting = createMutation.isPending;

  return (
    <Page loading={isSubmitting}>
      <BreadcrumbComponent
        breadcrumbs={[
          { title: 'Home', href: '/' },
          { title: 'Users', href: '/identity/users' },
          { title: 'Create New User' }
        ]}
      />
      <AccountForm
        onFinish={handleSubmit}
        options={{ beforeUpload: onBeforeUpload }}
        updating={isSubmitting}
      />
    </Page>
  );
}
