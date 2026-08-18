'use client';

import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import Button from './button';

export interface ModalProps {
  open: boolean;
  onOk?: () => void;
  onCancel?: () => void;
  title?: ReactNode;
  footer?: ReactNode | null;
  okText?: string;
  cancelText?: string;
  closable?: boolean;
  centered?: boolean;
  width?: number | string;
  className?: string;
  style?: CSSProperties;
  maskClosable?: boolean;
  children?: ReactNode;
  noPadding?: boolean;
}

function ModalComponent({
  open,
  onOk,
  onCancel,
  title,
  footer,
  okText = 'OK',
  cancelText = 'Cancel',
  closable = true,
  centered = true,
  width = 416,
  className = '',
  style = {},
  maskClosable = true,
  children,
  noPadding
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      setTimeout(() => setIsVisible(true), 10);
    } else {
      setIsVisible(false);
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const handleMaskClick = (e: MouseEvent) => {
    if (maskClosable && e.target === modalRef.current && onCancel) {
      setIsVisible(false);
      setTimeout(() => onCancel?.(), 200);
    }
  };

  const modalContent = (
    <div
      ref={modalRef}
      className={`fixed inset-0 z-1000 flex justify-center transition-opacity duration-200 ${centered ? 'items-center' : 'items-end'
        } ${isVisible ? 'bg-black/50 opacity-100' : 'bg-black/0 opacity-0'}`}
      onClick={(e) => handleMaskClick(e as unknown as MouseEvent)}
    >
      <div
        className={`rounded-lg shadow-lg relative flex flex-col transform transition-all max-w-[95%] duration-300 ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
          } ${className}`}
        style={{
          width,
          ...style
        }}
      >
        {closable ? (
          <button
            type="button"
            className="absolute top-2 right-2 cursor-pointer hover:opacity-70 focus:outline-hidden w-[30px] h-[30px] rounded-full z-10 flex justify-center items-center"
            onClick={() => {
              setIsVisible(false);
              setTimeout(() => onCancel?.(), 200);
            }}
            aria-label="Close"
          >
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : null}

        {title ? <div className="px-6 py-2.5 text-lg font-semibold border-b border-border">{title}</div> : null}
        <div
          className={`${noPadding ? 'p-0' : 'px-6 py-4'
            } max-h-[calc(90dvh-80px)] overflow-y-auto`}
        >
          {children}
        </div>
        {footer === false ? null : footer ? (
          <div className="flex justify-end gap-2 px-6 py-2.5 pt-2 border-t border-border">
            {footer}
          </div>
        ) : (
          <div className="flex justify-end gap-2 px-6 py-2.5 pt-2 border-t border-border">
            <Button
              variant="grey-light"
              onClick={() => {
                setIsVisible(false);
                setTimeout(() => onCancel?.(), 200);
              }}
            >
              {cancelText}
            </Button>
            <Button onClick={onOk}>
              {okText}
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof window === 'undefined') return null;

  return createPortal(modalContent, document.body);
}

export default ModalComponent;
