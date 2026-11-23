import { useEffect, useState } from 'react';

/** Light or dark, as the page is drawn now (follows theme changes, synced or automatic). */
export function useThemeTone(): 'light' | 'dark' {
  const read = () => (document.documentElement.dataset.tone === 'dark' ? 'dark' : 'light');
  const [tone, setTone] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const on = () => setTone(read());
    window.addEventListener('maktaba:theme', on);
    return () => window.removeEventListener('maktaba:theme', on);
  }, []);
  return tone;
}
