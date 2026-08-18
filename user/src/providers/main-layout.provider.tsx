'use client';

import { defaultSettings, PublicSettings } from '@lib/utils';
import { useSearchParams } from 'next/navigation';
import {
  createContext,
  ReactNode,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import { toast } from 'react-toastify';

export interface IMainLayoutContext {
  publicSettings: Partial<typeof defaultSettings>;
}

const MainLayoutContext = createContext<IMainLayoutContext>({
  publicSettings: defaultSettings
});

// Separate component for search params handling to avoid SSR issues
function SearchParamsHandler() {
  const params = useSearchParams();
  const message = params.get('message');

  useEffect(() => {
    if (message) {
      toast.success(decodeURIComponent(message));
    }
  }, [message]);

  return null;
}

export function MainLayoutProvider({ children, settings }: { children: ReactNode, settings: Record<string, any> }) {
  const [publicSettings] = useState<Partial<PublicSettings>>(settings);

  const themeValue = useMemo(
    () => ({
      publicSettings
    }),
    [publicSettings]
  );

  useEffect(() => {
    window.PUBLIC_SETTINGS = publicSettings;
  }, [publicSettings]);

  return (
    <MainLayoutContext.Provider value={themeValue}>
      {/* Wrap search params handling in Suspense to avoid SSR issues */}
      <Suspense fallback={null}>
        <SearchParamsHandler />
      </Suspense>
      {children}
    </MainLayoutContext.Provider>
  );
}

export const useMainThemeLayout = () => useContext(MainLayoutContext);
