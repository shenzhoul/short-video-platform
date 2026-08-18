'use client';

import Dropdown from '@components/ui/dropdown-menu';
import SidebarSubmenu from '@components/ui/sidebar-submenu';
import { FiChevronRight } from 'react-icons/fi';
import { GridIcon } from 'src/icons';

const aboutItems = ['Official website', 'About Us', 'Join us', 'Contact Us', 'The Rules Center'];
const serviceItems = [
  { label: 'About trembling', children: aboutItems },
  { label: 'Creative services', children: ['Creator Center', 'Douyin Music', 'Effect Open Platform'] },
  { label: 'Security and Trust Center' },
  { label: 'TikTok Live Companion' },
  { label: 'Douyin e-commerce' },
  { label: 'Life services' },
  { label: 'Advertising' },
  { label: 'The Open Platform' }
];

export default function SidebarServicesMenu() {
  return (
    <Dropdown
      className="static"
      trigger={(
        <div className="flex h-9 w-9 items-center justify-center rounded-full text-(--text-soft) transition hover:bg-(--hover-bg) hover:text-(--text-strong) cursor-pointer">
          <GridIcon className="text-2xl" />
        </div>
      )}
      triggerMode="hover"
      width="auto"
      position="left"
      menuClassName="!fixed !bottom-[60px] !left-2 !top-auto !mt-0 !z-[9999] !border-none !bg-transparent !shadow-none"
    >
      <div className="min-w-[204px] w-max rounded-xl bg-(--surface-raised) p-2 text-sm text-(--text-soft) shadow-2xl">
        {serviceItems.map((item) => (
          item.children ? (
            <SidebarSubmenu
              key={item.label}
              trigger={(
                <button
                  type="button"
                  className="flex h-10 w-full items-center justify-between gap-6 rounded-md px-3 text-left transition hover:bg-(--hover-bg) hover:text-(--text-strong) group-hover/submenu:bg-(--hover-bg) group-hover/submenu:text-(--text-strong)"
                >
                  <span className="whitespace-nowrap">{item.label}</span>
                  <FiChevronRight className="shrink-0" size={17} />
                </button>
              )}
            >
              {item.children.map((child) => (
                <button
                  key={child}
                  type="button"
                  className="block h-10 w-full rounded-md px-3 text-left whitespace-nowrap transition hover:bg-(--hover-bg) hover:text-(--text-strong)"
                >
                  {child}
                </button>
              ))}
            </SidebarSubmenu>
          ) : (
            <button
              key={item.label}
              type="button"
              className="flex h-10 w-full items-center justify-between rounded-md px-3 text-left transition hover:bg-(--hover-bg) hover:text-(--text-strong)"
            >
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          )
        ))}
      </div>
    </Dropdown>
  );
}
