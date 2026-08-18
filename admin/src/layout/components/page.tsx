'use client';

import { Breadcrumb } from 'antd';
import { BreadcrumbItemType } from 'antd/lib/breadcrumb/Breadcrumb';
import classnames from 'classnames';
import Link from 'next/link';
import { ReactNode } from 'react';

import Loader from './loader';
import s from './page.module.scss';

interface IPageProps {
  loading?: boolean;
  className?: string;
  inner?: boolean;
  children: any;
  title?: string;
  extra?: ReactNode;
  breadcrumbs?: BreadcrumbItemType[];
}

const breadcrumbItemRender = (route: BreadcrumbItemType) =>
  route.href ? (
    <Link key={route.key} href={route.href as string}>
      {route.title}
    </Link>
  ) : (
    <span key={route.key}>{route.title}</span>
  );

export default function Page({
  className = '',
  children,
  breadcrumbs = [],
  loading = false,
  inner = true,
  title = '',
  extra = undefined
}: IPageProps) {
  const loadingStyle = {
    height: 'calc(100vh - 184px)',
    overflow: 'hidden'
  };

  return (
    <div
      className={classnames(s.page, className, {
        contentInner: inner,
        loading
      })}
      style={loading ? loadingStyle : undefined}
    >
      {loading ? <Loader spinning /> : null}

      {breadcrumbs.length > 0 && (
        <Breadcrumb
          className={s.breadcrumb}
          items={breadcrumbs}
          itemRender={breadcrumbItemRender}
        />
      )}

      {title ? (
        <div className={classnames(s.head, 'd-flex')}>
          <h1 className={s.title}>{title}</h1>
          {extra ? (
            <div className={classnames(s.rightHead, 'm-auto')}>
              {extra}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={s.content}>
        {children}
      </div>
    </div>
  );
}
