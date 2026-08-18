'use client';

import { ThemeContext } from '@providers/ThemeProvider';
import { useContext } from 'react';
import { MoonIcon, SunIcon } from 'src/icons';

interface ThemeToggleProps {
  className?: string;
}

export default function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { theme, setTheme } = useContext(ThemeContext);

  return (
    <span className={`flex items-center gap-1 ${className}`}>
      <button
        type="button"
        className={`flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-white hover:text-black ${theme === 'light' ? 'bg-white text-black' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setTheme('light');
        }}
        title="Light color mode"
      >
        <SunIcon className="text-[16px]" />
      </button>
      <button
        type="button"
        className={`flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-black hover:text-white ${theme === 'dark' ? 'bg-black text-white' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setTheme('dark');
        }}
        title="Dark color mode"
      >
        <MoonIcon className="text-[16px]" />
      </button>
    </span>
  );
}
