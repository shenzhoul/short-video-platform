'use client';

import { getResponseError, showError, showSuccess } from '@lib/utils';
import { settingService } from '@services/setting.service';
import { useEffect, useEffectEvent } from 'react';

export interface UseFormValidationProps {
  dataChange: React.RefObject<Record<string, any>>;
  refetchSettings: () => void;
  errorSettings: any;
}

export const useFormValidation = ({
  dataChange,
  refetchSettings,
  errorSettings
}: UseFormValidationProps) => {
  const handleErrors = useEffectEvent(() => {
    if (errorSettings) {
      showError(getResponseError(errorSettings) || 'An error occurred, please try again!');
    }
  });

  useEffect(() => {
    handleErrors();
  }, [errorSettings]);

  const submit = async () => {
    try {
      for (const key of Object.keys(dataChange.current)) {
        if (key.indexOf('commission') !== -1) {
          if (Number.isNaN(dataChange.current[key])) {
            showError('Commission must be a number!');
            return;
          }
          if (dataChange.current[key] < 0 || dataChange.current[key] > 100) {
            showError('Commission must be from 0 to 100!');
            return;
          }
        }
        await settingService.update(key, dataChange.current[key]);
      }
      showSuccess('Settings updated successfully');
      refetchSettings();
      const includedKeys = [
        'site.identity.logoUrl',
        'site.identity.whiteLogoUrl',
        'site.identity.faviconUrl',
        'site.identity.pageLoadingIconUrl',
        'site.maintenance.imageUrl'
      ];
      const changedKeys = Object.keys(dataChange.current).filter(key => includedKeys.includes(key));
      if (changedKeys.length > 0) {
        window.location.reload();
      }
    } catch (e: any) {
      showError(getResponseError(e) || 'Update failed');
    }
  };

  return { submit };
};
