'use client';

import clsx from 'clsx';
import { ReactNode } from 'react';

interface SidebarSubmenuProps {
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  menuClassName?: string;
  panelClassName?: string;
}

export default function SidebarSubmenu({
  trigger,
  children,
  className,
  menuClassName,
  panelClassName
}: SidebarSubmenuProps) {
  return (
    <div className={clsx('group/submenu relative', className)}>
      {trigger}
      <div
        className={clsx(
          'invisible absolute left-[calc(100%+18px)] -top-2 z-30 min-w-51 w-max max-w-[calc(100vw-24px)] opacity-0 transition before:absolute before:-left-4.5 before:top-0 before:h-full before:w-4.5 before:content-[\'\'] group-hover/submenu:visible group-hover/submenu:opacity-100',
          menuClassName
        )}
      >
        <div className={clsx('min-w-51 w-max rounded-lg bg-(--surface-raised) p-2 shadow-2xl', panelClassName)}>
          {children}
        </div>
      </div>
    </div>
  );
}
