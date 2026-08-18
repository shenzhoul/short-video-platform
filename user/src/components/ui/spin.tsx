/**
 * Spin Component
 *
 * A loading spinner component that can be used as standalone indicator or overlay.
 * Supports different sizes, custom indicators, delay timing, and tip messages.
 * Can wrap children content to show loading overlay.
 *
 * @example
 * // Standalone spinner
 * <Spin spinning={isLoading} size="large" tip="Loading..." />
 *
 * // Overlay on content
 * <Spin spinning={isLoading} tip="Fetching data...">
 *   <div className="content">
 *     <p>This content will be overlaid when loading</p>
 *   </div>
 * </Spin>
 *
 * // With delay to prevent flash
 * <Spin
 *   spinning={isLoading}
 *   delay={200}
 *   tip="Please wait..."
 * >
 *   <UserProfile />
 * </Spin>
 *
 * // Custom indicator
 * <Spin
 *   spinning={true}
 *   indicator={<div className="custom-spinner">Loading...</div>}
 * />
 */

'use client';

import { ReactNode, useEffect, useState } from 'react';

export interface SpinProps {
  /** Whether Spin is spinning */
  spinning?: boolean;
  /** Size of Spin */
  size?: 'small' | 'default' | 'large';
  /** Customize description content when Spin has children */
  tip?: string;
  /** Specifies a delay in milliseconds for loading state (prevent flush) */
  delay?: number;
  /** React node to render as the loading indicator */
  indicator?: ReactNode;
  /** Additional CSS class */
  className?: string;
  /** Inline style */
  style?: React.CSSProperties;
  /** Children content */
  children?: ReactNode;
}

const defaultIndicator = (size: 'small' | 'default' | 'large') => {
  const sizeClasses = {
    small: 'w-4 h-4',
    default: 'w-6 h-6',
    large: 'w-8 h-8'
  };

  return (
    <div className={`${sizeClasses[size]} animate-spin`}>
      <svg
        className="w-full h-full text-blue-600"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </div>
  );
};

const Spin: React.FC<SpinProps> = ({
  spinning = true,
  size = 'default',
  tip,
  delay = 0,
  indicator,
  className = '',
  style,
  children
}) => {
  const [showSpin, setShowSpin] = useState(delay === 0 ? spinning : false);

  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (spinning && delay > 0) {
      timer = setTimeout(() => {
        setShowSpin(true);
      }, delay);
    } else {
      setShowSpin(spinning);
    }

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [spinning, delay]);

  const spinElement = (
    <div className="flex flex-col items-center justify-center">
      {indicator || defaultIndicator(size)}
      {tip ? (
        <div className="mt-2 text-sm opacity-60 text-center">
          {tip}
        </div>
      ) : null}
    </div>
  );

  // If no children, render just the spinner
  if (!children) {
    return showSpin ? (
      <div className={`inline-block ${className}`} style={style}>
        {spinElement}
      </div>
    ) : null;
  }

  // If has children, render as overlay
  return (
    <div className={`relative ${className}`} style={style}>
      {children}
      {showSpin ? (
        <div className="absolute inset-0 flex items-center justify-center bg-surface bg-opacity-60 z-10">
          {spinElement}
        </div>
      ) : null}
    </div>
  );
};

export default Spin;
