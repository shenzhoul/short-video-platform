'use client';

import { useAuthModal } from '@providers/auth-modal.provider';

interface IProps {
  type: 'notification messages' | 'message';
}

/**
 * What the header panels show a signed-out visitor.
 *
 * "Login now" opens the shared dialog in place. It used to be inert text beside
 * a link to `/auth/login`, which took the visitor off whatever they were
 * watching to see a full-page form.
 */
export default function LoggedInWarning({ type }: IProps) {
  const { openAuthModal } = useAuthModal();

  return (
    <div className="flex items-center justify-center">
      <div className="w-60 pt-6 pb-4 px-4 rounded-2xl flex flex-col">
        <p className="text-center text-(--text) mb-6 text-[14px]">View {type} after logging in</p>
        <button
          type="button"
          onClick={() => openAuthModal()}
          className="w-52 cursor-pointer text-center text-white bg-[#ff2c55] rounded-[10px] text-[14px] leading-9 transition hover:bg-[#ff4772]"
        >
          Login now
        </button>
      </div>
    </div>
  );
}
