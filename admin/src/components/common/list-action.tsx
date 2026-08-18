'use client';

import { Modal } from 'antd';
import Link from 'next/link';

import style from './actions.module.scss'

interface IMenuOption {
  key: string;
  label?: any;
  icon?: any;
  href?: any;
  onClick?: () => void;
  danger?: boolean;
  visible?: boolean;
  confirm?: {
    title: string;
    content?: string;
    okText?: string;
    cancelText?: string;
  };
}

type IProps = {
  menuOptions?: IMenuOption[];
};

export function MenuAction({ menuOptions = [] }: IProps) {

  const handleAction = (menu: IMenuOption) => {
    if (menu.confirm) {
      Modal.confirm({
        title: menu.confirm.title,
        content: menu.confirm.content,
        okText: menu.confirm.okText || 'OK',
        cancelText: menu.confirm.cancelText || 'Cancel',
        onOk: () => menu.onClick && menu.onClick()
      });
      return;
    }

    menu.onClick && menu.onClick();
  };

  const renderLabel = (menu: IMenuOption) => {
    if (menu.href) {
      return (
        <Link href={menu.href} className="flex items-center gap-2" prefetch={false}>
          {menu.icon}
          <span className={style['label-action']}>{menu.label}</span>
        </Link>
      );
    }

    return (
      <button
        type="button"
        onClick={() => handleAction(menu)}
        className="flex items-center gap-2"
      >
        {menu.icon}
        <span className={style['label-action']}>{menu.label}</span>
      </button>
    );
  };

  return (
    <div className={style['menu-action']}>
      {menuOptions
        .filter(menu => menu.visible !== false)
        .map((menu) => (
          <div key={menu.key} className={style['item-action']} data-danger={menu.danger}>
            {renderLabel(menu)}
          </div>
        ))}
    </div>
  );
}

export default MenuAction;
