'use client';

import { HTMLAttributes, ReactNode, useState } from 'react';

export interface TabItem<Key extends string = string> {
  key: Key;
  disabled?: boolean;
}

interface TabsRenderProps<Item extends TabItem> {
  activeKey: Item['key'];
  isActive: (item: Item) => boolean;
  setActiveKey: (key: Item['key']) => void;
  getTabProps: (item: Item) => HTMLAttributes<HTMLElement>;
}

interface TabsProps<Item extends TabItem> {
  tabs: Item[];
  value?: Item['key'];
  defaultValue?: Item['key'];
  onChange?: (key: Item['key'], item: Item) => void;
  children: (props: TabsRenderProps<Item>) => ReactNode;
}

export function Tabs<Item extends TabItem>({
  tabs,
  value,
  defaultValue,
  onChange,
  children
}: TabsProps<Item>) {
  const [internalValue, setInternalValue] = useState<Item['key'] | undefined>(
    defaultValue ?? tabs[0]?.key
  );
  const activeKey = value ?? internalValue ?? tabs[0]?.key;

  const setActiveKey = (key: Item['key']) => {
    const item = tabs.find((tab) => tab.key === key);
    if (!item || item.disabled) {
      return;
    }

    if (value === undefined) {
      setInternalValue(key);
    }
    onChange?.(key, item);
  };

  const isActive = (item: Item) => item.key === activeKey;

  const getTabProps = (item: Item): HTMLAttributes<HTMLElement> => ({
    role: 'tab',
    tabIndex: item.disabled ? -1 : 0,
    'aria-selected': isActive(item),
    'aria-disabled': item.disabled || undefined,
    onClick: () => setActiveKey(item.key),
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setActiveKey(item.key);
      }
    }
  });

  return (
    <>
      {children({
        activeKey,
        isActive,
        setActiveKey,
        getTabProps
      })}
    </>
  );
}
