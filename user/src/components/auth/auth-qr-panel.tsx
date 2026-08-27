'use client';

import { useMainThemeLayout } from '@providers/main-layout.provider';

/**
 * The QR half of the login dialog.
 *
 * Deliberately inert. There is no QR login backend yet, so this renders a fixed
 * decorative asset and says so — it opens no socket, polls nothing, and can
 * never put the app into a signed-in state. A placeholder that *looked* live
 * would be worse than no placeholder: someone would stand there scanning it.
 *
 * When real QR login arrives, the image and the "coming soon" note are what
 * change; the surrounding layout is already where it needs to be.
 */
export default function AuthQrPanel() {
  const { publicSettings } = useMainThemeLayout();
  const siteName = publicSettings?.siteName || 'Douyin';
  const logoUrl = publicSettings?.logoUrl || '';

  return (
    <section aria-labelledby="auth-qr-heading" className="flex flex-col items-center text-center">
      <h3 id="auth-qr-heading" className="text-[15px] font-medium text-(--text-strong)">
        Scan to log in
      </h3>

      <div className="relative mt-5 rounded-2xl border border-(--border) bg-white p-3">
        <img
          src="/login-qr-placeholder.svg"
          alt=""
          aria-hidden="true"
          width={160}
          height={160}
          className="block h-40 w-40 select-none"
          draggable={false}
        />

        {/* Sits in the reserved blank square at the centre of the pattern. */}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border border-(--border) bg-white">
            {logoUrl ? (
              <img src={logoUrl} alt="" aria-hidden="true" className="h-full w-full object-contain p-1" />
            ) : (
              <span className="text-[13px] font-bold text-[#161823]">
                {siteName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </span>
        </span>
      </div>

      <p className="mt-4 max-w-56 text-[13px] leading-5 text-(--text-muted)">
        Open the {siteName} app and scan this code to sign in without a password.
      </p>
    </section>
  );
}
