// Every page address carries the session's key: /<key>/dashboard, /<key>/tickets/12. The key comes from the server,
// is unique to each sign-in, and stops working when the person signs out. Links without it (or with an old one) are
// moved onto the current key, so email links and bookmarks still work.
const KEY = /^\/([a-f0-9]{32})(?=\/|$)/;

const match = window.location.pathname.match(KEY);
export const urlKeyInPath = match ? match[1] : null;
// The router's base path: everything inside the app is relative to it.
export const basename = urlKeyInPath ? `/${urlKeyInPath}` : undefined;

// A path without any key at the front, e.g. "/<key>/tickets?view=open" -> "/tickets?view=open".
export const stripKey = (path: string) => path.replace(KEY, '') || '/';

// The current page's path and query, without the key.
export const currentPath = () => stripKey(window.location.pathname) + window.location.search;

// Reloads the portal at the same page under the given key.
export function moveToKey(key: string, path = currentPath()) {
  const target = path.startsWith('/login') ? new URLSearchParams(path.split('?')[1] || '').get('next') || '/' : path;
  window.location.replace(`/${key}${stripKey(target.startsWith('/') && !target.startsWith('//') ? target : '/')}`);
}
