import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface SharedFile {
  path: string;
  name: string;
  mime?: string;
  size: number;
}

interface MaktabaNative {
  startWork(o: { title: string; text: string; done: number; total: number }): Promise<{ started: boolean }>;
  updateWork(o: { title: string; text: string; done: number; total: number }): Promise<void>;
  stopWork(): Promise<void>;
  setPendingWork(o: { text: string }): Promise<void>;
  requestNotifications(): Promise<{ granted: boolean }>;
  showNotice(o: { title: string; text: string }): Promise<void>;
  setVolumeKeys(o: { enabled: boolean }): Promise<void>;
  keepScreenOn(o: { on: boolean }): Promise<void>;
  setOrientation(o: { orientation: 'auto' | 'portrait' | 'landscape' }): Promise<void>;
  releaseSharedFiles(o: { paths: string[] }): Promise<void>;
  saveFileBegin(o: { name: string; mime: string; temp?: boolean }): Promise<{ id: string }>;
  saveFileChunk(o: { id: string; data: string }): Promise<void>;
  saveFileEnd(o: { id: string }): Promise<{ location: string; uri: string }>;
  shareFile(o: { uri: string; mime: string; title: string }): Promise<void>;
  openFile(o: { uri: string; mime: string; title: string }): Promise<void>;
  openUrl(o: { url: string }): Promise<void>;
  listenForSignIn(): Promise<{ url: string }>;
  appInfo(): Promise<{ versionCode: number; versionName?: string; canInstall: boolean }>;
  downloadUpdate(o: { url: string }): Promise<{ sameKey: boolean; versionCode: number }>;
  installUpdate(): Promise<{ needsPermission: boolean }>;
  openSecuritySettings(): Promise<{ samsung: boolean }>;
  shareText(o: { text: string; title: string }): Promise<void>;
  googleAuthorize(o: { scopes: string[]; interactive: boolean }): Promise<{ accessToken: string }>;
  addListener(event: string, fn: (e: unknown) => void): Promise<PluginListenerHandle>;
}

/** What each event from the Android side carries. */
export interface NativeEvents {
  volumeKey: { direction: 1 | -1 };
  sharedFiles: { files: SharedFile[]; failed: string[] };
  sharedText: { text: string };
  authCallback: { url: string };
  updateProgress: { done: number; total: number };
}

/** True inside the installed Android app (not on the web or iPhone). */
export const isAndroidApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

/** The Android side itself (one registration for the whole app). */
export const plugin = registerPlugin<MaktabaNative>('Maktaba');

/**
 * Android-only abilities. Every call is safe to make anywhere: off Android it does nothing,
 * and a failure on Android never breaks the page that asked.
 */
export const native = {
  async call<K extends keyof Omit<MaktabaNative, 'addListener'>>(name: K, ...args: Parameters<MaktabaNative[K]>): Promise<Awaited<ReturnType<MaktabaNative[K]>> | undefined> {
    if (!isAndroidApp()) return undefined;
    try {
      return (await (plugin[name] as (...a: unknown[]) => Promise<unknown>)(...args)) as Awaited<ReturnType<MaktabaNative[K]>>;
    } catch (e) {
      console.warn(`Maktaba native ${name} failed`, e);
      return undefined;
    }
  },
  async on<E extends keyof NativeEvents>(event: E, fn: (e: NativeEvents[E]) => void): Promise<() => void> {
    if (!isAndroidApp()) return () => undefined;
    const handle = await plugin.addListener(event, fn as (e: unknown) => void);
    return () => void handle.remove();
  },
  /** Reads a file the Android side saved, as a File the importers can use. */
  async readShared(f: SharedFile): Promise<File> {
    const res = await fetch(Capacitor.convertFileSrc(f.path));
    if (!res.ok) throw new Error(`Could not read ${f.name}`);
    const blob = await res.blob();
    return new File([blob], f.name, { type: f.mime || blob.type || '' });
  },
};
