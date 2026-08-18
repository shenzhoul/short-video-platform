'use client';

import ThemeToggle from '@components/theme-toggle';
import Dropdown from '@components/ui/dropdown-menu';
import SidebarSubmenu from '@components/ui/sidebar-submenu';
import { useState } from 'react';
import { FiChevronRight } from 'react-icons/fi';
import { AiSettingIcon, AppearanceIcon, GeneralIcon, HelpIcon, HexagonIcon, HomeSettingIcon, LanguageIcon, SupportIcon } from 'src/icons';

export default function SidebarPreferencesMenu() {
  const [language, setLanguage] = useState<'en' | 'vi'>('en');

  return (
    <Dropdown
      className="static"
      trigger={(
        <div className="flex h-9 w-9 items-center justify-center rounded-full text-(--text-soft) transition hover:bg-(--hover-bg) hover:text-(--text-strong) cursor-pointer">
          <HexagonIcon className="text-2xl" />
        </div>
      )}
      triggerMode="hover"
      width="auto"
      position="left"
      menuClassName="!fixed !bottom-[60px] !left-2 !top-auto !mt-0 !z-[9999] !border-none !bg-transparent !shadow-none"
    >
      <div className="min-w-[204px] w-max rounded-xl bg-(--surface-raised) p-2 text-sm text-(--text-soft) shadow-2xl">
        <SidebarSubmenu
          trigger={(
            <button
              type="button"
              className="flex h-10 w-full items-center justify-between gap-6 rounded-md px-3 transition hover:bg-(--hover-bg) hover:text-(--text-strong) group-hover/submenu:bg-(--hover-bg) group-hover/submenu:text-(--text-strong)"
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                <LanguageIcon className='text-xl' />
                <span>Language</span>
              </span>
              <FiChevronRight className="shrink-0" size={17} />
            </button>
          )}
        >
          {(['en', 'vi'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`block h-10 w-full rounded-md px-3 text-left whitespace-nowrap transition hover:bg-(--hover-bg) hover:text-(--text-strong) ${language === item ? 'bg-(--hover-bg) text-(--text-strong)' : ''}`}
              onClick={() => setLanguage(item)}
            >
              {item === 'en' ? 'English' : 'Vietnamese'}
            </button>
          ))}
        </SidebarSubmenu>

        <button type="button" className="flex h-10 w-full items-center justify-between gap-6 rounded-md px-3 transition hover:bg-(--hover-bg) hover:text-(--text-strong)">
          <span className="flex items-center gap-2 whitespace-nowrap">
            <HomeSettingIcon className='text-xl' />
            <span>Homepage settings</span>
          </span>
          <FiChevronRight className="shrink-0" size={17} />
        </button>

        <div className="flex h-10 w-full items-center justify-between gap-6 rounded-md px-3 transition hover:bg-(--hover-bg) hover:text-(--text-strong)">
          <span className="flex items-center gap-2 whitespace-nowrap">
            <AppearanceIcon className='text-xl' />
            <span>Appearance</span>
          </span>
          <ThemeToggle />
        </div>

        <button type="button" className="flex h-10 w-full items-center justify-between gap-6 rounded-md px-3 transition hover:bg-(--hover-bg) hover:text-(--text-strong)">
          <span className="flex items-center gap-2 whitespace-nowrap">
            <GeneralIcon className='text-xl' />
            <span>General</span>
          </span>
          <FiChevronRight className="shrink-0" size={17} />
        </button>

        <button type="button" className="flex h-10 w-full items-center gap-2 rounded-md px-3 transition hover:bg-(--hover-bg) hover:text-(--text-strong)">
          <AiSettingIcon className='text-xl' />
          <span className="whitespace-nowrap">AI settings</span>
        </button>

        <button type="button" className="flex h-10 w-full items-center gap-2 rounded-md px-3 transition hover:bg-(--hover-bg) hover:text-(--text-strong)">
          <HelpIcon className='text-xl' />
          <span className="whitespace-nowrap">Help</span>
        </button>

        <button type="button" className="flex h-10 w-full items-center gap-2 rounded-md px-3 transition hover:bg-(--hover-bg) hover:text-(--text-strong)">
          <SupportIcon className='text-xl' />
          <span className="whitespace-nowrap">Support</span>
        </button>
      </div>
    </Dropdown>
  );
}
