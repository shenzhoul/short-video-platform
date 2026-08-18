'use client';

import clsx from 'clsx';
import { FC, ReactNode, useCallback, useEffect, useRef, useState } from 'react';

interface DropdownItem {
  label: string;
  value: string;
  icon?: ReactNode;
  onClick?: (value: string) => void;
}

interface DropdownProps {
  trigger: ReactNode;
  children?: ReactNode;
  data?: DropdownItem[];
  position?: 'left' | 'center' | 'right' | 'top';
  triggerMode?: 'click' | 'hover';
  width?: number | string;
  className?: string;
  menuClassName?: string;
  /**
   * Controlled open state. Omit for the default self-managed behaviour; pass it
   * when the caller needs to close the menu itself, for example after the
   * content inside it triggers navigation.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const Dropdown: FC<DropdownProps> = ({
  trigger,
  children,
  data,
  position = 'right',
  triggerMode = 'click',
  width = 200,
  className,
  menuClassName,
  open,
  onOpenChange
}) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;
  const dropdownRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setOpen = useCallback((next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }, [isControlled, onOpenChange]);

  const toggleDropdown = () => setOpen(!isOpen);
  const openDropdown = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  };
  const closeDropdown = useCallback(() => {
    if (triggerMode === 'hover') {
      closeTimerRef.current = setTimeout(() => setOpen(false), 160);
      return;
    }
    setOpen(false);
  }, [setOpen, triggerMode]);

  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
      closeDropdown();
    }
  }, [closeDropdown]);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [handleClickOutside]);

  const positionClass = {
    left: 'left-0',
    center: 'left-1/2 -translate-x-1/2',
    right: 'right-0',
    top: 'top-0'
  }[position];

  return (
    <div
      className={clsx('relative', className)}
      onMouseEnter={() => triggerMode === 'hover' && openDropdown()}
      onMouseLeave={() => triggerMode === 'hover' && closeDropdown()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) setOpen(false);
      }}
      ref={dropdownRef}
    >
      <div onClick={toggleDropdown} className="cursor-pointer flex items-center justify-center">
        {trigger}
      </div>

      {isOpen ? (
        <div
          className={clsx(
            'dropdown-menu-motion absolute mt-2 bg-surface rounded-lg shadow-lg z-50 border border-border',
            positionClass,
            menuClassName
          )}
          style={{ width }}
        >
          {children ? (
            children
          ) : data ? (
            <ul className="divide-y divide-border">
              {data.map((item) => (
                <li
                  key={item.value}
                  onClick={() => {
                    item.onClick?.(item.value);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2 px-4 py-2 hover:bg-surface-muted cursor-pointer text-sm opacity-70"
                >
                  {item.icon ? <span className="text-base opacity-70">{item.icon}</span> : null}
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default Dropdown;
