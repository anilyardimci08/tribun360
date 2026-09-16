/* Share concurrent API reads across the existing views. Cache successful JSON only. */
(() => {
  const original = window.fetch.bind(window), cache = new Map(), pending = new Map();
  const canonical = input => {
    const u = new URL(input, location.href); u.searchParams.delete('_'); u.searchParams.sort(); return u.href;
  };
  window.t360ClearRequestCache = () => cache.clear();
  window.fetch = function(input, init = {}) {
    if (typeof input !== 'string' || init.signal || (init.method || 'GET').toUpperCase() !== 'GET') return original(input, init);
    const u = new URL(input, location.href);
    if (u.origin !== location.origin || !u.pathname.startsWith('/api/')) return original(input, init);
    const k = canonical(input), hit = cache.get(k);
    if (hit && Date.now() - hit.at < 10000) return Promise.resolve(hit.response.clone());
    if (!pending.has(k)) {
      const task = original(input, init).then(response => {
        if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
          cache.set(k, {response: response.clone(), at: Date.now()});
          if (cache.size > 40) cache.delete(cache.keys().next().value);
        }
        return response;
      }).finally(() => pending.delete(k));
      pending.set(k, task);
    }
    return pending.get(k).then(response => response.clone());
  };
})();
