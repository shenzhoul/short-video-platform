'use client';

import AuthForgotForm from '@components/auth/auth-forgot-form';
import AuthLoginForm from '@components/auth/auth-login-form';
import AuthQrPanel from '@components/auth/auth-qr-panel';
import AuthSignupForm from '@components/auth/auth-signup-form';
import ModalComponent from '@components/ui/modal';
import { useAuthModal } from '@providers/auth-modal.provider';
import { useMainThemeLayout } from '@providers/main-layout.provider';
import { useEffect, useRef } from 'react';

/**
 * The application's login / signup dialog.
 *
 * Mounted only by `AuthModalProvider`, never directly by a feature — that is
 * what guarantees one dialog at a time. It is a presentation shell: the provider
 * owns whether it is open and why, and the two forms own their own submission.
 *
 * Layout follows the product it clones: a dark overlay, a centred panel, a close
 * control top-right, and — in login mode — a QR column beside the credentials
 * column. Signup drops the QR column, because scanning is a way of logging in to
 * an account that already exists; so does the forgot-password pane, for the same
 * reason.
 *
 * The overlay, the scroll lock, Escape, the focus trap, backdrop-click and
 * `role="dialog"` / `aria-modal` all come from the shared `ModalComponent`
 * rather than being reimplemented here.
 */
export default function AuthModal() {
  const { mode, closeAuthModal, setMode } = useAuthModal();
  const { publicSettings } = useMainThemeLayout();
  const siteName = publicSettings?.siteName || 'Douyin';

  const isLogin = mode === 'login';
  const title = {
    login: `Log in to ${siteName}`,
    signup: `Sign up for ${siteName}`,
    forgot: 'Reset your password'
  }[mode];

  /**
   * Where the caret goes when the dialog opens, and again after a mode switch.
   *
   * Without this the trap's default lands on the close button, which is the one
   * control nobody opened the dialog to use. Remounting the form on a mode
   * change re-runs the modal's focus effect, so the new pane's first field gets
   * it too.
   */
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  /**
   * Move focus to the new pane's first field after a mode switch.
   *
   * The shared modal only places focus when it *opens*; switching login↔signup
   * keeps it open, so without this the caret stays on the "Sign up" link that
   * has just been replaced.
   */
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    firstFieldRef.current?.focus();
  }, [mode]);

  return (
    <ModalComponent
      open
      onCancel={closeAuthModal}
      footer={false}
      noPadding
      ariaLabel={title}
      initialFocusRef={firstFieldRef}
      // Wide enough for two columns on a desktop, and capped by the shared
      // panel's `max-w-[95%]` on anything narrower.
      width={isLogin ? 720 : 520}
      className="bg-(--bg-modal) text-(--text-strong)"
    >
      <div className="px-6 pb-8 pt-9 sm:px-8">
        <h2 className="text-center text-[22px] font-semibold leading-7 text-(--text-strong)">
          {title}
        </h2>

        <div
          className={
            isLogin
              ? 'mt-7 grid gap-8 md:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] md:gap-7'
              : 'mt-7'
          }
        >
          {isLogin ? (
            <>
              {/* Hidden rather than reflowed on small screens: a 160px code
                  above a form is a lot of scrolling for something that cannot
                  be scanned by the device already holding the page. */}
              <div className="hidden md:block">
                <AuthQrPanel />
              </div>
              <div className="hidden bg-(--divider) md:block" aria-hidden="true" />
            </>
          ) : null}

          <div>
            {mode === 'login' ? (
              <AuthLoginForm
                key="login"
                firstFieldRef={firstFieldRef}
                onSwitchToSignup={() => setMode('signup')}
                onSwitchToForgot={() => setMode('forgot')}
              />
            ) : null}
            {mode === 'signup' ? (
              <AuthSignupForm
                key="signup"
                firstFieldRef={firstFieldRef}
                onSwitchToLogin={() => setMode('login')}
              />
            ) : null}
            {mode === 'forgot' ? (
              <AuthForgotForm
                key="forgot"
                firstFieldRef={firstFieldRef}
                onSwitchToLogin={() => setMode('login')}
              />
            ) : null}
          </div>
        </div>
      </div>
    </ModalComponent>
  );
}
