const IMAGE_EXTENSION_REGEX =
  /\.(jpe?g|png|webp|heic|heif|hif|avif|tiff?|bmp|gif|jxl|dng|cr2|cr3|nef|arw|orf|rw2|srw|pef|raf)$/i;

const IGNORED_SYSTEM_FILES = new Set([
  '.ds_store',
  'thumbs.db',
  'desktop.ini',
  '.localized',
]);

async function hasImageMagicBytes(file: File): Promise<boolean> {
  if (file.size < 12) return false;
  try {
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    // JPEG: FF D8 FF
    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
      return true;
    }
    // PNG: 89 50 4E 47
    if (
      header[0] === 0x89 &&
      header[1] === 0x50 &&
      header[2] === 0x4e &&
      header[3] === 0x47
    ) {
      return true;
    }
    // GIF: GIF87a / GIF89a
    if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) {
      return true;
    }
    // BMP: BM
    if (header[0] === 0x42 && header[1] === 0x4d) {
      return true;
    }
    // TIFF / DNG / NEF / CR2 / ARW: II*\0 or MM\0*
    if (
      (header[0] === 0x49 &&
        header[1] === 0x49 &&
        header[2] === 0x2a &&
        header[3] === 0x00) ||
      (header[0] === 0x4d &&
        header[1] === 0x4d &&
        header[2] === 0x00 &&
        header[3] === 0x2a)
    ) {
      return true;
    }
    // WebP: RIFF....WEBP
    if (
      header[0] === 0x52 &&
      header[1] === 0x49 &&
      header[2] === 0x46 &&
      header[3] === 0x46 &&
      header[8] === 0x57 &&
      header[9] === 0x45 &&
      header[10] === 0x42 &&
      header[11] === 0x50
    ) {
      return true;
    }
    // ISOBMFF (HEIC/HEIF/AVIF/CR3): ....ftyp
    if (
      header[4] === 0x66 &&
      header[5] === 0x74 &&
      header[6] === 0x79 &&
      header[7] === 0x70
    ) {
      const brand = String.fromCharCode(
        header[8],
        header[9],
        header[10],
        header[11]
      ).toLowerCase();
      if (
        [
          'heic',
          'heix',
          'hevc',
          'hevx',
          'heim',
          'heis',
          'hevm',
          'hevs',
          'mif1',
          'msf1',
          'avif',
          'avis',
          'crx ',
        ].includes(brand)
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export async function isSupportedImageFile(file: File): Promise<boolean> {
  if (!file || file.size === 0) return false;
  if (IGNORED_SYSTEM_FILES.has(file.name.toLowerCase())) return false;
  if (file.type.startsWith('image/')) return true;
  if (IMAGE_EXTENSION_REGEX.test(file.name)) return true;
  // Many dropped files from Windows/Android/macOS Photos or camera RAWs lack MIME or extension
  if (!file.type || file.type === 'application/octet-stream') {
    return hasImageMagicBytes(file);
  }
  return false;
}

export async function filterSupportedImageFiles(
  fileList: FileList | File[]
): Promise<File[]> {
  const candidates = Array.from(fileList);
  const checks = await Promise.all(
    candidates.map(async (f) => ((await isSupportedImageFile(f)) ? f : null))
  );
  return checks.filter((f): f is File => f !== null);
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (
    successCallback: (file: File) => void,
    errorCallback?: (err: unknown) => void
  ) => void;
  createReader?: () => {
    readEntries: (
      successCallback: (entries: FileSystemEntryLike[]) => void,
      errorCallback?: (err: unknown) => void
    ) => void;
  };
}

function readEntryFile(entry: FileSystemEntryLike): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) {
      resolve(null);
      return;
    }
    entry.file(
      (file) => resolve(file),
      () => resolve(null)
    );
  });
}

async function readDirectoryAllEntries(
  dirEntry: FileSystemEntryLike
): Promise<FileSystemEntryLike[]> {
  if (!dirEntry.createReader) return [];
  const reader = dirEntry.createReader();
  const allEntries: FileSystemEntryLike[] = [];

  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve) => {
      reader.readEntries(
        (entries) => resolve(entries),
        () => resolve([])
      );
    });
    if (batch.length === 0) break;
    allEntries.push(...batch);
  }

  return allEntries;
}

async function collectFilesFromEntry(
  entry: FileSystemEntryLike
): Promise<File[]> {
  if (entry.isFile) {
    const f = await readEntryFile(entry);
    return f ? [f] : [];
  }
  if (entry.isDirectory) {
    const children = await readDirectoryAllEntries(entry);
    const nested = await Promise.all(children.map(collectFilesFromEntry));
    return nested.flat();
  }
  return [];
}

/**
 * Extracts all dropped files (including recursively traversing dropped folders)
 * BEFORE any async boundary clears DataTransfer.
 */
export async function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<File[]> {
  // Capture synchronously before yielding to await
  const rawFiles = Array.from(dataTransfer.files || []);
  const itemEntries: FileSystemEntryLike[] = [];
  const itemFallbackFiles: File[] = [];

  if (dataTransfer.items && dataTransfer.items.length > 0) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i] as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntryLike | null;
      };
      if (item.kind !== 'file') continue;
      const entry =
        typeof item.webkitGetAsEntry === 'function'
          ? item.webkitGetAsEntry()
          : null;
      if (entry) {
        itemEntries.push(entry);
      } else {
        const f = item.getAsFile();
        if (f) itemFallbackFiles.push(f);
      }
    }
  }

  let collected: File[] = [];
  if (itemEntries.length > 0) {
    const nested = await Promise.all(itemEntries.map(collectFilesFromEntry));
    collected = [...nested.flat(), ...itemFallbackFiles];
  } else {
    collected = rawFiles;
  }

  // Merge any rawFiles missing from entry traversal (edge cases in some browsers)
  if (collected.length === 0 && rawFiles.length > 0) {
    collected = rawFiles;
  }

  // Deduplicate by name + size + lastModified
  const seen = new Set<string>();
  const unique: File[] = [];
  for (const file of collected) {
    const key = `${file.name}::${file.size}::${file.lastModified}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(file);
    }
  }

  return unique;
}
