'use client';

import type { ReactNode } from 'react';

interface HoverRevealPanelProps {
  children: ReactNode;
  panel: ReactNode;
  className?: string;
  panelClassName?: string;
  panelPositionClassName?: string;
  disabled?: boolean;
  revealOnFocus?: boolean;
}

export default function HoverRevealPanel({
  children,
  panel,
  className = '',
  panelClassName = '',
  panelPositionClassName = 'left-0 top-full mt-2',
  disabled = false,
  revealOnFocus = false
}: HoverRevealPanelProps) {
  const focusRevealClassName = revealOnFocus
    ? 'group-focus-within/hover-reveal:pointer-events-auto group-focus-within/hover-reveal:visible group-focus-within/hover-reveal:opacity-100'
    : '';

  return (
    <div className={`group/hover-reveal relative ${className}`}>
      {children}
      {!disabled ? (
        <div
          className={`pointer-events-none invisible absolute z-50 opacity-0 transition duration-150 group-hover/hover-reveal:pointer-events-auto group-hover/hover-reveal:visible group-hover/hover-reveal:opacity-100 ${focusRevealClassName} ${panelPositionClassName} ${panelClassName}`}
        >
          {panel}
        </div>
      ) : null}
    </div>
  );
}
