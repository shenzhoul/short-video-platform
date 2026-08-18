import type { ReactNode } from 'react';
import type { Id, ToastOptions, TypeOptions, UpdateOptions } from 'react-toastify';

export type ToastThemeMode = 'light' | 'dark' | 'auto';

export type ToastMessage = ReactNode;

export type ToastOptionsInput = ToastOptions | number | undefined;

export type ToastPromiseMessages<TData = unknown> = {
  pending?: ToastMessage;
  success?: ToastMessage | ((data: TData) => ToastMessage);
  error?: ToastMessage | ((error: unknown) => ToastMessage);
};

export type ToastPromiseOptions<TData = unknown> = {
  messages?: ToastPromiseMessages<TData>;
  options?: ToastOptions;
};

export type SharedToastApi = {
  success: (message: ToastMessage, options?: ToastOptionsInput) => Id;
  error: (message: ToastMessage, options?: ToastOptionsInput) => Id;
  warning: (message: ToastMessage, options?: ToastOptionsInput) => Id;
  info: (message: ToastMessage, options?: ToastOptionsInput) => Id;
  loading: (message: ToastMessage, options?: ToastOptionsInput) => Id;
  dismiss: (id?: Id) => void;
  update: (id: Id, options?: UpdateOptions<unknown>) => void;
  promise: <TData = unknown>(
    promise: Promise<TData> | (() => Promise<TData>),
    config?: ToastPromiseOptions<TData>
  ) => Promise<TData>;
};

export type ToastLevel = TypeOptions;
