'use client';

import Dropdown from '@components/ui/dropdown-menu';
import { QuestionIcon } from 'src/icons';

const helpItems = ['Frequently Asked Questions', 'My customer service.'];

export default function SidebarHelpMenu() {
  return (
    <Dropdown
      className="static"
      trigger={(
        <div className="flex h-9 w-9 items-center justify-center rounded-full text-(--text-soft) transition hover:bg-(--hover-bg) hover:text-(--text-strong) cursor-pointer">
          <QuestionIcon className="text-2xl" />
        </div>
      )}
      triggerMode="hover"
      width="auto"
      position="left"
      menuClassName="!fixed !bottom-[60px] !left-2 !top-auto !mt-0 !z-[9999] !border-none !bg-transparent !shadow-none"
    >
      <div className="min-w-[204px] w-max rounded-xl bg-(--surface-raised) p-2 text-sm text-(--text-soft) shadow-2xl">
        {helpItems.map((item) => (
          <button
            key={item}
            type="button"
            className="block min-h-10 w-full rounded-md px-3 py-2 text-left leading-5 whitespace-nowrap transition hover:bg-(--hover-bg) hover:text-(--text-strong)"
          >
            {item}
          </button>
        ))}
      </div>
    </Dropdown>
  );
}
