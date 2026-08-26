'use client';

import { Menu } from 'antd';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React from 'react';

interface SettingsMenuProps {
  selectedTab: string;
}

const menuItems = [
  { key: 'site', label: 'General' },
  // Upload limits live in the ordinary settings collection and render through
  // the same generic form as every other group — they are `number` settings with
  // `meta.min` / `meta.max`, so no bespoke component is needed here. They do
  // carry `meta.section`, which splits the tab into one area per upload type;
  // that split is generic and any group can opt into it the same way.
  { key: 'upload-limits', label: 'Upload limits' }
];

export const SettingsMenu: React.FC<SettingsMenuProps> = ({ selectedTab }) => {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();

  const onMenuChange = ({ key }: { key: string }) => {
    const q = new URLSearchParams(params?.toString() || '');
    q.set('tab', key);
    // `section` belongs to whichever tab was open; carrying it across would leave
    // a stale upload type in the URL of a tab that has no sections at all.
    q.delete('section');
    router.push(`${pathname}?${q.toString()}`);
  };

  return (
    <div style={{ marginBottom: 20, overflowX: 'auto' }}>
      <Menu mode="horizontal" items={menuItems} selectedKeys={[selectedTab]} onClick={onMenuChange} />
    </div>
  );
};
