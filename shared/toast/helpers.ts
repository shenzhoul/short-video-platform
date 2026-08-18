import type { ToastMessage, ToastOptionsInput } from './types';
import { toast } from './toast';

const DEFAULT_SUCCESS_OPTIONS: ToastOptionsInput = 3;

type SuccessHelper = (message?: ToastMessage, options?: ToastOptionsInput) => void;

const withDefaultSuccess = (defaultMessage: string): SuccessHelper => (message, options = DEFAULT_SUCCESS_OPTIONS) => {
  toast.success(message ?? defaultMessage, options);
};

export const toastHelpers = {
  saved: withDefaultSuccess('Saved successfully'),
  created: withDefaultSuccess('Created successfully'),
  updated: withDefaultSuccess('Updated successfully'),
  deleted: withDefaultSuccess('Deleted successfully'),
  uploaded: withDefaultSuccess('Uploaded successfully'),
  copied: withDefaultSuccess('Copied successfully'),
  sent: withDefaultSuccess('Sent successfully'),
  loginSuccess: withDefaultSuccess('Login successful'),
  logoutSuccess: withDefaultSuccess('Logged out successfully')
};
