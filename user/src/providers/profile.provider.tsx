'use client';

import { IUser } from '@interfaces/user';
import { clearToken, getToken } from '@services/auth.service';
import { userService } from '@services/user.service';
import { useSession } from 'next-auth/react';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useState
} from 'react';
import { useSocketListeners } from 'src/socket';

export interface IProfileContext {
  current: IUser;
  fetching: boolean;
  loadProfile: () => void;
  loggedIn: boolean;
}

const ProfileContext = createContext<IProfileContext>({
  current: null as any,
  fetching: true,
  loadProfile: () => { },
  loggedIn: false
});

export function ProfileProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const [fetching, setFetching] = useState(true);
  const [current, setCurrent] = useState<IUser>(null as any);

  const loadProfile = useCallback(async () => {
    const token = session?.data?.accessToken || getToken();
    if (session?.status === 'authenticated' && token) {
      try {
        setFetching(true);
        const { data } = await userService.me({
          Authorization: token
        });
        // restrict inactive/deleted users from accessing the profile
        if (!['active', 'under-review'].includes(data.status as any)) {
          window.location.href = '/auth/logout';
          return;
        }
        setCurrent(data);
      } catch (e: any) {
        // Handle 401/403 errors by redirecting to logout
        const statusCode = e?.statusCode || e?.response?.status || e?.details?.code;
        if (statusCode && [401, 403].includes(statusCode)) {
          // force clear token to avoid loops
          clearToken();
          window.location.href = '/auth/logout';
          return;
        }
      } finally {
        setFetching(false);
      }
    } else if (session?.status === 'unauthenticated') {
      // Clear profile when unauthenticated
      setCurrent(null as any);
      setFetching(false);
    } else if (session?.status === 'loading') {
      // Keep fetching true while session is loading
      setFetching(true);
    } else {
      setFetching(false);
    }
  }, [session?.data?.accessToken, session?.status]);

  // Extract profile loading to effect event to avoid unnecessary dependency chain
  const handleLoadProfile = useEffectEvent(async () => {
    await loadProfile();
  });

  useEffect(() => {
    handleLoadProfile();
    // handleLoadProfile is from useEffectEvent and shouldn't be in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status]);

  // Listen to real-time balance and unpaidEarnings updates via socket
  useSocketListeners(
    {
      'user/status-changed': (data: { status: string }) => {
        // restrict inactive/deleted users from accessing the profile
        if (!['active', 'under-review'].includes(data.status as any)) {
          window.location.href = '/auth/logout';
          return;
        }
      }
    },
    {
      enabled: !!current && session?.status === 'authenticated'
    }
  );

  const profileValue = useMemo(
    () => {
      const hasToken = !!(session?.data?.accessToken || getToken());
      const isSessionAuthenticated = session?.status === 'authenticated';
      const loggedIn = isSessionAuthenticated && hasToken;

      return {
        current,
        fetching,
        loadProfile,
        // User is logged in only if both session is authenticated AND token exists
        // This prevents race conditions during logout when session might not update immediately
        loggedIn
      };
    },
    [current, fetching, session?.data?.accessToken, session?.status, loadProfile]
  );

  return (
    <ProfileContext.Provider value={profileValue}>
      {children}
    </ProfileContext.Provider>
  );
}

export const useProfile = () => useContext(ProfileContext);
