import type {PhotoItem, WorkEntry, WorkSection} from '../types/photo';
import {generateBrowserCompatiblePreview} from './exif';

const DB_NAME = 'photoatlas_workspace_v1';
const DB_VERSION = 1;
const STORE_STATE = 'workspace';
const STORE_BLOBS = 'photo_blobs';

export interface PersistedPhotoRecord extends Omit<PhotoItem, 'previewUrl' | 'fallbackPreviewUrl'> {
  hasBlob?: boolean;
}

export interface PersistedWorkspace {
  photos: PersistedPhotoRecord[];
  sections: WorkSection[];
  workEntries: WorkEntry[];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE);
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savePhotoBlob(id: string, blob: Blob): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_BLOBS, 'readwrite');
      tx.objectStore(STORE_BLOBS).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore storage quota / private mode failures gracefully
  }
}

export async function deletePhotoBlob(id: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_BLOBS, 'readwrite');
      tx.objectStore(STORE_BLOBS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore
  }
}

export async function clearAllWorkspaceStorage(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_STATE, STORE_BLOBS], 'readwrite');
      tx.objectStore(STORE_STATE).clear();
      tx.objectStore(STORE_BLOBS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore
  }
}

export async function saveWorkspaceState(
  photos: PhotoItem[],
  sections: WorkSection[],
  workEntries: WorkEntry[]
): Promise<void> {
  try {
    const db = await openDatabase();
    const persistedPhotos: PersistedPhotoRecord[] = photos.map((p) => {
      const {previewUrl: _previewUrl, fallbackPreviewUrl: _fallback, ...rest} = p;
      return {
        ...rest,
        hasBlob: true,
      };
    });

    const payload: PersistedWorkspace = {
      photos: persistedPhotos,
      sections,
      workEntries,
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_STATE, 'readwrite');
      tx.objectStore(STORE_STATE).put(payload, 'current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore
  }
}

export async function loadWorkspaceState(): Promise<{
  photos: PhotoItem[];
  sections: WorkSection[];
  workEntries: WorkEntry[];
} | null> {
  try {
    const db = await openDatabase();
    const payload = await new Promise<PersistedWorkspace | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_STATE, 'readonly');
      const req = tx.objectStore(STORE_STATE).get('current');
      req.onsuccess = () => resolve(req.result as PersistedWorkspace | undefined);
      req.onerror = () => reject(req.error);
    });

    if (!payload) {
      db.close();
      return null;
    }

    const restoredPhotos: PhotoItem[] = await Promise.all(
      payload.photos.map(async (record) => {
        const blob = await new Promise<Blob | undefined>((resolve) => {
          const tx = db.transaction(STORE_BLOBS, 'readonly');
          const req = tx.objectStore(STORE_BLOBS).get(record.id);
          req.onsuccess = () => resolve(req.result as Blob | undefined);
          req.onerror = () => resolve(undefined);
        });
        const previewUrl = blob ? URL.createObjectURL(blob) : '';
        let fallbackPreviewUrl: string | undefined;
        const isHeic =
          blob &&
          (record.mimeType === 'image/heic' ||
            record.mimeType === 'image/heif' ||
            /\.(heic|heif|hif)$/i.test(record.fileName));
        if (blob && isHeic) {
          fallbackPreviewUrl = await generateBrowserCompatiblePreview(blob, true);
        }
        return {
          ...record,
          previewUrl,
          fallbackPreviewUrl,
        };
      })
    );

    db.close();
    return {
      photos: restoredPhotos.filter((p) => Boolean(p.previewUrl)),
      sections: payload.sections || [],
      workEntries: payload.workEntries || [],
    };
  } catch {
    return null;
  }
}
