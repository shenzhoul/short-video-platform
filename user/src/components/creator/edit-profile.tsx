'use client';

import AvatarUpload from '@components/shared/avatar-upload';
import { FormFieldText, FormFieldTextarea } from '@components/ui/form-field';
import Modal from '@components/ui/modal';
import { toast } from '@douyin-clone/shared-toast';
import { zodResolver } from '@hookform/resolvers/zod';
import { IUser } from '@interfaces/user';
import { showErrorMessage } from '@lib/utils';
import { useProfile } from '@providers/profile.provider';
import { updateCurrentCreator } from '@services/creator.service';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import z from 'zod';

const MAX_NAME_LENGTH = 20;

/**
 * Compact label, field spacing, radius and error text shared by both fields.
 *
 * The controls are made `block`: inline, a 16px input sits on its wrapper's
 * inherited 20px line box, 4px below the absolutely placed character counter.
 */
const COMPACT_FIELD_CLASS_NAME = 'max-lg:[&_label]:text-[8px] max-lg:[&_label]:leading-3 max-lg:[&>div]:mt-0.5 max-lg:[&_input]:block max-lg:[&_textarea]:block max-lg:[&_input]:rounded-[4px] max-lg:[&_textarea]:rounded-[4px] max-lg:[&_p]:mt-0.5 max-lg:[&_p]:text-[8px] max-lg:[&_p]:leading-3';

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
      // Compact: the reference draws this dialog 240px wide at a 440px
      // viewport, with 8-10px type — the desktop 480px panel covered the whole
      // content column. The form fields are shared, so they are resized from
      // here through descendant variants rather than inside `form-field.tsx`.
      className="overflow-hidden rounded-2xl max-lg:rounded-lg bg-[#262734] shadow-2xl max-lg:!w-60"
      closeButtonClassName="max-lg:top-0.5 max-lg:right-0.5 max-lg:h-5 max-lg:w-5 max-lg:[&_svg]:h-3 max-lg:[&_svg]:w-3"
    >
      <form data-edit-profile-form className="relative px-10 max-lg:px-5 pb-20 max-lg:pb-8 pt-9 max-lg:pt-4" onSubmit={handleSubmit(onSubmit)}>
        <h2 className="text-[20px] max-lg:text-[10px] leading-7 max-lg:leading-3.5 text-white/90">
          Edit profile
        </h2>

        <div className="mt-4 max-lg:mt-2 flex w-full flex-col items-center">
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
              className="h-[108px] w-[108px] max-lg:h-14 max-lg:w-14 max-lg:[&_span]:bg-size-[14px_14px]"
            />
          </div>
          <div className="mt-2 max-lg:mt-1 text-xs max-lg:text-[8px] leading-5 max-lg:leading-3 text-white/70">Click to change your avatar</div>
        </div>

        <FormFieldText
          name="name"
          label="Name"
          register={register('name')}
          placeholder="Remember to fill in your nickname"
          error={errors.name}
          value={currentName}
          maxLength={MAX_NAME_LENGTH}
          className={`mt-4 max-lg:mt-2 w-full ${COMPACT_FIELD_CLASS_NAME} max-lg:[&_input]:h-4 max-lg:[&_input]:pl-1.5 max-lg:[&_input]:pr-8 max-lg:[&_input]:leading-4 max-lg:[&_input]:text-[8px] max-lg:[&_span]:right-1.5 max-lg:[&_span]:text-[7px] max-lg:[&_span]:leading-4`}
        />

        <FormFieldTextarea
          name="bio"
          label="Introduce"
          register={register('bio')}
          placeholder="Introduce yourself"
          error={errors.bio}
          value={currentBio}
          className={`mt-6 max-lg:mt-3 w-full ${COMPACT_FIELD_CLASS_NAME} max-lg:[&_textarea]:h-16 max-lg:[&_textarea]:px-1.5 max-lg:[&_textarea]:py-1 max-lg:[&_textarea]:text-[8px] max-lg:[&_textarea]:leading-3`}
        />

        <div className="mt-8 max-lg:mt-4 flex justify-center gap-2 max-lg:gap-1">
          <button
            type="button"
            className="h-9 max-lg:h-4.5 w-[148px] max-lg:w-[74px] min-w-[88px] max-lg:min-w-0 cursor-pointer rounded-[10px] max-lg:rounded-[4px] border-0 bg-[#363743] px-4 max-lg:px-0 py-1.5 max-lg:py-0 text-sm max-lg:text-[8px] font-medium leading-[22px] max-lg:leading-none text-white transition hover:bg-[#444551]"
            onClick={onClose}
          >
            Cancelled
          </button>
          <button
            disabled={!canSave}
            type="submit"
            className="h-9 max-lg:h-4.5 w-[148px] max-lg:w-[74px] min-w-[88px] max-lg:min-w-0 rounded-[10px] max-lg:rounded-[4px] border-0 px-4 max-lg:px-0 py-1.5 max-lg:py-0 text-sm max-lg:text-[8px] font-medium leading-[22px] max-lg:leading-none text-white transition disabled:cursor-not-allowed disabled:bg-[#8d2b48] disabled:text-white/42 enabled:cursor-pointer enabled:bg-[#fe2c55] enabled:hover:bg-[#e9274f]"
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
