'use client';

import { createContext, useContext } from 'react';

const defaultValues = {
  'site.identity.logoUrl': '',
  'site.identity.whiteLogoUrl': '',
  'site.identity.faviconUrl': ''
};

const ConfigContext = createContext(defaultValues);

type Settings = typeof defaultValues;

/**
 * Simplified config provider
 */
export function ConfigProvider({ children, settings }: { children: React.ReactNode; settings: Partial<Settings> }) {
  const mergedSettings = {
    ...defaultValues,
    ...settings
  };

  return (
    <ConfigContext.Provider value={mergedSettings}>
      {children}
    </ConfigContext.Provider>
  );
}

export const useConfig = () => useContext(ConfigContext);
