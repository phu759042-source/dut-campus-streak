// Minimal History API router.
import { html, useState, useEffect } from 'preact';

const listeners = new Set();
let navState = {};
let depth = 0; // in-app history depth, so "back" never leaves the site

export function navigate(path, { replace = false, state = {} } = {}) {
  navState = state;
  if (replace) history.replaceState({ depth }, '', path);
  else history.pushState({ depth: ++depth }, '', path);
  listeners.forEach((fn) => fn());
  window.scrollTo(0, 0);
}

/** State passed with navigate() (e.g. the class object). Lost on reload. */
export function routeState() {
  return navState;
}

export function back(fallback = '/') {
  if (depth > 0) history.back();
  else navigate(fallback, { replace: true });
}

window.addEventListener('popstate', (e) => {
  depth = e.state?.depth ?? 0;
  navState = {};
  listeners.forEach((fn) => fn());
});

export function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const fn = () => setPath(location.pathname);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return path;
}

/** Match "/class/:id" against a path. Returns params or null. */
export function match(pattern, path) {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function Link({ href, children, ...rest }) {
  const onClick = (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(href);
  };
  return html`<a href=${href} onClick=${onClick} ...${rest}>${children}</a>`;
}
