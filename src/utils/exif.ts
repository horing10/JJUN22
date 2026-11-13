import exifr from 'exifr';
import type {
  PhotoExifData,
  PhotoItem,
  ResolvedLocation,
  WorkEntry,
  WorkSection,
} from '../types/photo';
import {sortSectionPhotos} from './geo';

function formatExposureTime(seconds?: number): string | undefined {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  if (seconds >= 1) return `${seconds.toFixed(1).replace(/\.0$/, '')}s`;
  const denom = Math.round(1 / seconds);
  return `1/${denom}s`;
}

function formatDateInput(value: unknown): {formatted?: string; timestampMs?: number} {
  if (!value) return {};
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      formatted: new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(value),
      timestampMs: value.getTime(),
    };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/\0/g, '');
    if (!trimmed) return {};
    const normalized = trimmed.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        formatted: new Intl.DateTimeFormat('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(parsed),
        timestampMs: parsed.getTime(),
      };
    }
    return {formatted: trimmed};
  }
  return {};
}

export function formatDecimalCoords(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export function formatDmsCoords(lat: number, lng: number): string {
  const toDms = (deg: number, pos: string, neg: string) => {
    const dir = deg >= 0 ? pos : neg;
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const minFloat = (abs - d) * 60;
    const m = Math.floor(minFloat);
    const s = ((minFloat - m) * 60).toFixed(1);
    return `${d}° ${m}' ${s}" ${dir}`;
  };
  return `${toDms(lat, 'N', 'S')}, ${toDms(lng, 'E', 'W')}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readImageDimensions(
  url: string
): Promise<{width?: number; height?: number}> {
  return new Promise((resolve) => {
    if (!url) {
      resolve({});
      return;
    }
    const img = new Image();
    img.onload = () =>
      resolve({width: img.naturalWidth, height: img.naturalHeight});
    img.onerror = () => resolve({});
    img.src = url;
  });
}

function isValidCoordPair(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(Math.abs(lat) < 0.00001 && Math.abs(lng) < 0.00001)
  );
}

function parseNumberToken(token: string): number | undefined {
  const t = token.trim();
  if (!t) return undefined;
  if (t.includes('/')) {
    const [numStr, denStr] = t.split('/');
    const num = Number(numStr);
    const den = Number(denStr);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return num / den;
    }
    return undefined;
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

function parseCoordinateValue(
  raw: unknown,
  ref?: unknown,
  isLongitude = false
): number | undefined {
  const maxAbs = isLongitude ? 180 : 90;
  let value: number | undefined;
  let explicitSign = 1;

  const refStr = typeof ref === 'string' ? ref.trim().toUpperCase() : '';
  if (refStr === 'S' || refStr === 'W' || refStr === '-1') {
    explicitSign = -1;
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    value = raw;
  } else if (Array.isArray(raw) && raw.length >= 1) {
    const nums = raw.map((item) => {
      if (typeof item === 'number') return item;
      if (
        item &&
        typeof item === 'object' &&
        'numerator' in item &&
        'denominator' in item
      ) {
        const obj = item as {numerator: number; denominator: number};
        return obj.denominator ? obj.numerator / obj.denominator : NaN;
      }
      return Number(item);
    });
    if (nums.length >= 3 && nums.slice(0, 3).every(Number.isFinite)) {
      const sign = nums[0] < 0 ? -1 : 1;
      value =
        sign *
        (Math.abs(nums[0]) + Math.abs(nums[1]) / 60 + Math.abs(nums[2]) / 3600);
    } else if (nums.length === 2 && nums.slice(0, 2).every(Number.isFinite)) {
      const sign = nums[0] < 0 ? -1 : 1;
      value = sign * (Math.abs(nums[0]) + Math.abs(nums[1]) / 60);
    } else if (Number.isFinite(nums[0])) {
      value = nums[0];
    }
  } else if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return undefined;
    if (/[SW]$/i.test(s) || /^[SW]/i.test(s)) {
      explicitSign = -1;
    }
    const cleaned = s
      .replace(/[NSEW°'"\s]+$/i, '')
      .replace(/^[NSEW\s]+/i, '');

    if (/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) {
      value = Number(cleaned);
    } else {
      const tokens = cleaned
        .split(/[,°'"\s]+/)
        .map(parseNumberToken)
        .filter((n): n is number => n !== undefined);
      if (tokens.length >= 3) {
        const sign = tokens[0] < 0 ? -1 : 1;
        value =
          sign *
          (Math.abs(tokens[0]) +
            Math.abs(tokens[1]) / 60 +
            Math.abs(tokens[2]) / 3600);
      } else if (tokens.length === 2) {
        const sign = tokens[0] < 0 ? -1 : 1;
        value = sign * (Math.abs(tokens[0]) + Math.abs(tokens[1]) / 60);
      } else if (tokens.length === 1) {
        value = tokens[0];
      }
    }
  }

  if (value === undefined || !Number.isFinite(value)) return undefined;
  if (explicitSign === -1 && value > 0) {
    value = -value;
  }
  if (Math.abs(value) > maxAbs) return undefined;
  return value;
}

interface ExtractedMetaBundle {
  lat?: number;
  lng?: number;
  exif: PhotoExifData;
  thumbnailUrl?: string;
}

function mergeParsedObjectIntoBundle(
  parsed: Record<string, unknown> | undefined,
  bundle: ExtractedMetaBundle
): void {
  if (!parsed) return;

  const latCandidate =
    parseCoordinateValue(
      parsed.latitude ?? parsed.GPSLatitude ?? parsed.lat,
      parsed.GPSLatitudeRef,
      false
    ) ?? parseCoordinateValue(parsed['exif:GPSLatitude'], parsed['exif:GPSLatitudeRef'], false);

  const lngCandidate =
    parseCoordinateValue(
      parsed.longitude ?? parsed.GPSLongitude ?? parsed.lng ?? parsed.lon,
      parsed.GPSLongitudeRef,
      true
    ) ?? parseCoordinateValue(parsed['exif:GPSLongitude'], parsed['exif:GPSLongitudeRef'], true);

  if (
    bundle.lat === undefined &&
    bundle.lng === undefined &&
    isValidCoordPair(latCandidate, lngCandidate)
  ) {
    bundle.lat = latCandidate;
    bundle.lng = lngCandidate;
  }

  if (!bundle.exif.make && typeof parsed.Make === 'string' && parsed.Make.trim()) {
    bundle.exif.make = parsed.Make.trim();
  }
  if (!bundle.exif.model && typeof parsed.Model === 'string' && parsed.Model.trim()) {
    bundle.exif.model = parsed.Model.trim();
  }
  if (
    !bundle.exif.lensModel &&
    typeof parsed.LensModel === 'string' &&
    parsed.LensModel.trim()
  ) {
    bundle.exif.lensModel = parsed.LensModel.trim();
  }

  if (!bundle.exif.dateTimeOriginal) {
    const dateInfo = formatDateInput(
      parsed.DateTimeOriginal ||
        parsed.CreateDate ||
        parsed.DateCreated ||
        parsed.ModifyDate ||
        parsed.DateTime
    );
    if (dateInfo.formatted) bundle.exif.dateTimeOriginal = dateInfo.formatted;
    if (dateInfo.timestampMs) bundle.exif.timestampMs = dateInfo.timestampMs;
  }

  if (
    !bundle.exif.focalLength &&
    typeof parsed.FocalLength === 'number' &&
    Number.isFinite(parsed.FocalLength)
  ) {
    bundle.exif.focalLength = `${Math.round(parsed.FocalLength)}mm`;
  }
  if (
    !bundle.exif.fNumber &&
    typeof parsed.FNumber === 'number' &&
    Number.isFinite(parsed.FNumber)
  ) {
    bundle.exif.fNumber = `f/${parsed.FNumber.toFixed(1).replace(/\.0$/, '')}`;
  }
  if (
    !bundle.exif.exposureTime &&
    typeof parsed.ExposureTime === 'number' &&
    Number.isFinite(parsed.ExposureTime)
  ) {
    bundle.exif.exposureTime = formatExposureTime(parsed.ExposureTime);
  }
  if (!bundle.exif.iso) {
    const isoRaw = parsed.ISO ?? parsed.ISOSpeedRatings;
    if (typeof isoRaw === 'number' && Number.isFinite(isoRaw)) {
      bundle.exif.iso = isoRaw;
    } else if (Array.isArray(isoRaw) && typeof isoRaw[0] === 'number') {
      bundle.exif.iso = isoRaw[0];
    }
  }
  if (
    !bundle.exif.width &&
    typeof parsed.ExifImageWidth === 'number' &&
    parsed.ExifImageWidth > 0
  ) {
    bundle.exif.width = parsed.ExifImageWidth;
  } else if (
    !bundle.exif.width &&
    typeof parsed.ImageWidth === 'number' &&
    parsed.ImageWidth > 0
  ) {
    bundle.exif.width = parsed.ImageWidth;
  }
  if (
    !bundle.exif.height &&
    typeof parsed.ExifImageHeight === 'number' &&
    parsed.ExifImageHeight > 0
  ) {
    bundle.exif.height = parsed.ExifImageHeight;
  } else if (
    !bundle.exif.height &&
    typeof parsed.ImageHeight === 'number' &&
    parsed.ImageHeight > 0
  ) {
    bundle.exif.height = parsed.ImageHeight;
  }
  if (
    bundle.exif.altitude === undefined &&
    typeof parsed.GPSAltitude === 'number' &&
    Number.isFinite(parsed.GPSAltitude)
  ) {
    const ref = parsed.GPSAltitudeRef === 1 ? -1 : 1;
    bundle.exif.altitude = Math.round(parsed.GPSAltitude * ref * 10) / 10;
  }
  if (
    bundle.exif.heading === undefined &&
    typeof parsed.GPSImgDirection === 'number' &&
    Number.isFinite(parsed.GPSImgDirection)
  ) {
    bundle.exif.heading = Math.round(parsed.GPSImgDirection);
  }
}

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  let out = '';
  const end = Math.min(bytes.length, start + len);
  for (let i = start; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function readUintBE(bytes: Uint8Array, offset: number, byteCount: number): number {
  if (byteCount <= 0 || offset + byteCount > bytes.length) return 0;
  let val = 0;
  for (let i = 0; i < byteCount; i++) {
    val = val * 256 + bytes[offset + i];
  }
  return val;
}

/**
 * Pure TypeScript TIFF / IFD0 / ExifIFD / GPSIFD / IFD1 thumbnail parser.
 * Handles direct TIFF payloads extracted from HEIC Exif items, PNG eXIf chunks, WebP EXIF chunks, and RAW/TIFF files.
 */
function parseTiffBufferDirectly(
  bytes: Uint8Array,
  tiffStart: number,
  bundle: ExtractedMetaBundle
): void {
  if (tiffStart + 8 > bytes.length) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const b0 = bytes[tiffStart];
  const b1 = bytes[tiffStart + 1];
  const le = b0 === 0x49 && b1 === 0x49;
  const be = b0 === 0x4d && b1 === 0x4d;
  if (!le && !be) return;

  const magic = view.getUint16(tiffStart + 2, le);
  if (magic !== 42) return;

  const ifd0Rel = view.getUint32(tiffStart + 4, le);
  if (!ifd0Rel || tiffStart + ifd0Rel + 2 > bytes.length) return;

  const typeSizes: Record<number, number> = {
    1: 1,
    2: 1,
    3: 2,
    4: 4,
    5: 8,
    7: 1,
    9: 4,
    10: 8,
  };

  interface IfdEntry {
    tag: number;
    type: number;
    count: number;
    valueOffsetBytesStart: number;
    dataStart: number;
    totalBytes: number;
  }

  const readIfd = (relOffset: number): {entries: IfdEntry[]; nextIfdRel: number} => {
    const abs = tiffStart + relOffset;
    if (abs + 2 > bytes.length) return {entries: [], nextIfdRel: 0};
    const count = view.getUint16(abs, le);
    if (count === 0 || count > 300) return {entries: [], nextIfdRel: 0};
    const entries: IfdEntry[] = [];
    for (let i = 0; i < count; i++) {
      const entryStart = abs + 2 + i * 12;
      if (entryStart + 12 > bytes.length) break;
      const tag = view.getUint16(entryStart, le);
      const type = view.getUint16(entryStart + 2, le);
      const valCount = view.getUint32(entryStart + 4, le);
      const unitSize = typeSizes[type] || 1;
      const totalBytes = unitSize * valCount;
      const valueOffsetBytesStart = entryStart + 8;
      let dataStart = valueOffsetBytesStart;
      if (totalBytes > 4) {
        const ptr = view.getUint32(valueOffsetBytesStart, le);
        dataStart = tiffStart + ptr;
      }
      entries.push({
        tag,
        type,
        count: valCount,
        valueOffsetBytesStart,
        dataStart,
        totalBytes,
      });
    }
    const nextPos = abs + 2 + count * 12;
    const nextIfdRel =
      nextPos + 4 <= bytes.length ? view.getUint32(nextPos, le) : 0;
    return {entries, nextIfdRel};
  };

  const readStringTag = (entry: IfdEntry): string | undefined => {
    if (entry.dataStart + entry.totalBytes > bytes.length) return undefined;
    return readAscii(bytes, entry.dataStart, entry.totalBytes)
      .replace(/\0+$/, '')
      .trim();
  };

  const readNumberTag = (entry: IfdEntry): number | undefined => {
    if (entry.type === 3 && entry.count >= 1 && entry.dataStart + 2 <= bytes.length) {
      return view.getUint16(entry.dataStart, le);
    }
    if (entry.type === 4 && entry.count >= 1 && entry.dataStart + 4 <= bytes.length) {
      return view.getUint32(entry.dataStart, le);
    }
    if (entry.type === 1 && entry.count >= 1 && entry.dataStart < bytes.length) {
      return bytes[entry.dataStart];
    }
    if (entry.type === 5 && entry.count >= 1 && entry.dataStart + 8 <= bytes.length) {
      const num = view.getUint32(entry.dataStart, le);
      const den = view.getUint32(entry.dataStart + 4, le);
      return den ? num / den : undefined;
    }
    if (entry.type === 10 && entry.count >= 1 && entry.dataStart + 8 <= bytes.length) {
      const num = view.getInt32(entry.dataStart, le);
      const den = view.getInt32(entry.dataStart + 4, le);
      return den ? num / den : undefined;
    }
    return undefined;
  };

  const readRationalArray = (entry: IfdEntry): number[] => {
    const out: number[] = [];
    const signed = entry.type === 10;
    for (let i = 0; i < Math.min(entry.count, 4); i++) {
      const pos = entry.dataStart + i * 8;
      if (pos + 8 > bytes.length) break;
      const num = signed ? view.getInt32(pos, le) : view.getUint32(pos, le);
      const den = signed ? view.getInt32(pos + 4, le) : view.getUint32(pos + 4, le);
      out.push(den ? num / den : 0);
    }
    return out;
  };

  const ifd0 = readIfd(ifd0Rel);
  let exifIfdRel = 0;
  let gpsIfdRel = 0;

  for (const e of ifd0.entries) {
    if (e.tag === 0x010f && !bundle.exif.make) {
      const v = readStringTag(e);
      if (v) bundle.exif.make = v;
    } else if (e.tag === 0x0110 && !bundle.exif.model) {
      const v = readStringTag(e);
      if (v) bundle.exif.model = v;
    } else if (e.tag === 0x0132 && !bundle.exif.dateTimeOriginal) {
      const d = formatDateInput(readStringTag(e));
      if (d.formatted) bundle.exif.dateTimeOriginal = d.formatted;
      if (d.timestampMs) bundle.exif.timestampMs = d.timestampMs;
    } else if (e.tag === 0x8769) {
      exifIfdRel = readNumberTag(e) || 0;
    } else if (e.tag === 0x8825) {
      gpsIfdRel = readNumberTag(e) || 0;
    }
  }

  if (exifIfdRel > 0) {
    const exifIfd = readIfd(exifIfdRel);
    for (const e of exifIfd.entries) {
      if ((e.tag === 0x9003 || e.tag === 0x9004) && !bundle.exif.dateTimeOriginal) {
        const d = formatDateInput(readStringTag(e));
        if (d.formatted) bundle.exif.dateTimeOriginal = d.formatted;
        if (d.timestampMs) bundle.exif.timestampMs = d.timestampMs;
      } else if (e.tag === 0x829a && !bundle.exif.exposureTime) {
        const v = readNumberTag(e);
        bundle.exif.exposureTime = formatExposureTime(v);
      } else if (e.tag === 0x829d && !bundle.exif.fNumber) {
        const v = readNumberTag(e);
        if (v && Number.isFinite(v)) {
          bundle.exif.fNumber = `f/${v.toFixed(1).replace(/\.0$/, '')}`;
        }
      } else if (e.tag === 0x8827 && !bundle.exif.iso) {
        const v = readNumberTag(e);
        if (v && Number.isFinite(v)) bundle.exif.iso = v;
      } else if (e.tag === 0x920a && !bundle.exif.focalLength) {
        const v = readNumberTag(e);
        if (v && Number.isFinite(v)) bundle.exif.focalLength = `${Math.round(v)}mm`;
      } else if (e.tag === 0xa002 && !bundle.exif.width) {
        const v = readNumberTag(e);
        if (v && v > 0) bundle.exif.width = v;
      } else if (e.tag === 0xa003 && !bundle.exif.height) {
        const v = readNumberTag(e);
        if (v && v > 0) bundle.exif.height = v;
      } else if (e.tag === 0xa434 && !bundle.exif.lensModel) {
        const v = readStringTag(e);
        if (v) bundle.exif.lensModel = v;
      }
    }
  }

  if (gpsIfdRel > 0) {
    const gpsIfd = readIfd(gpsIfdRel);
    let latRef: string | undefined;
    let lngRef: string | undefined;
    let rawLat: number[] | undefined;
    let rawLng: number[] | undefined;
    let altRef = 0;
    let altVal: number | undefined;

    for (const e of gpsIfd.entries) {
      if (e.tag === 0x0001) {
        latRef = readStringTag(e);
      } else if (e.tag === 0x0002) {
        rawLat = readRationalArray(e);
      } else if (e.tag === 0x0003) {
        lngRef = readStringTag(e);
      } else if (e.tag === 0x0004) {
        rawLng = readRationalArray(e);
      } else if (e.tag === 0x0005) {
        altRef = readNumberTag(e) ?? 0;
      } else if (e.tag === 0x0006) {
        altVal = readNumberTag(e);
      } else if (e.tag === 0x0011 && bundle.exif.heading === undefined) {
        const heading = readNumberTag(e);
        if (heading !== undefined && Number.isFinite(heading)) {
          bundle.exif.heading = Math.round(heading);
        }
      }
    }

    if (altVal !== undefined && Number.isFinite(altVal) && bundle.exif.altitude === undefined) {
      bundle.exif.altitude = Math.round(altVal * (altRef === 1 ? -1 : 1) * 10) / 10;
    }

    if (bundle.lat === undefined && bundle.lng === undefined && rawLat && rawLng) {
      const parsedLat = parseCoordinateValue(rawLat, latRef, false);
      const parsedLng = parseCoordinateValue(rawLng, lngRef, true);
      if (isValidCoordPair(parsedLat, parsedLng)) {
        bundle.lat = parsedLat;
        bundle.lng = parsedLng;
      }
    }
  }

  // Try embedded IFD1 JPEG thumbnail if we don't have one yet
  if (!bundle.thumbnailUrl && ifd0.nextIfdRel > 0) {
    const ifd1 = readIfd(ifd0.nextIfdRel);
    let thumbOffset = 0;
    let thumbLen = 0;
    for (const e of ifd1.entries) {
      if (e.tag === 0x0201) thumbOffset = readNumberTag(e) || 0;
      if (e.tag === 0x0202) thumbLen = readNumberTag(e) || 0;
    }
    if (
      thumbOffset > 0 &&
      thumbLen > 100 &&
      tiffStart + thumbOffset + thumbLen <= bytes.length
    ) {
      const thumbSlice = bytes.slice(
        tiffStart + thumbOffset,
        tiffStart + thumbOffset + thumbLen
      );
      if (thumbSlice[0] === 0xff && thumbSlice[1] === 0xd8) {
        bundle.thumbnailUrl = URL.createObjectURL(
          new Blob([thumbSlice], {type: 'image/jpeg'})
        );
      }
    }
  }
}

function parseXmpString(xmpText: string, bundle: ExtractedMetaBundle): void {
  const readXmpTag = (names: string[]): string | undefined => {
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const attrMatch = xmpText.match(
        new RegExp(`${escaped}\\s*=\\s*["']([^"']+)["']`, 'i')
      );
      if (attrMatch?.[1]) return attrMatch[1].trim();

      const elemMatch = xmpText.match(
        new RegExp(`<${escaped}[^>]*>\\s*([^<]+?)\\s*</${escaped}>`, 'i')
      );
      if (elemMatch?.[1]) return elemMatch[1].trim();
    }
    return undefined;
  };

  if (bundle.lat === undefined || bundle.lng === undefined) {
    const rawLat = readXmpTag(['exif:GPSLatitude', 'GPSLatitude']);
    const rawLatRef = readXmpTag(['exif:GPSLatitudeRef', 'GPSLatitudeRef']);
    const rawLng = readXmpTag(['exif:GPSLongitude', 'GPSLongitude']);
    const rawLngRef = readXmpTag(['exif:GPSLongitudeRef', 'GPSLongitudeRef']);

    const latVal = parseCoordinateValue(rawLat, rawLatRef, false);
    const lngVal = parseCoordinateValue(rawLng, rawLngRef, true);
    if (isValidCoordPair(latVal, lngVal)) {
      bundle.lat = latVal;
      bundle.lng = lngVal;
    }
  }

  if (bundle.exif.altitude === undefined) {
    const rawAlt = readXmpTag(['exif:GPSAltitude', 'GPSAltitude']);
    const rawAltRef = readXmpTag(['exif:GPSAltitudeRef', 'GPSAltitudeRef']);
    if (rawAlt) {
      const alt = parseNumberToken(rawAlt);
      if (alt !== undefined) {
        const sign = rawAltRef === '1' ? -1 : 1;
        bundle.exif.altitude = Math.round(alt * sign * 10) / 10;
      }
    }
  }

  if (bundle.exif.heading === undefined) {
    const rawDir = readXmpTag(['exif:GPSImgDirection', 'GPSImgDirection']);
    if (rawDir) {
      const dir = parseNumberToken(rawDir);
      if (dir !== undefined) bundle.exif.heading = Math.round(dir);
    }
  }

  if (!bundle.exif.make) {
    const make = readXmpTag(['tiff:Make', 'Make']);
    if (make) bundle.exif.make = make;
  }
  if (!bundle.exif.model) {
    const model = readXmpTag(['tiff:Model', 'Model']);
    if (model) bundle.exif.model = model;
  }
  if (!bundle.exif.dateTimeOriginal) {
    const dateStr = readXmpTag([
      'exif:DateTimeOriginal',
      'photoshop:DateCreated',
      'xmp:CreateDate',
      'tiff:DateTime',
    ]);
    if (dateStr) {
      const d = formatDateInput(dateStr);
      if (d.formatted) bundle.exif.dateTimeOriginal = d.formatted;
      if (d.timestampMs) bundle.exif.timestampMs = d.timestampMs;
    }
  }
}

function parseIso6709String(text: string, bundle: ExtractedMetaBundle): void {
  if (bundle.lat !== undefined && bundle.lng !== undefined) return;
  const match = text.match(/([+-]\d{1,2}\.\d{3,})([+-]\d{1,3}\.\d{3,})/);
  if (!match) return;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (isValidCoordPair(lat, lng)) {
    bundle.lat = lat;
    bundle.lng = lng;
  }
}

function findSequence(
  haystack: Uint8Array,
  needle: number[],
  fromIndex = 0
): number {
  const limit = haystack.length - needle.length;
  outer: for (let i = fromIndex; i <= limit; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const KNOWN_META_CHILD_BOXES = new Set([
  'hdlr',
  'iinf',
  'iloc',
  'idat',
  'iprp',
  'pitm',
  'iref',
  'dinf',
  'keys',
  'ilst',
]);

async function parseTiffSliceWithExifrAndDirect(
  bytes: Uint8Array,
  tiffStart: number,
  maxLen: number,
  bundle: ExtractedMetaBundle
): Promise<void> {
  const end = Math.min(bytes.length, tiffStart + maxLen);
  const tiffSlice = bytes.slice(tiffStart, end);

  parseTiffBufferDirectly(tiffSlice, 0, bundle);

  if (bundle.lat === undefined || !bundle.exif.dateTimeOriginal || !bundle.exif.make) {
    const exifrGps = await exifr.gps(tiffSlice).catch(() => undefined);
    if (
      bundle.lat === undefined &&
      bundle.lng === undefined &&
      exifrGps &&
      isValidCoordPair(exifrGps.latitude, exifrGps.longitude)
    ) {
      bundle.lat = exifrGps.latitude;
      bundle.lng = exifrGps.longitude;
    }

    const exifrParsed = await exifr
      .parse(tiffSlice, {
        tiff: true,
        exif: true,
        gps: true,
        xmp: true,
        ifd1: true,
        mergeOutput: true,
      })
      .catch(() => undefined);
    mergeParsedObjectIntoBundle(
      exifrParsed as Record<string, unknown> | undefined,
      bundle
    );
  }
}

/**
 * Full ISO Base Media File Format (HEIC / HEIF / HIF / AVIF / CR3) container extractor.
 * Walks meta -> iinf + iloc + idat and moov/udta/©xyz boxes regardless of box order or 64-bit offsets.
 */
async function extractIsobmffMetadata(
  bytes: Uint8Array,
  bundle: ExtractedMetaBundle
): Promise<{isHeicLike: boolean}> {
  if (bytes.length < 16 || readAscii(bytes, 4, 4) !== 'ftyp') {
    return {isHeicLike: false};
  }

  const brandText = readAscii(bytes, 8, Math.min(64, bytes.length - 8)).toLowerCase();
  const isHeicLike =
    /(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)/.test(brandText);

  interface InfeEntry {
    itemId: number;
    itemType: string;
    contentType: string;
    itemName: string;
  }

  interface IlocExtent {
    offset: number;
    length: number;
  }

  interface IlocItem {
    itemId: number;
    constructionMethod: number;
    baseOffset: number;
    extents: IlocExtent[];
  }

  const readBoxes = async (start: number, end: number) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = start;

    let idatStart = 0;
    let idatLength = 0;
    const infeItems: InfeEntry[] = [];
    const ilocItems: IlocItem[] = [];

    const childBoxes: Array<{type: string; contentStart: number; boxEnd: number}> =
      [];

    while (pos + 8 <= end) {
      const size32 = view.getUint32(pos, false);
      const type = readAscii(bytes, pos + 4, 4);
      let headerSize = 8;
      let boxSize = size32;

      if (size32 === 1) {
        if (pos + 16 > end) break;
        const hi = view.getUint32(pos + 8, false);
        const lo = view.getUint32(pos + 12, false);
        boxSize = hi * 4294967296 + lo;
        headerSize = 16;
      } else if (size32 === 0) {
        boxSize = end - pos;
      }

      if (boxSize < headerSize || pos + boxSize > end) break;
      const contentStart = pos + headerSize;
      const boxEnd = pos + boxSize;
      childBoxes.push({type, contentStart, boxEnd});
      pos = boxEnd;
    }

    for (const box of childBoxes) {
      const {type, contentStart, boxEnd} = box;

      if (type === 'idat') {
        idatStart = contentStart;
        idatLength = boxEnd - contentStart;
      } else if (type === 'iinf' && contentStart + 6 <= boxEnd) {
        const version = bytes[contentStart];
        const count =
          version === 0
            ? view.getUint16(contentStart + 4, false)
            : view.getUint32(contentStart + 4, false);
        let p = contentStart + (version === 0 ? 6 : 8);

        for (let i = 0; i < count && p + 8 <= boxEnd; i++) {
          const infeSize = view.getUint32(p, false);
          const infeType = readAscii(bytes, p + 4, 4);
          if (infeSize < 12 || p + infeSize > boxEnd) break;
          if (infeType === 'infe') {
            const infeVer = bytes[p + 8];
            if (infeVer === 0 || infeVer === 1) {
              const itemId = view.getUint16(p + 12, false);
              const nameStart = p + 16;
              let nameEnd = nameStart;
              while (nameEnd < p + infeSize && bytes[nameEnd] !== 0) nameEnd++;
              const itemName = readAscii(bytes, nameStart, nameEnd - nameStart);
              infeItems.push({
                itemId,
                itemType: itemName.toLowerCase().includes('exif') ? 'Exif' : '',
                contentType: '',
                itemName,
              });
            } else if (infeVer >= 2) {
              const idOffset = infeVer === 2 ? p + 12 : p + 12;
              const itemId =
                infeVer === 2
                  ? view.getUint16(idOffset, false)
                  : view.getUint32(idOffset, false);
              const typeOffset = infeVer === 2 ? p + 16 : p + 18;
              const itemType = readAscii(bytes, typeOffset, 4);
              let strPos = typeOffset + 4;
              const readZStr = () => {
                const s0 = strPos;
                while (strPos < p + infeSize && bytes[strPos] !== 0) strPos++;
                const str = readAscii(bytes, s0, strPos - s0);
                strPos++;
                return str;
              };
              const itemName = readZStr();
              const contentType = readZStr();
              infeItems.push({itemId, itemType, contentType, itemName});
            }
          }
          p += infeSize;
        }
      } else if (type === 'iloc' && contentStart + 8 <= boxEnd) {
        const version = bytes[contentStart];
        const b4 = bytes[contentStart + 4];
        const b5 = bytes[contentStart + 5];
        const offsetSize = (b4 >> 4) & 0x0f;
        const lengthSize = b4 & 0x0f;
        const baseOffsetSize = (b5 >> 4) & 0x0f;
        const indexSize = version >= 1 ? b5 & 0x0f : 0;

        let p = contentStart + 6;
        const itemCount =
          version < 2
            ? view.getUint16(p, false)
            : view.getUint32(p, false);
        p += version < 2 ? 2 : 4;

        for (let i = 0; i < itemCount && p + 6 <= boxEnd; i++) {
          const itemId =
            version < 2
              ? view.getUint16(p, false)
              : view.getUint32(p, false);
          p += version < 2 ? 2 : 4;

          let constructionMethod = 0;
          if (version === 1 || version === 2) {
            constructionMethod = view.getUint16(p, false) & 0x0f;
            p += 2;
          }

          p += 2; // data_reference_index
          const baseOffset = readUintBE(bytes, p, baseOffsetSize);
          p += baseOffsetSize;

          if (p + 2 > boxEnd) break;
          const extentCount = view.getUint16(p, false);
          p += 2;

          const extents: IlocExtent[] = [];
          for (let e = 0; e < extentCount && p <= boxEnd; e++) {
            p += indexSize;
            const offset = readUintBE(bytes, p, offsetSize);
            p += offsetSize;
            const length = readUintBE(bytes, p, lengthSize);
            p += lengthSize;
            extents.push({offset, length});
          }
          ilocItems.push({itemId, constructionMethod, baseOffset, extents});
        }
      } else if (type === 'meta') {
        // meta is usually a 4-byte FullBox, but QuickTime sometimes puts child boxes directly at +0
        const atZeroType =
          contentStart + 8 <= boxEnd ? readAscii(bytes, contentStart + 4, 4) : '';
        const metaChildrenStart = KNOWN_META_CHILD_BOXES.has(atZeroType)
          ? contentStart
          : contentStart + 4;
        if (metaChildrenStart < boxEnd) {
          await readBoxes(metaChildrenStart, boxEnd);
        }
      } else if (
        type === 'moov' ||
        type === 'trak' ||
        type === 'mdia' ||
        type === 'udta' ||
        type === 'ilst'
      ) {
        await readBoxes(contentStart, boxEnd);
      } else if (type === '©xyz' || type === 'xyz ') {
        const text = readAscii(bytes, contentStart, Math.min(128, boxEnd - contentStart));
        parseIso6709String(text, bundle);
      }
    }

    // Resolve all Exif and XMP items found in this meta box
    if (infeItems.length > 0 && ilocItems.length > 0) {
      const ilocById = new Map<number, IlocItem>();
      for (const il of ilocItems) ilocById.set(il.itemId, il);

      for (const infe of infeItems) {
        const isExif =
          infe.itemType === 'Exif' ||
          infe.itemName.toLowerCase() === 'exif';
        const isXmp =
          infe.itemType === 'mime' &&
          (infe.contentType.toLowerCase().includes('rdf') ||
            infe.contentType.toLowerCase().includes('xmp'));
        if (!isExif && !isXmp) continue;

        const iloc = ilocById.get(infe.itemId);
        if (!iloc || iloc.extents.length === 0) continue;

        const chunks: Uint8Array[] = [];
        for (const ext of iloc.extents) {
          let absStart = iloc.baseOffset + ext.offset;
          if (iloc.constructionMethod === 1 && idatLength > 0) {
            absStart = idatStart + iloc.baseOffset + ext.offset;
          }
          if (absStart >= 0 && absStart + ext.length <= bytes.length && ext.length > 0) {
            chunks.push(bytes.subarray(absStart, absStart + ext.length));
          }
        }
        if (chunks.length === 0) continue;

        const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
        const itemBytes = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) {
          itemBytes.set(c, offset);
          offset += c.length;
        }

        if (isExif && itemBytes.length >= 12) {
          const tiffHeaderOffset = readUintBE(itemBytes, 0, 4);
          let tiffStart = 4 + tiffHeaderOffset;
          if (
            tiffStart + 8 > itemBytes.length ||
            !(
              (itemBytes[tiffStart] === 0x49 &&
                itemBytes[tiffStart + 1] === 0x49 &&
                itemBytes[tiffStart + 2] === 0x2a &&
                itemBytes[tiffStart + 3] === 0x00) ||
              (itemBytes[tiffStart] === 0x4d &&
                itemBytes[tiffStart + 1] === 0x4d &&
                itemBytes[tiffStart + 2] === 0x00 &&
                itemBytes[tiffStart + 3] === 0x2a)
            )
          ) {
            const iiPos = findSequence(itemBytes.subarray(0, 64), [0x49, 0x49, 0x2a, 0x00]);
            const mmPos = findSequence(itemBytes.subarray(0, 64), [0x4d, 0x4d, 0x00, 0x2a]);
            tiffStart = iiPos >= 0 ? iiPos : mmPos;
          }

          if (tiffStart >= 0 && tiffStart + 8 <= itemBytes.length) {
            await parseTiffSliceWithExifrAndDirect(
              itemBytes,
              tiffStart,
              itemBytes.length - tiffStart,
              bundle
            );
          }
        } else if (isXmp) {
          const xmpText = new TextDecoder('utf-8', {fatal: false}).decode(
            itemBytes
          );
          parseXmpString(xmpText, bundle);
        }
      }
    }
  };

  await readBoxes(0, bytes.length);
  return {isHeicLike};
}

/**
 * Container-agnostic binary scanner for embedded Exif\0\0, PNG eXIf, raw TIFF, and XMP packets.
 */
async function scanBinaryMetadataSignatures(
  bytes: Uint8Array,
  bundle: ExtractedMetaBundle
): Promise<void> {
  // 1. Scan for "Exif\0\0" + TIFF header anywhere (JPEG APP1, HEIC Exif block, WebP EXIF, etc.)
  const exifHeaderNeedle = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  let searchPos = 0;
  let attempts = 0;
  while (
    attempts < 4 &&
    (bundle.lat === undefined || !bundle.exif.dateTimeOriginal)
  ) {
    const idx = findSequence(bytes, exifHeaderNeedle, searchPos);
    if (idx < 0 || idx + 14 > bytes.length) break;
    attempts++;
    const tiffStart = idx + 6;
    await parseTiffSliceWithExifrAndDirect(bytes, tiffStart, 512 * 1024, bundle);
    searchPos = idx + 6;
  }

  // 2. Scan for PNG "eXIf" chunk
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const pngExifIdx = findSequence(bytes, [0x65, 0x58, 0x49, 0x66]);
    if (pngExifIdx >= 4 && pngExifIdx + 12 <= bytes.length) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const chunkLen = view.getUint32(pngExifIdx - 4, false);
      if (chunkLen > 8 && pngExifIdx + 4 + chunkLen <= bytes.length) {
        await parseTiffSliceWithExifrAndDirect(
          bytes,
          pngExifIdx + 4,
          chunkLen,
          bundle
        );
      }
    }
  }

  // 3. Scan for raw TIFF headers (II*\0 or MM\0*) if GPS is still missing
  if (bundle.lat === undefined || bundle.lng === undefined) {
    const rawTiffHeaders = [
      [0x49, 0x49, 0x2a, 0x00],
      [0x4d, 0x4d, 0x00, 0x2a],
    ];
    for (const needle of rawTiffHeaders) {
      let tPos = 0;
      let tTries = 0;
      while (tTries < 6 && (bundle.lat === undefined || bundle.lng === undefined)) {
        const hit = findSequence(bytes, needle, tPos);
        if (hit < 0 || hit + 16 > bytes.length) break;
        tTries++;
        parseTiffBufferDirectly(
          bytes.subarray(hit, Math.min(bytes.length, hit + 512 * 1024)),
          0,
          bundle
        );
        tPos = hit + 4;
      }
    }
  }

  // 4. Scan for XMP XML packets ("<?xpacket" or "<x:xmpmeta")
  if (bundle.lat === undefined || !bundle.exif.dateTimeOriginal || !bundle.exif.make) {
    const xpacketNeedle = [0x3c, 0x3f, 0x78, 0x70, 0x61, 0x63, 0x6b, 0x65, 0x74];
    const xmpMetaNeedle = [0x3c, 0x78, 0x3a, 0x78, 0x6d, 0x70, 0x6d, 0x65, 0x74, 0x61];
    let xPos = findSequence(bytes, xpacketNeedle);
    if (xPos < 0) xPos = findSequence(bytes, xmpMetaNeedle);
    if (xPos >= 0) {
      const endTagNeedle = [0x3c, 0x2f, 0x78, 0x3a, 0x78, 0x6d, 0x70, 0x6d, 0x65, 0x74, 0x61, 0x3e];
      const endHit = findSequence(bytes, endTagNeedle, xPos);
      const endPos =
        endHit > xPos
          ? Math.min(bytes.length, endHit + 24)
          : Math.min(bytes.length, xPos + 256 * 1024);
      const xmpText = new TextDecoder('utf-8', {fatal: false}).decode(
        bytes.subarray(xPos, endPos)
      );
      parseXmpString(xmpText, bundle);
    }
  }
}

async function convertHeicToJpegBlobUrl(file: Blob): Promise<string | undefined> {
  if (typeof window === 'undefined') return undefined;
  try {
    const mod = await import('heic2any');
    const heic2any = mod.default || (mod as unknown as typeof import('heic2any').default);
    const converted = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.85,
    });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    return blob ? URL.createObjectURL(blob) : undefined;
  } catch (err) {
    console.warn('HEIC conversion fallback failed:', err);
    return undefined;
  }
}

export async function generateBrowserCompatiblePreview(
  file: File | Blob,
  isHeicHint = false
): Promise<string | undefined> {
  if (isHeicHint) {
    const convertedUrl = await convertHeicToJpegBlobUrl(file);
    if (convertedUrl) return convertedUrl;
  }

  try {
    const buffer = await file.arrayBuffer();
    const thumb = await exifr.thumbnailUrl(buffer).catch(() => undefined);
    if (thumb) {
      const dims = await readImageDimensions(thumb);
      if (dims.width && dims.height) {
        return thumb;
      }
      URL.revokeObjectURL(thumb);
    }
  } catch {
    // Ignore
  }

  return undefined;
}

export async function parsePhotoFile(file: File): Promise<PhotoItem> {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const previewUrl = URL.createObjectURL(file);
  const bundle: ExtractedMetaBundle = {
    exif: {},
  };

  let isHeicLike =
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.(heic|heif|hif)$/i.test(file.name);

  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Layer 1: Full-buffer exifr parse (with XMP & IPTC enabled and chunked: false)
    const [gps, parsed] = await Promise.all([
      exifr.gps(buffer).catch(() => undefined),
      exifr
        .parse(buffer, {
          tiff: true,
          exif: true,
          gps: true,
          xmp: true,
          iptc: true,
          jfif: true,
          ihdr: true,
          mergeOutput: true,
        })
        .catch(() => undefined),
    ]);

    if (gps && isValidCoordPair(gps.latitude, gps.longitude)) {
      bundle.lat = gps.latitude;
      bundle.lng = gps.longitude;
    }
    mergeParsedObjectIntoBundle(
      parsed as Record<string, unknown> | undefined,
      bundle
    );

    // Layer 2: Dedicated ISOBMFF parser for HEIC / HEIF / AVIF / CR3
    const isoInfo = await extractIsobmffMetadata(bytes, bundle);
    if (isoInfo.isHeicLike) isHeicLike = true;

    // Layer 3: Binary signature fallback (Exif\0\0, PNG eXIf, raw TIFF, XMP)
    if (
      bundle.lat === undefined ||
      bundle.lng === undefined ||
      !bundle.exif.dateTimeOriginal ||
      !bundle.exif.make
    ) {
      await scanBinaryMetadataSignatures(bytes, bundle);
    }

    // Layer 4: Browser-compatible thumbnail / HEIC JPEG conversion if native <img> cannot decode
    const nativeDims = await readImageDimensions(previewUrl);
    if (nativeDims.width && nativeDims.height) {
      if (!bundle.exif.width) bundle.exif.width = nativeDims.width;
      if (!bundle.exif.height) bundle.exif.height = nativeDims.height;
    } else {
      // Browser cannot natively render this format (e.g. HEIC on Chrome/Windows/Android)
      if (isHeicLike) {
        const convertedUrl = await convertHeicToJpegBlobUrl(file);
        if (convertedUrl) {
          const convDims = await readImageDimensions(convertedUrl);
          if (convDims.width && convDims.height) {
            if (bundle.thumbnailUrl) URL.revokeObjectURL(bundle.thumbnailUrl);
            bundle.thumbnailUrl = convertedUrl;
            if (!bundle.exif.width) bundle.exif.width = convDims.width;
            if (!bundle.exif.height) bundle.exif.height = convDims.height;
          } else {
            URL.revokeObjectURL(convertedUrl);
          }
        }
      }

      if (!bundle.thumbnailUrl) {
        const thumbUrl = await exifr.thumbnailUrl(buffer).catch(() => undefined);
        if (thumbUrl) {
          bundle.thumbnailUrl = thumbUrl;
          const tDims = await readImageDimensions(thumbUrl);
          if (!bundle.exif.width && tDims.width) bundle.exif.width = tDims.width;
          if (!bundle.exif.height && tDims.height) bundle.exif.height = tDims.height;
        }
      }
    }
  } catch (err) {
    console.warn('EXIF parse warning for file:', file.name, err);
  }

  const hasGps = isValidCoordPair(bundle.lat, bundle.lng);

  return {
    id,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || (isHeicLike ? 'image/heic' : 'image/*'),
    previewUrl,
    fallbackPreviewUrl: bundle.thumbnailUrl,
    uploadedAt: Date.now(),
    hasGps,
    lat: hasGps ? bundle.lat : undefined,
    lng: hasGps ? bundle.lng : undefined,
    exif: bundle.exif,
    isGeocoding: hasGps,
    isChecked: false,
  };
}

export async function reverseGeocodeCoords(
  lat: number,
  lng: number
): Promise<ResolvedLocation | null> {
  // 1. Try client-side Kakao Maps Geocoder when Kakao Maps SDK is active
  if (typeof window !== 'undefined' && window.kakao?.maps?.services?.Geocoder) {
    const kakaoLoc = await new Promise<ResolvedLocation | null>((resolve) => {
      try {
        const geocoder = new window.kakao!.maps!.services.Geocoder();
        geocoder.coord2Address(lng, lat, (result, status) => {
          if (
            status !== window.kakao?.maps?.services?.Status.OK ||
            !result?.length
          ) {
            resolve(null);
            return;
          }

          const first = result[0];
          const road = first.road_address;
          const lot = first.address;
          const baseAddr = road?.address_name || lot?.address_name || '';
          if (!baseAddr) {
            resolve(null);
            return;
          }

          const buildingSuffix = road?.building_name
            ? ` (${road.building_name})`
            : '';
          const district =
            road?.region_2depth_name ||
            lot?.region_2depth_name ||
            road?.region_1depth_name ||
            lot?.region_1depth_name;
          const town = road?.region_3depth_name || lot?.region_3depth_name;
          const roadShort = road?.road_name
            ? [
                road.road_name,
                [road.main_building_no, road.sub_building_no]
                  .filter(Boolean)
                  .join('-'),
              ]
                .filter(Boolean)
                .join(' ')
            : undefined;
          const shortAddress =
            [district, roadShort || town].filter(Boolean).join(' ') || baseAddr;

          resolve({
            formattedAddress: `${baseAddr}${buildingSuffix}`,
            shortAddress,
            roadAddress: road?.address_name || undefined,
            country: '대한민국',
            locality: district,
            neighborhood: town,
          });
        });
      } catch {
        resolve(null);
      }
    });

    if (kakaoLoc) {
      return kakaoLoc;
    }
  }

  // 2. Fall back to server proxy (Kakao Local REST API or Nominatim)
  try {
    const res = await fetch(
      `/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&lang=ko`
    );

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as ResolvedLocation;

    if (!data.formattedAddress && !data.shortAddress) {
      return null;
    }

    return {
      formattedAddress: data.formattedAddress || data.shortAddress,
      shortAddress: data.shortAddress || data.formattedAddress,
      roadAddress: data.roadAddress,
      granularity: data.granularity,
      country: data.country,
      locality: data.locality,
      neighborhood: data.neighborhood,
      placeId: data.placeId,
      plusCode: data.plusCode,
    };
  } catch (error) {
    console.warn('Reverse geocoding failed:', error);
    return null;
  }
}

export function exportPhotosAsGeoJson(
  photos: PhotoItem[],
  sections: WorkSection[] = [],
  workEntries: WorkEntry[] = []
): void {
  const gpsPhotos = photos.filter(
    (p): p is PhotoItem & {lat: number; lng: number} =>
      p.hasGps && typeof p.lat === 'number' && typeof p.lng === 'number'
  );

  const sectionLookup: Record<string, WorkSection> = {};
  for (const s of sections) {
    sectionLookup[s.id] = s;
  }

  const sectionFeatures = sections
    .map((sec) => {
      const ordered = sortSectionPhotos(
        gpsPhotos.filter((p) => p.sectionId === sec.id)
      );
      if (ordered.length < 2) return null;
      return {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: ordered.map((p) => [p.lng, p.lat]),
        },
        properties: {
          featureType: 'work_section',
          sectionId: sec.id,
          name: sec.name,
          color: sec.color,
          status: sec.status,
          startDate: sec.startDate,
          endDate: sec.endDate,
          photoCount: ordered.length,
        },
      };
    })
    .filter(Boolean);

  const photoFeatures = gpsPhotos.map((p) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [
        p.lng,
        p.lat,
        ...(p.exif.altitude !== undefined ? [p.exif.altitude] : []),
      ],
    },
    properties: {
      featureType: 'photo',
      fileName: p.fileName,
      sectionName: p.sectionId ? sectionLookup[p.sectionId]?.name || '' : '',
      address: p.location?.formattedAddress || '',
      roadAddress: p.location?.roadAddress || '',
      shortAddress: p.location?.shortAddress || '',
      capturedAt: p.exif.dateTimeOriginal || '',
      camera: [p.exif.make, p.exif.model].filter(Boolean).join(' '),
      isChecked: Boolean(p.isChecked),
      isManualLocation: Boolean(p.isManualLocation),
    },
  }));

  const entryFeatures = workEntries.map((entry) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [entry.lng, entry.lat],
    },
    properties: {
      featureType: 'work_entry',
      title: entry.title,
      description: entry.description,
      teamName: entry.teamName,
      workDate: entry.workDate,
      status: entry.status,
      sectionName: entry.sectionId ? sectionLookup[entry.sectionId]?.name || '' : '',
      address: entry.location?.formattedAddress || '',
      attachedPhotoCount: entry.photoIds.length,
    },
  }));

  const geojson = {
    type: 'FeatureCollection',
    features: [...sectionFeatures, ...photoFeatures, ...entryFeatures],
  };

  const blob = new Blob([JSON.stringify(geojson, null, 2)], {
    type: 'application/geo+json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `photoatlas-work-report-${new Date().toISOString().slice(0, 10)}.geojson`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
