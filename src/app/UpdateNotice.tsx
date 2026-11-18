import { useEffect, useState } from 'react';
import { Icon } from '../ui/Icon';
import { AppUpdate } from './AppUpdate';

/**
 * Tells the reader when a newer version has been downloaded and is ready to use.
 * (Web / home-screen install. The Android app checks for a new APK separately.)
 */
export function UpdateNotice() {
  const [update, setUpdate] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    let cancelled = false;
    void (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) return;
      const { registerSW } = await import('virtual:pwa-register');
      const apply = registerSW({
        onNeedRefresh() {
          if (!cancelled) setUpdate(() => () => void apply(true));
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return <AppUpdate />;
  return (
    <div className="update-notice" role="status">
      <Icon name="download" size={20} />
      <span>A new version of Maktaba is ready.</span>
      <button className="btn btn--primary" onClick={update}>Update</button>
    </div>
  );
}
