'use client';

import { createContext, useContext, useState } from 'react';

type LeftMenuContextType = {
  open: boolean;
  openMenu: () => void;
  closeMenu: () => void;
  toggleMenu: () => void;
};

const LeftMenuContext = createContext<LeftMenuContextType | null>(null);

export function LeftMenuProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  const value = {
    open,
    openMenu: () => setOpen(true),
    closeMenu: () => setOpen(false),
    toggleMenu: () => setOpen((v) => !v)
  };

  return (
    <LeftMenuContext.Provider value={value}>
      {children}
    </LeftMenuContext.Provider>
  );
}

export function useLeftMenu() {
  const ctx = useContext(LeftMenuContext);
  if (!ctx) {
    throw new Error('useLeftMenu must be used within LeftMenuProvider');
  }
  return ctx;
}
