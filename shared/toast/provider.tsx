'use client';

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
