'use client';

import AvatarUpload from '@components/shared/avatar-upload';
import { FormFieldText, FormFieldTextarea } from '@components/ui/form-field';
import Modal from '@components/ui/modal';
import { zodResolver } from '@hookform/resolvers/zod';
import { IUser } from '@interfaces/user';
import { showErrorMessage } from '@lib/utils';
import { useProfile } from '@providers/profile.provider';
import { updateCurrentCreator } from '@services/creator.service';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import z from 'zod';

const MAX_NAME_LENGTH = 20;

const creatorSchema = z.object({
  name: z.string().min(3, 'Display name must be at least 3 characters').max(MAX_NAME_LENGTH, `Display name must be at most ${MAX_NAME_LENGTH} characters`),
  bio: z.string().optional()
});

type CreatorFormData = z.infer<typeof creatorSchema>;

interface EditProfileModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Function to close the modal */
  onClose: () => void;
  user: Pick<IUser, 'avatar' | 'bio' | 'name' | 'username'>;
  onAvatarUploaded?: (url: string) => void;
  onProfileUpdated?: (profile: Pick<CreatorFormData, 'name' | 'bio'>) => void;
}

const normalizeText = (value?: string | null) => (value || '').trim();

export default function EditProfileModal({
  open, onClose, user, onAvatarUploaded, onProfileUpdated
}: EditProfileModalProps) {
  const { loadProfile } = useProfile();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch
  } = useForm<CreatorFormData>({
    resolver: zodResolver(creatorSchema),
    defaultValues: {
      name: user.name || '',
      bio: user.bio || ''
    }
  });

  const initialName = useMemo(
    () => normalizeText(user?.name || user?.username),
    [user?.name, user?.username]
  );
  const initialBio = useMemo(
    () => normalizeText(user?.bio),
    [user?.bio]
  );

  const [avatarChanged, setAvatarChanged] = useState(false);

  useEffect(() => {
    if (!open) return;
    reset({
      name: initialName,
      bio: initialBio
    });
    setAvatarChanged(false);
  }, [initialBio, initialName, open, reset]);

  const currentName = watch('name') || '';
  const currentBio = watch('bio') || '';
  const normalizedName = normalizeText(currentName);
  const normalizedBio = normalizeText(currentBio);
  const hasTextChanges = normalizedName !== initialName || normalizedBio !== initialBio;
  const canSave = !!normalizedName && (hasTextChanges || avatarChanged);

  const mutation = useMutation({
    mutationFn: (data: CreatorFormData) => updateCurrentCreator(data),
    onSuccess: (response, variables) => {
      const updatedProfile = response?.data || {};
      toast.success('Profile updated successfully');
      onProfileUpdated?.({
        name: updatedProfile.name || variables.name,
        bio: updatedProfile.bio ?? variables.bio ?? ''
      });
      loadProfile();
    },
    onError: (error: any) => {
      showErrorMessage(error, 'Failed to update profile');
    }
  });

  const onSubmit = (values: CreatorFormData) => {
    toast.success('Saving...');
    mutation.mutate(values);
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={false}
      noPadding
      width={480}
      className="overflow-hidden rounded-2xl bg-[#262734] shadow-2xl"
    >
      <form className="relative px-10 pb-20 pt-9" onSubmit={handleSubmit(onSubmit)}>
        <h2 className="text-[20px] leading-7 text-white/90">
          Edit profile
        </h2>

        <div className="mt-4 flex w-full flex-col items-center">
          <div className="relative">
            <AvatarUpload
              previewUrl={user?.avatar}
              onUploaded={(data) => {
                setAvatarChanged(true);
                if (data.fileInfo?.url) {
                  onAvatarUploaded?.(data.fileInfo.url);
                }
              }}
              size="md"
              className="h-[108px] w-[108px]"
            />
          </div>
          <div className="mt-2 text-xs leading-5 text-white/70">Click to change your avatar</div>
        </div>

        <FormFieldText
          name="name"
          label="Name"
          register={register('name')}
          placeholder="Remember to fill in your nickname"
          error={errors.name}
          value={currentName}
          maxLength={MAX_NAME_LENGTH}
          className="mt-4 w-full"
        />

        <FormFieldTextarea
          name="bio"
          label="Introduce"
          register={register('bio')}
          placeholder="Introduce yourself"
          error={errors.bio}
          value={currentBio}
          className="mt-6 w-full"
        />

        <div className="mt-8 flex justify-center gap-2">
          <button
            type="button"
            className="h-9 w-[148px] min-w-[88px] cursor-pointer rounded-[10px] border-0 bg-[#363743] px-4 py-1.5 text-sm font-medium leading-[22px] text-white transition hover:bg-[#444551]"
            onClick={onClose}
          >
            Cancelled
          </button>
          <button
            disabled={!canSave}
            type="submit"
            className="h-9 w-[148px] min-w-[88px] rounded-[10px] border-0 px-4 py-1.5 text-sm font-medium leading-[22px] text-white transition disabled:cursor-not-allowed disabled:bg-[#8d2b48] disabled:text-white/42 enabled:cursor-pointer enabled:bg-[#fe2c55] enabled:hover:bg-[#e9274f]"
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
