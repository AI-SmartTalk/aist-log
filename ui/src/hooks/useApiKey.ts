import { useState, useCallback } from 'react';

const STORAGE_KEY = 'aist-log-api-key';
const SOURCE_KEY = 'aist-log-source';

export function useApiKey() {
  const [apiKey, setApiKeyState] = useState(() => localStorage.getItem(STORAGE_KEY) || '');

  const setApiKey = useCallback((key: string) => {
    localStorage.setItem(STORAGE_KEY, key);
    setApiKeyState(key);
  }, []);

  const clearApiKey = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setApiKeyState('');
  }, []);

  const headers = apiKey ? { 'X-API-Key': apiKey } : {};

  return { apiKey, setApiKey, clearApiKey, headers };
}

export function useSource() {
  const [source, setSourceState] = useState(() => localStorage.getItem(SOURCE_KEY) || '');

  const setSource = useCallback((src: string) => {
    localStorage.setItem(SOURCE_KEY, src);
    setSourceState(src);
  }, []);

  return { source, setSource };
}
