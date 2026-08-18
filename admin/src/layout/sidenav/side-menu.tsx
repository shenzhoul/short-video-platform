'use client';

import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import styles from './sidenav.module.scss';

type MenuItem = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  children?: MenuItem[];
};

type IProps = {
  menus: MenuItem[];
  collapsed?: boolean;
  selectedKey?: string;
};

const SubMenuPortal = ({
  children,
  parentRef,
  visible,
  onClose,
  collapsed
}: {
  children: ReactNode;
  parentRef: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  onClose: () => void;
  collapsed: boolean;
}) => {
  const portalRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (parentRef.current && visible) {
      const rect = parentRef.current.getBoundingClientRect();
      setPosition({
        top: rect.top + window.scrollY,
        left: rect.right + window.scrollX
      });
    }
  }, [visible, collapsed, parentRef]);

  /** CLICK OUTSIDE */
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      const portalEl = portalRef.current;
      const parentEl = parentRef.current;

      if (!portalEl) return;

      if (
        !portalEl.contains(e.target as Node) &&
        (!parentEl || !parentEl.contains(e.target as Node))
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [visible, parentRef, onClose]);

  if (!visible) return null;

  return createPortal(
    <div
      ref={portalRef}
      className={styles.collapsedSubMenuPortal}
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        zIndex: 9999
      }}
    >
      {children}
    </div>,
    document.body
  );
};

export default function SiderMenu({
  menus,
  collapsed = false,
  selectedKey = ''
}: IProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const parent = menus.find((item) =>
      item.children?.some((sub) => sub.key === selectedKey)
    );
    if (parent) setOpenKey(parent.key);
    // menus intentionally omitted: it's memoized in parent, and we only
    // want to reset the open panel when the active route actually changes.

  }, [selectedKey]);

  const handleOpen = (key: string) => {
    setOpenKey((prev) => (prev === key ? null : key));
  };

  useEffect(() => {
    if (collapsed) {
      setOpenKey(null);
    }
  }, [collapsed]);

  const renderSubMenu = (item: MenuItem) => {
    return item.children?.map((sub) => {
      const isSubSelected = selectedKey === sub.key;
      return (
        <div
          key={sub.key}
          className={`${styles.subMenuItem} ${isSubSelected ? styles.active : ''
            }`}
        >
          {sub.label}
        </div>
      );
    });
  };

  return (
    <div className={`${styles.siderMenu} ${collapsed ? styles.collapsed : ''}`}>
      {menus.map((item) => {
        const isOpen = openKey === item.key;
        const hasActiveChild = item.children?.some(
          (sub) => sub.key === selectedKey
        );
        const isSelected = selectedKey === item.key || hasActiveChild;

        return (
          <div
            key={item.key}
            className={styles.menuItem}
            ref={(el) => {
              itemRefs.current[item.key] = el;
            }}
          >
            <div
              className={`${styles.menuTitle}
                ${isSelected ? styles.active : ''}
                ${item.children && isOpen ? styles.submenuActive : ''}`}
              onClick={() => (item.children ? handleOpen(item.key) : null)}
            >
              {item.icon ? <span className={styles.icon}>{item.icon}</span> : null}
              <span className={styles.label}>{item.label}</span>

              {item.children && !collapsed ? (
                <span className={styles.arrow}>
                  {isOpen ? <UpOutlined /> : <DownOutlined />}
                </span>
              ) : null}
            </div>

            {!collapsed && item.children && isOpen ? <div className={styles.subMenu}>{renderSubMenu(item)}</div> : null}

            {collapsed && item.children && isOpen ? (
              <SubMenuPortal
                parentRef={{
                  current: itemRefs.current[item.key] || null
                }}
                visible={isOpen}
                onClose={() => setOpenKey(null)}
                collapsed={collapsed}
              >
                {renderSubMenu(item)}
              </SubMenuPortal>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
