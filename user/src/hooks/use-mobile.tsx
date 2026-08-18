'use client';

import { isMobileDevice } from '@utils/device';
import { useEffect, useState } from 'react';

/**
 * useIsMobile hook
 *
 * Detects if the current viewport width is considered mobile (< 1024px by default).
 * Automatically updates on window resize.
 *
 * @param breakpoint - The max width (in px) for mobile. Default is 1024.
 * @param useDeviceDetection - If true, uses user agent detection instead of screen width (recommended for camera/media features)
 * @returns boolean - true if current screen width is below breakpoint or device is mobile.
 */
export function useIsMobile(breakpoint = 1024, useDeviceDetection = false) {
  // default: assume desktop
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false; // SSR fallback
    }

    if (useDeviceDetection) {
      return isMobileDevice();
    }

    return window.innerWidth < breakpoint;
  });

  useEffect(() => {
    if (useDeviceDetection) {
      // Device detection doesn't change on resize
      setIsMobile(isMobileDevice());
      return;
    }

    const handleResize = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint, useDeviceDetection]);

  return isMobile;
}
