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
}

export function NavigationMenuItem({
  item,
  onClick,
  isActive,
  className = '',
  badge,
  isMobile = false
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

  const baseClasses = `flex items-center gap-2 pr-0 py-2 text-[16px] cursor-pointer font-medium pl-4 ${className}`;
  const activeClasses = isActive ? (item.activeClassName || 'bg-primary-100 text-white') : '';

  const content = (
    <>
      <span className="shrink-0">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
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
