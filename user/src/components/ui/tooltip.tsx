'use client';

import {
  FC,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';

type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  title: ReactNode;
  children: ReactElement;
  placement?: TooltipPlacement;
  className?: string;
  width?: string;
  wrap?: boolean;
}

interface TooltipPosition {
  top: number;
  left: number;
  arrowOffset: number;
}

const TOOLTIP_GAP = 8;
const VIEWPORT_PADDING = 10;
const ARROW_EDGE_PADDING = 10;

const clamp = (value: number, min: number, max: number) => (
  Math.min(Math.max(value, min), max)
);

const getArrowClasses = (placement: TooltipPlacement) => {
  switch (placement) {
    case 'bottom':
      return 'bottom-full -translate-x-1/2 border-x-[6px] border-b-[6px] border-x-transparent border-b-[#3b3b48]';
    case 'left':
      return 'left-full -translate-y-1/2 border-y-[6px] border-l-[6px] border-y-transparent border-l-[#3b3b48]';
    case 'right':
      return 'right-full -translate-y-1/2 border-y-[6px] border-r-[6px] border-y-transparent border-r-[#3b3b48]';
    case 'top':
    default:
      return 'top-full -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent border-t-[#3b3b48]';
  }
};

export const Tooltip: FC<TooltipProps> = ({
  title,
  children,
  placement = 'top',
  className = '',
  width = '',
  wrap = false
}) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showTooltip = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(true);
  };

  const hideTooltip = () => {
    timeoutRef.current = setTimeout(() => {
      setVisible(false);
      setPosition(null);
    }, 100);
  };

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    let top = 0;
    let left = 0;

    switch (placement) {
      case 'bottom':
        top = triggerRect.bottom + TOOLTIP_GAP;
        left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'left':
        top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.left - tooltipRect.width - TOOLTIP_GAP;
        break;
      case 'right':
        top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.right + TOOLTIP_GAP;
        break;
      case 'top':
      default:
        top = triggerRect.top - tooltipRect.height - TOOLTIP_GAP;
        left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        break;
    }

    top = clamp(
      top,
      VIEWPORT_PADDING,
      window.innerHeight - tooltipRect.height - VIEWPORT_PADDING
    );
    left = clamp(
      left,
      VIEWPORT_PADDING,
      window.innerWidth - tooltipRect.width - VIEWPORT_PADDING
    );

    const isVerticalPlacement = placement === 'top' || placement === 'bottom';
    const arrowOffset = isVerticalPlacement
      ? clamp(
        triggerRect.left + triggerRect.width / 2 - left,
        ARROW_EDGE_PADDING,
        tooltipRect.width - ARROW_EDGE_PADDING
      )
      : clamp(
        triggerRect.top + triggerRect.height / 2 - top,
        ARROW_EDGE_PADDING,
        tooltipRect.height - ARROW_EDGE_PADDING
      );

    setPosition({ top, left, arrowOffset });
  }, [placement]);

  useLayoutEffect(() => {
    if (!visible) return undefined;

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, {
      capture: true,
      passive: true
    });

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [updatePosition, visible]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const isVerticalPlacement = placement === 'top' || placement === 'bottom';

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex align-middle"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      {visible && typeof document !== 'undefined' ? createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          className={`${width} ${className} fixed z-1000 max-w-[calc(100vw-20px)] rounded bg-[#3b3b48] px-2 py-1 text-xs text-white shadow-lg ${wrap ? 'whitespace-normal' : 'whitespace-nowrap'}`}
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            visibility: position ? 'visible' : 'hidden'
          }}
          onMouseEnter={showTooltip}
          onMouseLeave={hideTooltip}
        >
          {title}
          <span
            aria-hidden="true"
            className={`absolute h-0 w-0 ${getArrowClasses(placement)}`}
            style={
              isVerticalPlacement
                ? { left: position?.arrowOffset ?? '50%' }
                : { top: position?.arrowOffset ?? '50%' }
            }
          />
        </div>,
        document.body
      ) : null}
    </div>
  );
};
