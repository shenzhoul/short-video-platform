'use client';

import Link from 'next/link';
import {
  createContext, ReactNode,
  useContext, useEffect,
  useMemo,
  useState
} from 'react';
import { useTheme } from 'src/providers/theme-provider';

type ThemeMode = 'light' | 'dark';

export interface IMainLayoutContext {
  placement: string | any;
  sidenavColor: string;
  sidenavType: string;
  themeMode: ThemeMode;
  fixed: boolean;
  breadcrumbs: any;
  onProgress: boolean;
  handleSidenavType: Function;
  handleSidenavColor: Function;
  handleThemeMode: (mode: ThemeMode) => void;
  toggleThemeMode: () => void;
  handleFixedNavbar: Function;
  handlePlacement: Function;
  handleBreadcrumbs: Function;
  setOnProgress: Function;
}

const MainLayoutContext = createContext<IMainLayoutContext>({
  placement: 'right',
  sidenavColor: '#1890ff',
  sidenavType: '#fff',
  themeMode: 'light',
  fixed: false,
  breadcrumbs: [],
  onProgress: true,
  handleSidenavType: () => { },
  handleSidenavColor: () => { },
  handleThemeMode: () => { },
  toggleThemeMode: () => { },
  handleFixedNavbar: () => { },
  handlePlacement: () => { },
  handleBreadcrumbs: () => { },
  setOnProgress: () => { }
});

export interface IBreadcrumbOption {
  text: string;
  href?: string;
}

export function MainLayoutContextProvider({ children }: { children: ReactNode }) {
  const { theme, setTheme, toggleTheme } = useTheme();
  const [placement, setPlacement] = useState('right');
  const [sidenavColor, setSidenavColor] = useState('#1890ff');
  const [sidenavType, setSidenavType] = useState('#fff');
  const [fixed, setFixed] = useState(false);
  const [breadcrumbs, setBreadcrumbs] = useState<any>([]);
  const [onProgress, setOnProgress] = useState(false);

  const setThemeValue = (key: string, val: any) => {
    const currentData = JSON.parse(localStorage.getItem('mainLayoutConfig') || '{}');
    currentData[key] = val;
    localStorage.setItem('mainLayoutConfig', JSON.stringify(currentData));
  };

  const handleSidenavType = (type: string) => {
    setSidenavType(type);
    setThemeValue('sidenavType', type);
  };
  const handleSidenavColor = (color: string) => {
    setSidenavColor(color);
    setThemeValue('sidenavColor', color);
  };
  const handleThemeMode = (mode: ThemeMode) => {
    setTheme(mode);
    setThemeValue('themeMode', mode);
  };
  const toggleThemeMode = () => {
    toggleTheme();
    setThemeValue('themeMode', theme === 'dark' ? 'light' : 'dark');
  };
  const handleFixedNavbar = (type: boolean) => {
    setFixed(type);
    setThemeValue('fixed', type);
  };
  const handlePlacement = (type: string) => {
    setPlacement(type);
    setThemeValue('placement', type);
  };

  const handleBreadcrumbs = (breadcrumbsOptions: IBreadcrumbOption[], options: any = {}) => {
    const { hideDashboard } = options || {};
    if (hideDashboard) setBreadcrumbs(breadcrumbsOptions);
    const newBreadcrumbs = [
      {
        title: <Link href="/dashboard">Dashboard</Link>
      },
      ...breadcrumbsOptions.map((b) => {
        if (!b.href) return { title: b.text };
        return {
          title: <Link key={b.text} href={b.href}>{b.text}</Link>
        };
      })
    ];
    setBreadcrumbs(newBreadcrumbs);
  };

  const themeValue = useMemo(() => ({
    placement,
    sidenavColor,
    sidenavType,
    themeMode: theme,
    fixed,
    breadcrumbs,
    onProgress,
    handleSidenavType,
    handleSidenavColor,
    handleThemeMode,
    toggleThemeMode,
    handleFixedNavbar,
    handlePlacement,
    handleBreadcrumbs,
    setOnProgress

  }), [
    placement,
    sidenavColor,
    sidenavType,
    theme,
    fixed,
    breadcrumbs,
    onProgress
  ]);

  useEffect(() => {
    const currentData = JSON.parse(localStorage.getItem('mainLayoutConfig') || '{}');
    if (currentData.placement) setPlacement(currentData.placement);
    if (currentData.sidenavColor) setSidenavColor(currentData.sidenavColor);
    if (currentData.sidenavType) setSidenavType(currentData.sidenavType);
    if (currentData.themeMode === 'light' || currentData.themeMode === 'dark') {
      setTheme(currentData.themeMode);
    }
    if (currentData.fixed) setFixed(currentData.fixed);
  }, [setTheme]);

  return (
    <MainLayoutContext.Provider value={themeValue}>
      {children}
    </MainLayoutContext.Provider>
  );
}

export const useMainThemeLayout = () => useContext(MainLayoutContext);
