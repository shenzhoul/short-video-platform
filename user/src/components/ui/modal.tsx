'use client';

import {
  CSSProperties, ReactNode, RefObject, useEffect, useRef, useState
} from 'react';
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
  /**
   * Accessible name for the dialog, for callers that render their own heading
   * instead of passing `title`.
   */
  ariaLabel?: string;
  /**
   * What to focus when the dialog opens, for callers where the first focusable
   * element is not the useful one — a form whose first field should receive the
   * caret rather than the close button.
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Extra classes for the close button, for a dialog sized for a compact viewport. */
  closeButtonClassName?: string;
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
  noPadding,
  ariaLabel,
  initialFocusRef,
  closeButtonClassName = ''
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  /** Whatever had focus before this opened, so it can be handed back. */
  const restoreFocusRef = useRef<HTMLElement | null>(null);

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

  /**
   * Keyboard behaviour: Escape closes, Tab stays inside.
   *
   * Bound to `document`, not `window`, and it stops propagation. That ordering
   * is load-bearing: Post Detail listens for Escape on `window`, and document
   * handlers run first — so without this, pressing Escape in a dialog opened
   * over Post Detail closed the *post* and left the dialog behind.
   */
  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    // No `offsetParent` visibility check: it is null for everything in jsdom,
    // and unreliable inside a `position: fixed` panel, so it would silently
    // empty this list and disable the trap. The selector already excludes what
    // cannot take focus.
    const focusable = () => Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []
    ).filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');

    // Focus moves into the dialog so a keyboard user is not left behind it.
    // A caller may name the element it wants focused; otherwise the first
    // focusable one gets it, which is usually the close button.
    const timer = setTimeout(() => {
      const [first] = focusable();
      (initialFocusRef?.current || first || panelRef.current)?.focus?.();
    }, 20);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        setIsVisible(false);
        setTimeout(() => onCancel?.(), 200);
        return;
      }

      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement;

      // Wrap at both ends, which is what keeps focus in the dialog rather than
      // wandering into the page behind it.
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      // Handed back to whatever opened this, so the reader does not lose their
      // place in the page.
      restoreFocusRef.current?.focus?.();
    };
    // `initialFocusRef` is a ref object and stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onCancel]);

  if (!open) return null;

  /**
   * Whether the caller paints its own panel.
   *
   * The panel carried no background of its own, so a caller that did not supply
   * one got a transparent dialog floating over the dimmed backdrop — readable
   * only by accident, and unreadable over video. The default below fixes that,
   * while a caller with its own `bg-` keeps full control rather than fighting a
   * class of equal specificity.
   */
  const hasOwnSurface = /(^|\s)bg-/.test(className);

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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={`rounded-lg shadow-lg relative flex flex-col transform transition-all max-w-[95%] duration-300 outline-none ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
          } ${hasOwnSurface ? '' : 'border border-(--border-soft) bg-(--surface-raised) text-(--text-strong)'} ${className}`}
        style={{
          width,
          ...style
        }}
      >
        {closable ? (
          <button
            type="button"
            className={`absolute top-2 right-2 cursor-pointer hover:opacity-70 focus:outline-hidden w-[30px] h-[30px] rounded-full z-10 flex justify-center items-center ${closeButtonClassName}`}
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
