import { isAndroidApp, plugin } from '../native/maktaba';

const CHUNK = 768 * 1024;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface Saved {
  /** Where the reader will find it, in words. */
  location: string;
  share?: () => Promise<void>;
}

/**
 * Saves a file for the reader to keep: into Downloads/Maktaba on Android (in pieces, so
 * a large backup never has to fit in memory), or as a download in a browser.
 */
export async function saveFile(blob: Blob, name: string, mime: string, onProgress?: (done: number, total: number) => void): Promise<Saved> {
  if (isAndroidApp()) {
    const { id } = await plugin.saveFileBegin({ name, mime });
    for (let at = 0; at < blob.size; at += CHUNK) {
      const part = new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer());
      await plugin.saveFileChunk({ id, data: toBase64(part) });
      onProgress?.(Math.min(blob.size, at + CHUNK), blob.size);
    }
    const res = await plugin.saveFileEnd({ id });
    return { location: res.location, share: () => plugin.shareFile({ uri: res.uri, mime, title: 'Send the backup' }) };
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  onProgress?.(blob.size, blob.size);
  return { location: 'your Downloads folder' };
}
