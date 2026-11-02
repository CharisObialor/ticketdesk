import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';

// Display size: scales the root font size, and with it all rem-based text, spacing and controls.
export const TEXT_SIZES = [
  { value: 'xxs', label: 'Smallest', percent: 75 },
  { value: 'xs', label: 'Smaller', percent: 81.25 },
  { value: 'compact', label: 'Compact', percent: 87.5 },
  { value: 'sm', label: 'Slightly smaller', percent: 93.75 },
  { value: 'default', label: 'Default', percent: 100 },
  { value: 'md', label: 'Slightly larger', percent: 106.25 },
  { value: 'large', label: 'Large', percent: 112.5 },
  { value: 'larger', label: 'Larger', percent: 125 },
  { value: 'xl', label: 'Extra large', percent: 137.5 },
  { value: 'xxl', label: 'Largest', percent: 150 },
] as const;
export type TextSize = (typeof TEXT_SIZES)[number]['value'];

const STORAGE_KEY = 'theme';
const SIZE_KEY = 'text-size';
const ThemeContext = createContext<{
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (t: Theme) => void;
  textSize: TextSize;
  setTextSize: (s: TextSize) => void;
}>({
  theme: 'system',
  resolved: 'light',
  setTheme: () => {},
  textSize: 'default',
  setTextSize: () => {},
});

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function readTextSize(): TextSize {
  try {
    const v = localStorage.getItem(SIZE_KEY);
    return TEXT_SIZES.some((s) => s.value === v) ? (v as TextSize) : 'default';
  } catch {
    return 'default';
  }
}

// Small replacement for next-themes: it avoids the inline script that the server's CSP would block.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [textSize, setTextSizeState] = useState<TextSize>(readTextSize);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  useEffect(() => {
    const percent = TEXT_SIZES.find((s) => s.value === textSize)?.percent ?? 100;
    document.documentElement.style.fontSize = percent === 100 ? '' : `${percent}%`;
  }, [textSize]);

  const setTextSize = (s: TextSize) => {
    setTextSizeState(s);
    try {
      if (s === 'default') localStorage.removeItem(SIZE_KEY);
      else localStorage.setItem(SIZE_KEY, s);
    } catch {
      // Storage may be unavailable (private mode); the choice still applies for this visit.
    }
  };

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      if (t === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // Storage may be unavailable (private mode); the choice still applies for this visit.
    }
  };

  return <ThemeContext.Provider value={{ theme, resolved, setTheme, textSize, setTextSize }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
