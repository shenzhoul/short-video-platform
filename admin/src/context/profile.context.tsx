'use client';

import {
  createContext, ReactNode,
  useContext, useEffect,
  useMemo,
  useState
} from 'react';
import { authService } from 'src/services/auth.service';
import { userService } from 'src/services/user.service';

import { IUser } from '../interfaces';

export interface IProfileContext {
  current: IUser;
  fetching: boolean;
  setToken: (token: string) => void;
  setUser: (user: IUser) => void;
}

const ProfileContext = createContext<IProfileContext>({
  current: null as any,
  fetching: true,
  setToken: () => { },
  setUser: () => { }
});

export function ProfileContextProvider({ children }: { children: ReactNode }) {
  const [fetching, setFetching] = useState(true);
  const [current, setCurrent] = useState<IUser>(null as any);

  const setUser = (user: IUser) => {
    setCurrent(user);
  }

  const setToken = (token: string) => {
    authService.setToken(token);
  };

  const profileValue = useMemo(() => ({
    current,
    fetching,
    setToken,
    setUser
  }), [current, fetching]);

  const loadProfile = async () => {
    const token = authService.getToken();
    if (token) {
      try {
        setFetching(true);
        const { data } = await userService.me();
        // TODO - check admin role on this route directly
        if (!data.isAdmin) {
          authService.removeToken();
          setFetching(false);
          window.location.href = '/auth/login';
          return;
        }
        setCurrent(data);
        setFetching(false);
      } catch {
        setFetching(false);
        authService.removeToken();
        // force login
        window.location.href = '/auth/login';
      }
    } else {
      setFetching(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  return (
    <ProfileContext.Provider value={profileValue}>
      {children}
    </ProfileContext.Provider>
  );
}

export const useProfile = () => useContext(ProfileContext);
