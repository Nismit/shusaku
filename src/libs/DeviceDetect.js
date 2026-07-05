/**
 * DeviceDetect - Helper for classifying the current device as mobile, tablet, or desktop
 *
 * Usage example:
 * ```javascript
 * import { getDeviceType, isMobile, isTablet, isDesktop } from '../libs/DeviceDetect.js';
 *
 * if (isMobile()) {
 *   // lower quality settings for phones
 * }
 *
 * console.log(getDeviceType()); // 'mobile' | 'tablet' | 'desktop'
 * ```
 */

const ua = navigator.userAgent;
const touchPoints = navigator.maxTouchPoints || 0;

// iPadOS 13+ reports "Macintosh" in the UA string but exposes multi-touch
const isIPadOS = /Macintosh/.test(ua) && touchPoints > 1;

const IS_TABLET = /iPad/.test(ua) || isIPadOS || (/Android/.test(ua) && !/Mobile/.test(ua));
const IS_MOBILE = !IS_TABLET && /Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
const IS_DESKTOP = !IS_MOBILE && !IS_TABLET;

/**
 * @returns {'mobile' | 'tablet' | 'desktop'}
 */
export function getDeviceType() {
  if (IS_MOBILE) return 'mobile';
  if (IS_TABLET) return 'tablet';
  return 'desktop';
}

export function isMobile() {
  return IS_MOBILE;
}

export function isTablet() {
  return IS_TABLET;
}

export function isDesktop() {
  return IS_DESKTOP;
}
