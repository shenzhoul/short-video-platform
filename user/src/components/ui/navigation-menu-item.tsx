'use client';

import { useRouter } from 'next/navigation';
import { FiChevronRight } from 'react-icons/fi';

interface NavigationMenuItemProps {
  item: any;
  onClick?: () => void;
  isActive?: boolean;
  className?: string;
  badge?: string | number;
  isMobile?: boolean;
  /**
   * How the row lays itself out.
   *
   * `row` is the original icon-then-label row and stays the default, so the
   * creator shell — which has its own layout and its own breakpoints — is
   * untouched.
   *
   * `rail` is the application shell's primary navigation: the same row from
   * `lg` up, and an icon above a small caption below it, which is what fits the
   * 56px compact rail. Expressed as CSS variants rather than a JavaScript
   * breakpoint so the first paint is already correct — a `useIsMobile` here
   * would render the desktop shape on the server and snap after hydration.
   */
  variant?: 'row' | 'rail';
}

export function NavigationMenuItem({
  item,
  onClick,
  isActive,
  className = '',
  badge,
  isMobile = false,
  variant = 'row'
}: NavigationMenuItemProps) {
  const router = useRouter();
  const tooltipText = item.tooltip || (typeof item.label === 'string' ? item.label : undefined);
  const navigateToItem = (target: any) => {
    if (!target?.href) return;

    const isExternal = /^https?:\/\//.test(target.href);
    if (target.newTab) {
      window.open(target.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (isExternal) {
      window.location.href = target.href;
      return;
    }

    router.push(target.href);
  };

  const isRail = variant === 'rail';
  const baseClasses = isRail
    ? `flex cursor-pointer font-medium
       max-lg:flex-col max-lg:items-center max-lg:justify-center max-lg:gap-px max-lg:px-0 max-lg:py-1 max-lg:text-[8px] max-lg:leading-[10px]
       lg:flex-row lg:items-center lg:gap-2 lg:pl-4 lg:pr-0 lg:py-2 lg:text-[16px] ${className}`
    : `flex items-center gap-2 pr-0 py-2 text-[16px] cursor-pointer font-medium pl-4 ${className}`;
  const activeClasses = isActive ? (item.activeClassName || 'bg-primary-100 text-white') : '';

  const content = (
    <>
      <span className="shrink-0">{item.icon}</span>
      {/*
        In the compact rail the caption sits under the icon in a 56px column, so
        it truncates rather than wrapping — a wrapped caption would make one row
        taller than its neighbours and step the whole rail out of alignment.
      */}
      <span className={isRail ? 'w-full min-w-0 truncate text-center lg:flex-1 lg:text-left' : 'flex-1'}>{item.label}</span>
      {badge ? (
        <span className="ml-auto bg-red-500 text-white text-xs px-2 py-1 rounded-[10px]">
          {badge}
        </span>
      ) : null}
    </>
  );

  return (
    <>
      <button
        onClick={onClick}
        className={`${baseClasses} ${activeClasses} rounded-lg flex items-center w-full text-left mb-0`}
        title={tooltipText}
        aria-label={tooltipText}
      >
        {content}
        {item.children ? <FiChevronRight className={`transition-transform duration-200 ${isActive ? 'rotate-90' : ''}`} /> : null}
      </button>
      {isMobile && isActive && item.children ? item.children.map((child: any) => (
        <div
          onClick={() => {
            navigateToItem(child);
          }}
          key={child.key}
          className="flex items-center gap-2 px-2 py-2.5 text-[14px] font-medium rounded-lg pl-8"
          title={child.tooltip || child.label}
        >
          <span className="shrink-0">{child.icon}</span>
          <span className="flex-1">{child.label}</span>
        </div>
      )) : null}
    </>
  );

}

export default NavigationMenuItem;
