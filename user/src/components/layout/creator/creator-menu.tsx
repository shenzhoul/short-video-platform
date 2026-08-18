'use client';

import NavigationMenuItem from '@components/ui/navigation-menu-item';
import { useIsMobile } from '@hooks/use-mobile';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { AnalystIcon, CircleDiamondIcon, HomeIcon, LightningIcon, VideoIcon } from 'src/icons';

export type CreatorMenuItem = {
  key?: string;
  href?: string;
  icon?: ReactNode;
  label?: ReactNode | ((args: { balance: number }) => ReactNode);
  activeClassName?: string;
  tooltip?: string;
  group?: string;
};

export function CreatorMenu() {
  const [activeMenuKey, setActiveMenuKey] = useState<string | undefined>();

  const pathname = usePathname();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [hasHydrated, setHasHydrated] = useState(false);
  const isHydratedMobile = hasHydrated ? isMobile : false;

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const isPathActive = (href: string | undefined, key?: string) => {
    if (activeMenuKey && activeMenuKey === key) return true;
    if (!href) return false;
    return href === '/' ? pathname === '/' : pathname.startsWith(href);
  };

  const menuItems: CreatorMenuItem[] = [
    {
      icon: <HomeIcon />,
      label: 'Home',
      tooltip: 'home',
      key: 'home',
      activeClassName: 'bg-(--active-bg) text-(--text-strong)'
    },
    {
      href: '/creator/posts',
      icon: <VideoIcon />,
      label: 'Post',
      tooltip: 'posts',
      key: 'posts',
      activeClassName: 'bg-(--active-bg) text-(--text-strong)'
    },
    {
      icon: <AnalystIcon />,
      label: 'Analytics',
      tooltip: 'analytics',
      key: 'analytics',
      activeClassName: 'bg-(--active-bg) text-(--text-strong)'
    },
    {
      icon: <CircleDiamondIcon />,
      label: 'Earn',
      tooltip: 'earn',
      key: 'earn',
      activeClassName: 'bg-(--active-bg) text-(--text-strong)'
    },
    {
      icon: <LightningIcon />,
      label: 'Creative',
      tooltip: 'creative',
      key: 'creative',
      activeClassName: 'bg-(--active-bg) text-(--text-strong)'
    }
  ];

  return (
    <div className="space-y-2 flex flex-col gap-2">
      {menuItems.map((item) => (
        <NavigationMenuItem
          key={item.key}
          item={item}
          className="rounded-xl text-(--text-soft) hover:transition-colors hover:duration-200 hover:ease-in hover:bg-(--hover-bg) hover:text-(--text-strong) focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2f5f]"
          isActive={isPathActive(item.href, item.key)}
          isMobile={isHydratedMobile}
          onClick={() => {
            if (isHydratedMobile && (item as any)?.children?.length > 0) {
              setActiveMenuKey(activeMenuKey === item.key ? undefined : item.key);
              return;
            }
            if (pathname === item.href || !item.href) {
              return;
            }
            router.push(item.href);
          }}
        />
      ))}
    </div>
  );
}
