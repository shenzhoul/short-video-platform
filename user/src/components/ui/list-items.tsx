'use client';

import { formatDate } from '@lib/date';
import Link from 'next/link';
import { FC, JSX, ReactNode } from 'react';
import { FiEdit, FiMoreHorizontal, FiTrash2 } from 'react-icons/fi';

import Dropdown from './dropdown-menu';

interface ActionItem {
  type?: 'edit' | 'delete' | 'custom';
  href?: string;
  onClick?: (id: string) => void;
  icon?: ReactNode;
  title?: string;
  className?: string;
}

interface PostListItemProps {
  _id: string;
  text?: string;
  thumbnailUrl?: ReactNode;
  children?: ReactNode;
  totalComment?: number;
  status?: ReactNode;
  updatedAt?: string | Date;
  noThumbnail?: boolean;
  actions?: ActionItem[];
  actionDisplay?: 'dropdown' | 'inline';
  href?: string;
  onClick?: (id: string) => void;
}

const Wrapper: FC<{
  _id: string;
  href?: string;
  onClick?: (id: string) => void;
  children: ReactNode;
}> = ({ _id, href, onClick, children }) => {
  if (href)
    return (
      <Link
        href={href.replace(':id', _id)}
        className="block hover:bg-gray-50 transition-colors"
        prefetch={false}
      >
        {children}
      </Link>
    );

  if (onClick)
    return (
      <div
        onClick={() => onClick(_id)}
        className="cursor-pointer hover:bg-gray-50 transition-colors"
      >
        {children}
      </div>
    );

  return children as JSX.Element;
};

const PostListItem: React.FC<PostListItemProps> = ({
  _id,
  text,
  thumbnailUrl,
  noThumbnail,
  children,
  status,
  updatedAt,
  actions,
  actionDisplay = 'dropdown',
  href,
  onClick
}) => {
  const renderIcon = (action: ActionItem) => {
    if (action.icon) return action.icon;
    if (action.type === 'edit') return <FiEdit size={16} />;
    if (action.type === 'delete') return <FiTrash2 size={16} />;
    return null;
  };

  return (
    <Wrapper _id={_id} href={href} onClick={onClick}>
      <div className="flex items-start rounded-lg p-3 shadow-sm border border-border relative">
        {/* Thumbnail */}
        {!noThumbnail &&
          (typeof thumbnailUrl === 'string' ? (
            <img
              src={thumbnailUrl}
              alt={text}
              className="w-16 h-16 rounded-md object-cover mr-3 shrink-0"
            />
          ) : (
            thumbnailUrl || (
              <div className="w-16 h-16 rounded-md bg-surface-muted mr-3 flex items-center justify-center text-sm">
                No Img
              </div>
            )
          ))}

        <div className="flex-1 min-w-0">
          <div className="flex justify-between">
            <div className="font-bold text-md truncate text-primary">{text}</div>
            {status}
          </div>

          <div className="text-xs mt-1">{updatedAt ? formatDate(updatedAt) : ''}</div>

          {children ? (
            <div className="mt-1">
              <span className="text-xs">{children}</span>
            </div>
          ) : null}
        </div>

        {actions?.length ? (
          <div className="ml-3">
            {actionDisplay === 'inline' ? (
              <div className="flex items-center gap-2">
                {actions.map((action, index) => {
                  const label =
                    action.title ||
                    (action.type === 'edit'
                      ? 'Edit'
                      : action.type === 'delete'
                        ? 'Delete'
                        : 'Action');
                  const icon = action.icon || renderIcon(action);

                  if (action.href) {
                    return (
                      <Link
                        key={`${label}-${index}`}
                        href={action.href.replace(':id', _id)}
                        className={`inline-flex items-center justify-center rounded-full p-1.5 text-primary opacity-80 transition hover:opacity-100 ${action.className || ''}`}
                        aria-label={label}
                        title={label}
                        prefetch={false}
                      >
                        {icon}
                      </Link>
                    );
                  }

                  return (
                    <button
                      key={`${label}-${index}`}
                      type="button"
                      onClick={() => action.onClick?.(_id)}
                      className={`inline-flex items-center justify-center rounded-full p-1.5 text-primary opacity-80 transition hover:opacity-100 ${action.className || ''}`}
                      aria-label={label}
                      title={label}
                    >
                      {icon}
                    </button>
                  );
                })}
              </div>
            ) : (
              <Dropdown
                trigger={
                  <FiMoreHorizontal className="text-xl cursor-pointer opacity-60 hover:text-black" />
                }
                position="right"
                width={200}
                data={actions.map((action) => ({
                  label:
                    action.title ||
                    (action.type === 'edit'
                      ? 'Edit'
                      : action.type === 'delete'
                        ? 'Delete'
                        : 'Action'),
                  value: action.type || action.title || 'action',
                  icon: action.icon || renderIcon(action),
                  onClick: () => {
                    if (action.href) {
                      window.location.href = action.href.replace(':id', _id);
                    } else if (action.onClick) {
                      action.onClick(_id);
                    }
                  }
                }))}
              />
            )}
          </div>
        ) : null}
      </div>
    </Wrapper>
  );
};

export default PostListItem;
