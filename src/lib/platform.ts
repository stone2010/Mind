export function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

/** Android build: local MCP processes and desktop window chrome are unavailable. */
export function isMobilePlatform(): boolean {
  return isAndroid();
}
