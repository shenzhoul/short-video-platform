'use client';

import { Menu } from 'antd';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React from 'react';

interface SettingsMenuProps {
  selectedTab: string;
}

const menuItems = [
  { key: 'site', label: 'General' }
];

export const SettingsMenu: React.FC<SettingsMenuProps> = ({ selectedTab }) => {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();

  const onMenuChange = ({ key }: { key: string }) => {
    const q = new URLSearchParams(params?.toString() || '');
    q.set('tab', key);
    router.push(`${pathname}?${q.toString()}`);
  };

  return (
    <div style={{ marginBottom: 20, overflowX: 'auto' }}>
      <Menu mode="horizontal" items={menuItems} selectedKeys={[selectedTab]} onClick={onMenuChange} />
    </div>
  );
};
