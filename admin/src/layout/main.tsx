'use client';

import { CloseOutlined } from '@ant-design/icons';
import {
  Affix
} from 'antd';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { useProfile } from 'src/context/profile.context';

import { useMainThemeLayout } from '../context/main-layout.context';
import { Loader } from './components';
import Header from './header/header';
import style from './main.module.scss';
import Sidenav from './sidenav/sidenav';

const Footer = dynamic(() => import('src/layout/footer'), { ssr: false });

function Main({ children }: any) {
  const { fetching } = useProfile();

  const {
    fixed,
    onProgress,
    setOnProgress
  } = useMainThemeLayout();

  let pathname = usePathname();
  pathname = pathname?.replace('/', '') || '';

  const [collapsed, setCollapsed] = useState(false);
  const [menuMobile, setMenuMobile] = useState(false);
  const [, startTransition] = useTransition();

  const toggleCollapsed = () => {
    startTransition(() => {
      setCollapsed((current) => !current);
    });
  };

  const showMenuMobile = () => {
    setMenuMobile((current) => !current);
  };

  useEffect(() => {
    setOnProgress(fetching);
  }, [setOnProgress, fetching]);

  const closeMenu = () => {
    setMenuMobile(false);
  };

  return (
    <div
      className={style['layout-dashboard']}
    >
      <Loader fullScreen spinning={onProgress} />
      <div className={`${style['menu-mobile']}  ${menuMobile ? style['show'] : ''}`}>
        <button
          type="button"
          className={style['close-mobile']}
          onClick={closeMenu}
          aria-label="Close navigation menu"
          title="Close navigation menu"
        >
          <CloseOutlined />
        </button>
        <Sidenav collapsed={collapsed} />
      </div>
      <div className={`${style['layout-dashboard-right']} ${!collapsed ? style.collapsed : ''}`}>
        {fixed ? (
          <Affix>
            <div className={style['layout-dashboard-header']}>
              {/* <Button type="primary" onClick={toggleCollapsed} style={{ marginBottom: 16 }}>
                {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              </Button> */}
              <Header
                toggleCollapsed={toggleCollapsed}
                collapsed={collapsed}
                name={pathname}
                subName={pathname}
                showMenuMobile={showMenuMobile}
              />
            </div>
          </Affix>
        ) : (
          <div className={style['layout-dashboard-header']}>
            {/* <Button type="primary" onClick={toggleCollapsed} style={{ marginBottom: 16 }}>
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </Button> */}
            <Header
              toggleCollapsed={toggleCollapsed}
              showMenuMobile={showMenuMobile}
              collapsed={collapsed}
              name={pathname}
              subName={pathname}
            />
          </div>
        )}
        <div className={style['layout-dashboard-content']}>
          {children}
        </div>
        <Footer />
      </div>
    </div>
  );
}

export default Main;
