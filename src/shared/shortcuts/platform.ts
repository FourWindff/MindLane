export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ||
    /Mac OS X/i.test(navigator.userAgent)
}
