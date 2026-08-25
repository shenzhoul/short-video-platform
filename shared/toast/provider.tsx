'use client';

// The package owns its own styling.
//
// Every app that renders this provider needs this stylesheet, so requiring each
// one to remember a second import made the styles an app-level concern that had
// nothing to do with the app. Keeping it here also lets `react-toastify` be
// banned outright in application code rather than banned-except-for-the-CSS.
import 'react-toastify/dist/ReactToastify.css';
// After the library's own stylesheet, so these override its palette. See the
// file for why every default level failed WCAG AA.
import './toast-theme.css';
import { useEffect, useState } from 'react';
import { ToastContainer } from 'react-toastify';

import { TOAST_CONTAINER_ID, TOAST_POSITION } from './constants';
import type { ToastThemeMode } from './types';

type SharedToastProviderProps = {
  theme?: ToastThemeMode;
};

const resolveTheme = (theme: ToastThemeMode = 'auto') => {
  if (theme === 'auto') return 'colored';
  return theme;
};

export function SharedToastProvider({ theme = 'auto' }: SharedToastProviderProps) {
  const [canRender, setCanRender] = useState(true);

  useEffect(() => {
    const existing = document.querySelector(
      `[data-toast-container-id="${TOAST_CONTAINER_ID}"]`
    );
    if (existing) setCanRender(false);
  }, []);

  if (!canRender) return null;

  return (
    <ToastContainer
      containerId={TOAST_CONTAINER_ID}
      position={TOAST_POSITION}
      newestOnTop
      closeOnClick
      pauseOnHover
      pauseOnFocusLoss
      draggable
      theme={resolveTheme(theme)}
    />
  );
}
