'use client';

import {
  DashboardOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
  TeamOutlined } from '@ant-design/icons';
import classNames from 'classnames';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useConfig } from 'src/context/config.context';
import { useProfile } from 'src/context/profile.context';
import { getThemedLogo } from 'src/lib/logo';
import { useTheme } from 'src/providers/theme-provider';

import SideMenu from './side-menu';
import s from './sidenav.module.scss';

interface P {
  collapsed: any;
}

function Sidenav({ collapsed }: P) {
  const [selectedKey, setSelectedKey] = useState('dashboard');
  const [logoHydrated, setLogoHydrated] = useState(false);
  const config = useConfig();
  const { theme, toggleTheme } = useTheme();
  const siteLogo = getThemedLogo(config, logoHydrated ? theme : 'light');
  const { current: profile } = useProfile();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    setLogoHydrated(true);
  }, []);

  // Check if current user is superadmin
  const isSuperadmin = profile?.username === 'superadmin';

  const menuItems = useMemo(() => [
    // Core Dashboard
    {
      key: 'dashboard',
      href: '/dashboard',
      icon: <DashboardOutlined />,
      label: 'Dashboard'
    },
    // User Management
    {
      key: 'users',
      href: '#',
      icon: <TeamOutlined />,
      label: 'User Management',
      children: [
        {
          key: 'user-list',
          label: 'All Users',
          href: '/identity/users'
        },
        {
          key: 'create-user',
          label: 'Create User',
          href: '/identity/users/create'
        },
        ...(isSuperadmin ? [{
          key: 'admin-management',
          label: 'Admin Management',
          href: '/identity/users/admin-management'
        }] : [])
      ]
    },
    // System & Settings
    {
      key: 'system',
      icon: <SettingOutlined />,
      label: 'System',
      href: '#',
      children: [
        {
          key: 'settings',
          label: 'Settings',
          href: '/system/settings'
        },
        {
          key: 'audit-logs',
          label: 'Audit Logs',
          href: '/system/logger/audit-logs'
        },
        {
          key: 'system-logs',
          label: 'System Logs',
          href: '/system/logger/system-logs'
        },
        {
          key: 'http-exception-logs',
          label: 'HTTP Exception Logs',
          href: '/system/logger/http-exception-logs'
        },
        {
          key: 'request-logs',
          label: 'Request Logs',
          href: '/system/logger/request-logs'
        }
      ]
    }
  ], [isSuperadmin]);

  const menus = useMemo(() => menuItems.map((item: any) => {
    const isParent = item.children && item.children.length > 0;
    return {
      key: item.key,
      label: (
        <div key={item.key}>
          <Link href={item.href} onClick={item.onClick}>
            <span
              className="icon"
            >
              {item.icon}
            </span>
            <span className={`label ${collapsed ? 'label-collapsed' : ''}`}>{item.label}</span>
          </Link>
        </div>
      ),
      ...(isParent && {
        children: item.children.map((child: any) => ({
          key: child.key,
          hidden: true,
          // label: <span className={s.label}>{child.label}</span>,
          label: (
            <span className={s.label}>
              <Link href={child.href || '#'}>{child.label}</Link>
            </span>
          )
        }))
      })
    };
  }), [menuItems, collapsed]);

  useEffect(() => {
    const currentSearch = searchParams?.toString() || '';
    const active = (menuItems as any)
      .reduce((accumulator: any, menuItem: any) => {
        if (Array.isArray(menuItem.children) && menuItem.children.length > 0) {
          return [...accumulator, menuItem, ...menuItem.children];
        }

        return [...accumulator, menuItem];
      }, [])
      .find((i: any) => {
        const [itemPath, itemQuery] = (i.href || '').split('?');
        if (itemQuery) {
          // Item has query params — require both path and query to match
          return pathname === itemPath && currentSearch === itemQuery;
        }
        // No query params — match path only
        return pathname === itemPath;
      });

    if (active) setSelectedKey(active.activeKey || active.key);
  }, [pathname, searchParams, menuItems]);

  return (
    <div className={classNames(s.sider, { [s.collapsed]: collapsed })}>
      <div className={s.brand}>
        <div className={s.logo}>
          <Link href="/">
            <img
              alt="logo"
              src={!collapsed ? (siteLogo) : '/logo.png'}
            />
          </Link>
        </div>
      </div>
      <div className={s['menu-container']}>
        <SideMenu
          menus={menus}
          selectedKey={selectedKey}
          collapsed={collapsed}
        />
      </div>
      <div className={s.themeActions}>
        <button
          type="button"
          className={s.themeToggle}
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title="Toggle theme"
        >
          <span className={classNames(s.themeIcon, s.sunIcon)} aria-hidden="true">
            <SunOutlined />
          </span>
          <span className={classNames(s.themeIcon, s.moonIcon)} aria-hidden="true">
            <MoonOutlined />
          </span>
          {!collapsed ? (
            <>
              <span className={s.lightLabel}>Light</span>
              <span className={s.darkLabel}>Dark</span>
            </>
          ) : null}
        </button>
      </div>
    </div>
  );
}

export default Sidenav;
