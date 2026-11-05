import { useEffect, useState } from 'react';

// Theme preference: 'system' (default), 'light' or 'dark'.
// Stored under the app's key prefix, so "Очистить данные" resets it too.
export const THEME_KEY = 'poryadok-theme';
const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

export function readThemePref() {
  try { const v = localStorage.getItem(THEME_KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
}
export function applyTheme(pref) {
  const root = document.documentElement;
  if (pref === 'light' || pref === 'dark') root.setAttribute('data-theme', pref);
  else root.removeAttribute('data-theme');
}

export function useTheme() {
  const [pref, setPrefState] = useState(readThemePref);
  const [systemDark, setSystemDark] = useState(() => !!media()?.matches);
  useEffect(() => {
    const m = media(); if (!m) return;
    const on = e => setSystemDark(e.matches);
    m.addEventListener('change', on); return () => m.removeEventListener('change', on);
  }, []);
  useEffect(() => { applyTheme(pref); }, [pref]);
  const setPref = value => {
    try { value === 'system' ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, value); } catch {}
    setPrefState(value);
  };
  const effective = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  return { pref, effective, setPref, toggle: () => setPref(effective === 'dark' ? 'light' : 'dark') };
}
