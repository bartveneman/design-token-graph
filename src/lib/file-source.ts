/**
 * Live link to a tokens file on disk via the File System Access API (Chromium only).
 * Firefox/Safari only have `FileSystemHandle` for the origin private file system, so callers
 * should check `supportsHandles` and fall back to `<input type=file>`.
 */

type PermissionMode = { mode: 'read' | 'readwrite' };

interface HandleWithPermissions extends FileSystemFileHandle {
  queryPermission?(options: PermissionMode): Promise<PermissionState>;
  requestPermission?(options: PermissionMode): Promise<PermissionState>;
}

interface FileSystemObserverLike {
  observe(handle: FileSystemHandle): Promise<void>;
  disconnect(): void;
}

declare global {
  interface Window {
    showOpenFilePicker?(options?: {
      types?: { description?: string; accept: Record<string, string[]> }[];
      excludeAcceptAllOption?: boolean;
      multiple?: boolean;
    }): Promise<FileSystemFileHandle[]>;
    FileSystemObserver?: new (callback: (records: { type: string }[]) => void) => FileSystemObserverLike;
  }
}

export const supportsHandles = typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';

export async function pickFile(): Promise<FileSystemFileHandle> {
  const [handle] = await window.showOpenFilePicker!({
    types: [{ description: 'Design tokens', accept: { 'application/json': ['.json'] } }],
  });
  return handle;
}

/** `true` if the handle can be read; with `request`, asks the user (needs a user gesture). */
export async function ensurePermission(handle: FileSystemFileHandle, { request = false } = {}): Promise<boolean> {
  const h = handle as HandleWithPermissions;
  const options: PermissionMode = { mode: 'read' };
  if (!h.queryPermission) return true;
  if ((await h.queryPermission(options)) === 'granted') return true;
  return request && !!h.requestPermission && (await h.requestPermission(options)) === 'granted';
}

// --- IndexedDB persistence: handles are structured-cloneable, so they survive a page reload ---

const DB = 'token-graph';
const STORE = 'handles';
const KEY = 'last';

function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = fn(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.transaction!.oncomplete = () => db.close();
    };
  });
}

export async function saveHandle(handle: FileSystemFileHandle): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put(handle, KEY));
  } catch {
    // storage unavailable (private mode etc.): restoring after reload just won't work
  }
}

export async function loadHandle(): Promise<FileSystemFileHandle | undefined> {
  try {
    return await withStore<FileSystemFileHandle | undefined>('readonly', (s) => s.get(KEY));
  } catch {
    return undefined;
  }
}

export async function clearHandle(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(KEY));
  } catch {
    // nothing stored, nothing to clear
  }
}

// --- Watching ---

const POLL_MS = 1000;

/**
 * Calls `onchange` with the new file whenever it changes on disk. Polls `lastModified`/`size`, and also listens to
 * `FileSystemObserver` where available for faster updates. Returns a function that stops watching.
 */
export function watchFile(handle: FileSystemFileHandle, onchange: (file: File) => void): () => void {
  let stopped = false;
  let last: { lastModified: number; size: number } | undefined;
  let checking = false;

  const check = async () => {
    if (stopped || checking) return;
    checking = true;
    try {
      const file = await handle.getFile();
      const changed = last && (file.lastModified !== last.lastModified || file.size !== last.size);
      last = { lastModified: file.lastModified, size: file.size };
      if (changed && !stopped) onchange(file);
    } catch {
      // file temporarily missing (editors often write via rename) or permission revoked: try again next time
    } finally {
      checking = false;
    }
  };
  check(); // baseline

  // The observer reports changes instantly, but doesn't fire reliably for files on disk, so always poll as well.
  let observer: FileSystemObserverLike | undefined;
  if (window.FileSystemObserver) {
    observer = new window.FileSystemObserver(() => check());
    observer.observe(handle).catch(() => observer?.disconnect());
  }
  const timer = setInterval(check, POLL_MS);

  // Catch up right away when coming back from the editor (timers are throttled in background tabs)
  const onvisible = () => document.visibilityState === 'visible' && check();
  document.addEventListener('visibilitychange', onvisible);
  window.addEventListener('focus', check);

  return () => {
    stopped = true;
    observer?.disconnect();
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onvisible);
    window.removeEventListener('focus', check);
  };
}
