'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  FiArrowLeft,
  FiBarChart2,
  FiChevronRight,
  FiExternalLink,
  FiHeart,
  FiLock,
  FiUser
} from 'react-icons/fi';

interface SettingProps {
  menu?: string;
  submenu?: string;
  title?: string;
  subTitle?: string;
  children?: React.ReactNode;
}

interface SettingItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  href?: string;
  newTab?: boolean;
  children?: SettingItem[];
}

/* ================= DATA ================= */

export const settingsMenu: SettingItem[] = [
  {
    key: 'account',
    label: 'Account',
    icon: <FiUser size={20} />,
    href: '/account/edit-profile',
    children: [
      {
        key: 'account-info',
        label: 'Edit Profile',
        icon: <FiUser size={18} />,
        href: '/account/edit-profile'
      },
      {
        key: 'change-my-password',
        label: 'Change Password',
        icon: <FiLock size={18} />,
        href: '/account/change-my-password'
      },
      {
        key: 'following',
        label: 'My Following',
        icon: <FiHeart size={22} />,
        href: '/community/following'
      }
    ]
  },
  {
    key: 'creator-dashboard',
    label: 'Creator Dashboard',
    icon: <FiBarChart2 size={20} />,
    href: '/finance',
    children: [
      {
        key: 'followers',
        label: 'My Followers',
        icon: <FiHeart size={18} />,
        href: '/creator-dashboard/followers'
      }
    ]
  }
];

export function renderMenuIcon(_k: string, _p: string) {
  return <FiExternalLink size={18} />;
}
/* ================= MOBILE HEADER ================= */

function MobileHeader({
  title,
  onBack
}: {
  title: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-4 border-b border-border">
      <button onClick={onBack} className='xl:hidden'>
        <FiArrowLeft size={20} />
      </button>
      <h2 className="text-[18px] font-bold">{title}</h2>
    </div>
  );
}

/* ================= COMPONENT ================= */

export default function SettingsLayout({
  children,
  title,
  subTitle,
  menu,
  submenu
}: SettingProps) {
  const [activeMenuKey, setActiveMenuKey] = useState<string | undefined>(menu);
  const router = useRouter();

  useEffect(() => {
    if (menu) {
      setActiveMenuKey(menu);
    }
  }, [menu]);

  const visibleSettingsMenu = settingsMenu.map((item) => {
    return item;
  });

  const activeMenu = visibleSettingsMenu.find(
    (item) => item.key === activeMenuKey
  );

  const activeSubMenu = activeMenu?.children?.find((child) => child.key === submenu);
  const navigateToItem = (item: SettingItem) => {
    if (!item.href) return;

    const isExternal = /^https?:\/\//.test(item.href);
    if (item.newTab) {
      window.open(item.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (isExternal) {
      window.location.href = item.href;
      return;
    }

    router.push(item.href);
  };

  return (
    <div className="xl:flex h-full gap-2">
      <div className="bg-surface xl:w-75 rounded-xl hidden md:block">
        <div className="p-4 border-b border-border">
          <h2 className="text-[18px] font-bold">{activeMenu?.label}</h2>
        </div>
        {activeMenu.children.map((item) => (
          <button
            key={item.key}
            onClick={() => {
              navigateToItem(item);
            }}
            className={`
                w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface-soft
                text-[16px] font-medium transition
                ${activeSubMenu?.key === item.key ? 'xl:bg-primary-200' : 'hover:bg-muted'}
              `}
          >
            <div className="flex gap-2 items-center">
              {item.icon}
              {item.label}
            </div>
            <FiChevronRight />
          </button>
        ))}
      </div>

      {activeSubMenu ? (
        <div className="bg-surface flex-1 rounded-xl overflow-auto min-w-0">
          <MobileHeader
            title={title || activeSubMenu.label}
            onBack={() => {
              router.back();
            }}
          />
          {subTitle ? <h2 className="text-[14px] font-medium opacity-60 px-4 pt-2">{subTitle}</h2> : null}
          <div className="p-4">{children}</div>
        </div>
      ) : null}
    </div>
  );
}
