import { useState, useCallback, useEffect } from 'react';

export function useSearchParams() {
  const [params, setParamsState] = useState(() => new URLSearchParams(window.location.search));

  useEffect(() => {
    const onPop = () => setParamsState(new URLSearchParams(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const get = useCallback((key: string) => params.get(key) || '', [params]);

  const update = useCallback((updates: Record<string, string | undefined>, resetPage = true) => {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.delete('page');

    const qs = next.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.pushState(null, '', url);
    setParamsState(next);
  }, []);

  const clear = useCallback(() => {
    window.history.pushState(null, '', window.location.pathname);
    setParamsState(new URLSearchParams());
  }, []);

  return { get, update, clear, params };
}
