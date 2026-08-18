/**
 * Device Detection Utilities
 *
 * Provides utility functions for detecting device capabilities and characteristics.
 */

/**
 * Detects if the current device is a mobile device
 *
 * @returns {boolean} True if the device is mobile, false otherwise
 *
 * @example
 * ```typescript
 * const mobile = isMobileDevice();
 * if (mobile) {
 *   // Show mobile-specific UI
 * }
 * ```
 */
export function isMobileDevice(): boolean {
  // Check if we're in a browser environment
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  // Use userAgent for detection (vendor property is deprecated)
  const userAgent = navigator.userAgent.toLowerCase();

  // Check for mobile device patterns
  const mobilePatterns = [
    /android/i,
    /webos/i,
    /iphone/i,
    /ipad/i,
    /ipod/i,
    /blackberry/i,
    /iemobile/i,
    /opera mini/i,
    /mobile/i
  ];

  const isMobile = mobilePatterns.some(pattern => pattern.test(userAgent));

  // If user agent indicates mobile, return true immediately
  // This ensures devices like iPhone 16 Pro Max are detected as mobile
  // regardless of screen size
  if (isMobile) {
    return true;
  }

  // Additional check using matchMedia API for edge cases
  if (window.matchMedia) {
    // Use pointer:coarse to detect touch-primary devices
    const touchScreen = window.matchMedia('(pointer: coarse)').matches;

    // Only use screen size as a fallback with touch detection
    // Don't rely solely on screen width to avoid misidentifying
    // large phones like iPhone 16 Pro Max as desktop
    if (touchScreen) {
      return true;
    }
  }

  return false;
}

/**
 * Detects if the device supports touch input
 *
 * @returns {boolean} True if the device supports touch, false otherwise
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    (navigator as any).msMaxTouchPoints > 0
  );
}

/**
 * Detects if the device is running iOS (iPhone, iPad, iPod)
 *
 * @returns {boolean} True if the device is iOS, false otherwise
 *
 * @example
 * ```typescript
 * const ios = isIOS();
 * if (ios) {
 *   // Use front camera for streaming
 * }
 * ```
 */
export function isIOS(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent.toLowerCase();

  // Check for iOS patterns
  return /iphone|ipad|ipod/.test(userAgent);
}

/**
 * Gets the device type based on screen size and user agent
 *
 * @returns {'mobile' | 'tablet' | 'desktop'} The detected device type
 */
export function getDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  if (typeof window === 'undefined') {
    return 'desktop';
  }

  const width = window.innerWidth;
  const userAgent = navigator.userAgent.toLowerCase();

  // Check for tablet patterns
  const isTablet = /ipad|android(?!.*mobile)|tablet/i.test(userAgent);

  if (isTablet || (width >= 768 && width < 1024 && isTouchDevice())) {
    return 'tablet';
  }

  if (isMobileDevice() || width < 768) {
    return 'mobile';
  }

  return 'desktop';
}
