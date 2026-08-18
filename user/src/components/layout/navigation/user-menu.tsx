'use client';

import { NavigationMenuItem } from '@components/ui/navigation-menu-item';
import { useIsMobile } from '@hooks/use-mobile';
import { IUser } from '@interfaces/user';
import { useProfile } from '@providers/profile.provider';
import { ThemeContext } from '@providers/ThemeProvider';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useContext, useEffect, useState } from 'react';

interface FanMenuProps {
  onLogout: () => void;
  openMenu?: boolean;
  serverUser?: IUser | null;
}

interface SettingItem {
  key: string;
  label: string;
  tooltip?: string;
  icon?: ReactNode;
  href?: string;
  children?: SettingItem[];
}

export type FanMenuItem = {
  key?: string;
  children?: SettingItem[];
  href?: string;
  icon?: ReactNode;
  label?: ReactNode | ((args: { balance: number }) => ReactNode);
  activeClassName?: string;
  tooltip?: string;
  group?: string;
};

export function DashboardMenu({ onLogout, serverUser }: FanMenuProps) {
  const { current: clientUser, fetching } = useProfile();
  const user = fetching ? (serverUser || clientUser) : (clientUser || serverUser);
  const pathname = usePathname();
  const router = useRouter();
  const { theme } = useContext(ThemeContext);
  const isMobile = useIsMobile();
  const [hasHydrated, setHasHydrated] = useState(false);
  const isHydratedMobile = hasHydrated ? isMobile : false;
  const [activeMenuKey, setActiveMenuKey] = useState<string | undefined>();

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const isPathActive = (href: string | undefined, key?: string) => {
    if (activeMenuKey && activeMenuKey === key) return true;
    if (!href) return false;
    return href === '/' ? pathname === '/' : pathname.startsWith(href);
  };

  const getMenuIcon = (name: string, active?: boolean) => {
    const iconTheme = theme === 'dark' ? 'dark' : 'light';
    const iconState = active ? 'active' : 'normal';
    return <img src={`/icons/${name}_${iconTheme}_${iconState}@actual.png`} className='w-6 h-6' alt="" />;
  };

  const menuItems: FanMenuItem[] = [
    {
      href: '/',
      icon: getMenuIcon('topick', isPathActive('/', 'topick')),
      label: 'Topick',
      tooltip: 'Topick',
      key: 'topick',
      activeClassName: 'bg-(--active-bg) text-(--text-strong)'
    },
    {
      href: '/for-you',
      icon: getMenuIcon('foryou', isPathActive('/for-you', 'for-you')),
      label: 'For You',
      tooltip: 'For You',
      key: 'for-you',
      activeClassName: 'bg-(--active-bg) text-(--text-strong)'
    }
  ];

  const menuItemsMiddle: FanMenuItem[] = [
    {
      href: '/following',
      icon: getMenuIcon('following', isPathActive('/following', 'following')),
      label: 'Following',
      tooltip: 'Following',
      key: 'following',
      activeClassName: 'bg-(--active-bg) text-(--text-strong)'
    },
    {
      href: '/friend',
      icon: getMenuIcon('friend', isPathActive('/friend', 'friend')),
      label: 'Friends',
      tooltip: 'Friends',
      key: 'friend',
      activeClassName: 'bg-(--active-bg) text-(--text-strong)'
    },
    {
      href: `/${user?.username}`,
      icon: getMenuIcon('profile', isPathActive(`/${user?.username}`, user?.username || '')),
      label: 'Profile',
      tooltip: 'Profile',
      key: 'profile',
      activeClassName: 'bg-(--active-bg) text-(--text-strong)'
    }
  ];

  const menuItemsBottom: FanMenuItem[] = [
    {
      href: '/minigame',
      icon: getMenuIcon('minigame', isPathActive('/minigame', 'minigame')),
      label: 'Games',
      tooltip: 'Games',
      key: 'minigame',
      activeClassName: 'bg-(--active-bg) text-(--text-strong)'
    }
  ];

  const filteredMenu = menuItems.filter((item) => {
    if (isHydratedMobile && (item.href === '/' || item.href === '/creators')) {
      return false;
    }
    return true;
  });

  return (
    <>
      {/* Top Menu */}
      <div className="border-t border-border pt-4 space-y-2 flex flex-col gap-1">
        {filteredMenu.map((item) => {
          return (
            <NavigationMenuItem
              key={item.key}
              item={item}
              isActive={isPathActive(item.href, item.key)}
              className="rounded-xl text-(--text-soft) hover:transition-colors hover:duration-200 hover:ease-in hover:bg-(--hover-bg) hover:text-(--text-strong) focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2f5f]"
              isMobile={isHydratedMobile}
              onClick={() => {
                if (pathname === item.href || !item.href) {
                  return;
                }
                router.push(item.href);
              }}
            />
          );
        })}
      </div>

      {/* Middle Menu */}
      <div className="border-t border-border pt-4 space-y-2 flex flex-col gap-1">
        {menuItemsMiddle.map((item) => (
          <NavigationMenuItem
            key={item.key}
            item={item}
            className="rounded-xl text-(--text-soft) hover:transition-colors hover:duration-200 hover:ease-in hover:bg-(--hover-bg) hover:text-(--text-strong) focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2f5f]"
            isActive={isPathActive(item.href, item.key)}
            isMobile={isHydratedMobile}
            onClick={() => {
              if (item.key === 'logout') {
                onLogout();
                return;
              }
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

      {/* Bottom Menu */}
      <div className="border-t border-border pt-4 space-y-2 flex flex-col gap-1">
        {menuItemsBottom.map((item) => (
          <NavigationMenuItem
            key={item.key}
            item={item}
            className="rounded-xl text-(--text-soft) hover:transition-colors hover:duration-200 hover:ease-in hover:bg-(--hover-bg) hover:text-(--text-strong) focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2f5f]"
            isActive={isPathActive(item.href, item.key)}
            isMobile={isHydratedMobile}
            onClick={() => {
              if (item.key === 'logout') {
                onLogout();
                return;
              }
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
    </>
  );
}

export default DashboardMenu;
