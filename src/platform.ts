// Mobile preview capabilities are explicit so desktop-only actions stay honest.
export const androidPreview = typeof navigator !== 'undefined' && /\bAndroid\b/i.test(navigator.userAgent);
