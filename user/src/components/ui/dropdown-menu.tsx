'use client';

import clsx from 'clsx';
import {
  FC, ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState
} from 'react';

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
  /**
   * Dropdowns that must never be open together. Opening one closes every other
   * member of the same group at once, without waiting for a hover grace period
   * — the header's account, notification, message and "More" menus sit next to
   * each other, and moving the pointer from one trigger to the next used to
   * leave both panels on screen.
   */
  group?: string;
}

/* One header dropdown at a time: a fan-out, not a store. */
type GroupListener = (group: string, owner: symbol) => void;
const groupListeners = new Set<GroupListener>();

const ORIGIN_BY_POSITION = {
  left: 'top left',
  center: 'top center',
  right: 'top right',
  top: 'top center'
} as const;

/**
 * The exit animation the surface is running, if any.
 *
 * Read right after the state flips to `closed`: `getAnimations()` flushes style,
 * so the CSS animation named in `globals.css` already exists. Nothing is
 * returned where there is nothing to wait for — reduced motion sets `animation:
 * none`, and jsdom has no Web Animations API — and the surface unmounts at once.
 */
function findExitAnimation(surface: HTMLElement | null): Animation | null {
  if (!surface || typeof surface.getAnimations !== 'function') return null;
  return surface.getAnimations().find((animation) => (
    (animation as CSSAnimation).animationName === 'dropdown-surface-exit'
  )) || null;
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
  onOpenChange,
  group
}) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;
  const dropdownRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownerRef = useRef(Symbol('dropdown'));

  /*
    Whether the surface is in the DOM. It follows `isOpen` on the way in, and
    trails it on the way out until the exit animation has finished, so closing
    plays instead of vanishing. Set during render on opening so the very first
    frame already carries `data-state="open"` and starts from the keyframe's
    first value, never from the resting position.
  */
  const [rendered, setRendered] = useState(isOpen);
  if (isOpen && !rendered) setRendered(true);

  const setOpen = useCallback((next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }, [isControlled, onOpenChange]);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const toggleDropdown = () => setOpen(!isOpen);
  const openDropdown = () => {
    clearCloseTimer();
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

  /*
    Escape is listened for on the document, not on the wrapper.

    The wrapper's `onKeyDown` below only fires while focus is inside the
    dropdown's own subtree — and a `triggerMode="hover"` menu is opened by a
    pointer and never takes focus at all. The account menu therefore ignored
    Escape entirely: measured at 440x956, Escape left the panel open while an
    outside click closed it. The wrapper handler stays for the focused case; a
    close is idempotent, so both firing is harmless.

    Closing here is immediate even in hover mode. The 160ms grace exists so the
    pointer can travel from the trigger to the panel; pressing Escape is an
    explicit dismissal and should not wait for it.
  */
  const handleEscape = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !isOpen) return;
    clearCloseTimer();
    setOpen(false);
  }, [isOpen, setOpen]);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      clearCloseTimer();
    };
  }, [handleClickOutside, handleEscape]);

  // Another member of the group opened: close now, without the hover grace.
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  useEffect(() => {
    if (!group) return undefined;
    const listener: GroupListener = (openedGroup, owner) => {
      if (openedGroup !== group || owner === ownerRef.current || !isOpenRef.current) return;
      clearCloseTimer();
      setOpen(false);
    };
    groupListeners.add(listener);
    return () => {
      groupListeners.delete(listener);
    };
  }, [group, setOpen]);

  useEffect(() => {
    if (!group || !isOpen) return;
    [...groupListeners].forEach((listener) => listener(group, ownerRef.current));
  }, [group, isOpen]);

  /*
    Unmount once the exit has played. Reopening while it plays keeps the same
    element and simply switches it back to the enter animation, so a quick
    close-then-open never flashes an empty frame or a second copy.
  */
  useLayoutEffect(() => {
    if (isOpen || !rendered) return undefined;
    const exit = findExitAnimation(surfaceRef.current);
    if (!exit) {
      setRendered(false);
      return undefined;
    }
    let cancelled = false;
    exit.finished
      .then(() => {
        if (!cancelled && !isOpenRef.current) setRendered(false);
      })
      .catch(() => {
        // Cancelled by a reopen (or an unmount); the open path owns the element now.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, rendered]);

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

      {rendered ? (
        <div
          ref={surfaceRef}
          data-dropdown-surface
          data-state={isOpen ? 'open' : 'closed'}
          className={clsx(
            'dropdown-menu-motion absolute mt-2 bg-surface rounded-lg shadow-lg z-50 border border-border',
            positionClass,
            menuClassName
          )}
          style={{ width, transformOrigin: ORIGIN_BY_POSITION[position] }}
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
