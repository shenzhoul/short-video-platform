'use client';

import {
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined
} from '@ant-design/icons';
import {
  // Breadcrumb,
  Button,
  Dropdown
} from 'antd';
import { MenuProps } from 'antd/lib';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useConfig } from 'src/context/config.context';
import { useProfile } from 'src/context/profile.context';
import { getThemedLogo } from 'src/lib/logo';
import { useTheme } from 'src/providers/theme-provider';

function Header({ toggleCollapsed, showMenuMobile, collapsed }: any) {

  const { current } = useProfile();
  const [logoHydrated, setLogoHydrated] = useState(false);
  const config = useConfig();
  const { theme } = useTheme();
  const siteLogo = getThemedLogo(config, logoHydrated ? theme : 'light');
  useEffect(() => {
    setLogoHydrated(true);
    window.scrollTo(0, 0);
  }, []);

  const handleLogout = () => {
    window.location.href = '/auth/logout';
  };

  const router = useRouter();

  const menuItems = [
    {
      key: 'account',
      icon: <UserOutlined />,
      label: 'Account Settings',
      action: () => router.push(`/account/settings`)
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Logout',
      action: handleLogout
    }
  ];

  const items: MenuProps['items'] = menuItems.map((item) => ({
    key: item.key,
    label: (
      <div
        onClick={item.action}
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
      >
        {item.icon}
        <span>{item.label}</span>
      </div>
    )
  }));

  return (
    <>
      <div style={{ display: 'flex', gap: '10px' }}>
        <Button
          type="default"
          onClick={toggleCollapsed}
          className='toggle-menu-desktop'
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        </Button>
        <Button
          type="primary"
          onClick={showMenuMobile}
          className='toggle-menu-mobile'
          aria-label="Open navigation menu"
          title="Open navigation menu"
        >
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        </Button>
        <div className='header-logo'>
          <Link href="/">
            <img
              alt="logo"
              src={siteLogo}
            />
          </Link>
        </div>
      </div>
      <div className="header-control">
        <Dropdown menu={{ items }} placement="bottomRight" trigger={['click']}>
          <div style={{ cursor: 'pointer', background: 'var(--color-grey)', color: 'var(--text-color)', borderRadius: '20px', display: 'flex', gap: '5px', padding: '5px 15px' }}>
            <UserOutlined />
            <span>{current?.username}</span>
          </div>
        </Dropdown>
      </div>
    </>
  );
}

export default Header;
