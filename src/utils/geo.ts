import type {DateRangeFilter, PhotoItem, WorkEntry, WorkSection} from '../types/photo';

export const SECTION_COLORS = [
  '#2563EB', // Cobalt Blue
  '#059669', // Emerald
  '#D97706', // Amber
  '#E11D48', // Crimson
  '#7C3AED', // Violet
  '#0D9488', // Teal
  '#EA580C', // Orange
  '#4F46E5', // Indigo
];

export function toDateInputString(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getPhotoDateKey(photo: PhotoItem): string {
  return toDateInputString(photo.exif.timestampMs ?? photo.uploadedAt);
}

export function isDateInRange(dateStr: string, range: DateRangeFilter): boolean {
  if (!range.startDate && !range.endDate) return true;
  if (range.startDate && dateStr < range.startDate) return false;
  if (range.endDate && dateStr > range.endDate) return false;
  return true;
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function calculateOrderedPathMeters(
  points: Array<{lat: number; lng: number}>
): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng
    );
  }
  return total;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

export type SectionConnectionMode =
  | 'section-order'
  | 'nearest-chain'
  | 'chronological';

export function sortSectionPhotos<T extends PhotoItem>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const hasOrderA = typeof a.routeOrder === 'number';
    const hasOrderB = typeof b.routeOrder === 'number';
    if (hasOrderA && hasOrderB && a.routeOrder !== b.routeOrder) {
      return (a.routeOrder as number) - (b.routeOrder as number);
    }
    if (hasOrderA !== hasOrderB) {
      return hasOrderA ? -1 : 1;
    }
    const ta = a.exif.timestampMs ?? a.uploadedAt;
    const tb = b.exif.timestampMs ?? b.uploadedAt;
    return ta - tb;
  });
}

/**
 * Produces an ordered list of photo IDs when merging multiple sections across
 * different locations so road connections follow the user's chosen sequence.
 */
export function buildConnectedPhotoOrder(
  photos: PhotoItem[],
  orderedSectionIds: string[],
  mode: SectionConnectionMode
): string[] {
  const idSet = new Set(orderedSectionIds);
  const targetPhotos = photos.filter(
    (p) => p.sectionId && idSet.has(p.sectionId)
  );
  if (targetPhotos.length === 0) return [];

  if (mode === 'chronological') {
    return [...targetPhotos]
      .sort(
        (a, b) =>
          (a.exif.timestampMs ?? a.uploadedAt) -
          (b.exif.timestampMs ?? b.uploadedAt)
      )
      .map((p) => p.id);
  }

  if (mode === 'nearest-chain') {
    const gpsPool = targetPhotos.filter(
      (p): p is PhotoItem & {lat: number; lng: number} =>
        p.hasGps && typeof p.lat === 'number' && typeof p.lng === 'number'
    );
    const nonGpsPool = targetPhotos.filter(
      (p) => !p.hasGps || typeof p.lat !== 'number' || typeof p.lng !== 'number'
    );

    if (gpsPool.length === 0) {
      return targetPhotos.map((p) => p.id);
    }

    // Start from the first photo of the first selected section
    const firstSecPhotos = sortSectionPhotos(
      gpsPool.filter((p) => p.sectionId === orderedSectionIds[0])
    );
    const startPhoto = firstSecPhotos[0] || gpsPool[0];
    const remaining = new Set(gpsPool.map((p) => p.id));
    const lookup: Record<string, PhotoItem & {lat: number; lng: number}> = {};
    for (const p of gpsPool) lookup[p.id] = p;

    const ordered: string[] = [startPhoto.id];
    remaining.delete(startPhoto.id);
    let current = startPhoto;

    while (remaining.size > 0) {
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const candidateId of remaining) {
        const cand = lookup[candidateId];
        const d = haversineMeters(current.lat, current.lng, cand.lat, cand.lng);
        if (d < bestDist) {
          bestDist = d;
          bestId = candidateId;
        }
      }
      if (!bestId) break;
      ordered.push(bestId);
      remaining.delete(bestId);
      current = lookup[bestId];
    }

    for (const p of sortSectionPhotos(nonGpsPool)) {
      ordered.push(p.id);
    }
    return ordered;
  }

  // 'section-order': connect each selected section end-to-end in user's chosen order
  const result: string[] = [];
  for (const secId of orderedSectionIds) {
    const secPhotos = sortSectionPhotos(
      targetPhotos.filter((p) => p.sectionId === secId)
    );
    for (const p of secPhotos) {
      result.push(p.id);
    }
  }
  return result;
}

/**
 * Automatically groups GPS-tagged photos into work sections based on
 * date and spatial proximity (> 1.5 km gap or > 4 hour gap starts a new section).
 */
export function autoClusterPhotosIntoSections(
  photos: PhotoItem[],
  existingSections: WorkSection[]
): {
  sections: WorkSection[];
  assignments: Record<string, string>;
} {
  const gpsPhotos = photos
    .filter(
      (p): p is PhotoItem & {lat: number; lng: number} =>
        p.hasGps && typeof p.lat === 'number' && typeof p.lng === 'number'
    )
    .sort((a, b) => {
      const ta = a.exif.timestampMs ?? a.uploadedAt;
      const tb = b.exif.timestampMs ?? b.uploadedAt;
      return ta - tb;
    });

  if (gpsPhotos.length === 0) {
    return {sections: existingSections, assignments: {}};
  }

  const MAX_GAP_METERS = 1500;
  const MAX_GAP_MS = 4 * 60 * 60 * 1000;

  const clusters: Array<Array<PhotoItem & {lat: number; lng: number}>> = [];
  let currentCluster: Array<PhotoItem & {lat: number; lng: number}> = [gpsPhotos[0]];

  for (let i = 1; i < gpsPhotos.length; i++) {
    const prev = gpsPhotos[i - 1];
    const curr = gpsPhotos[i];
    const dist = haversineMeters(prev.lat, prev.lng, curr.lat, curr.lng);
    const prevTime = prev.exif.timestampMs ?? prev.uploadedAt;
    const currTime = curr.exif.timestampMs ?? curr.uploadedAt;
    const timeDiff = Math.abs(currTime - prevTime);
    const sameDay = getPhotoDateKey(prev) === getPhotoDateKey(curr);

    if (dist > MAX_GAP_METERS || (!sameDay && timeDiff > MAX_GAP_MS)) {
      clusters.push(currentCluster);
      currentCluster = [curr];
    } else {
      currentCluster.push(curr);
    }
  }
  clusters.push(currentCluster);

  const newSections: WorkSection[] = [];
  const assignments: Record<string, string> = {};

  clusters.forEach((cluster, index) => {
    const existing = existingSections[index];
    const dates = cluster.map((p) => getPhotoDateKey(p)).sort();
    const firstLoc =
      cluster.find((p) => p.location?.locality || p.location?.shortAddress)
        ?.location?.locality ||
      cluster.find((p) => p.location?.shortAddress)?.location?.shortAddress;

    const sectionId =
      existing?.id ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `sec-${Date.now()}-${index}`);

    const color =
      existing?.color || SECTION_COLORS[index % SECTION_COLORS.length];

    const defaultName = firstLoc
      ? `${index + 1}구간 · ${firstLoc}`
      : `작업구간 ${index + 1}`;

    const section: WorkSection = {
      id: sectionId,
      name: existing?.name || defaultName,
      color,
      status: existing?.status || 'in_progress',
      startDate: existing?.startDate || dates[0],
      endDate: existing?.endDate || dates[dates.length - 1],
      targetDistanceMeters: existing?.targetDistanceMeters,
      targetPhotoCount: existing?.targetPhotoCount || cluster.length,
      memo: existing?.memo,
      createdAt: existing?.createdAt || Date.now(),
    };

    newSections.push(section);
    for (const p of cluster) {
      assignments[p.id] = sectionId;
    }
  });

  return {sections: newSections, assignments};
}

export interface SectionProgressSummary {
  totalPhotos: number;
  checkedPhotos: number;
  totalEntries: number;
  completedEntries: number;
  measuredDistanceMeters: number;
  progressPercent: number;
  uniqueDates: string[];
}

export function computeSectionProgress(
  section: WorkSection,
  photos: PhotoItem[],
  entries: WorkEntry[],
  dateRange: DateRangeFilter,
  roadDistanceMeters?: number
): SectionProgressSummary {
  const sectionPhotos = photos.filter((p) => {
    if (p.sectionId !== section.id) return false;
    return isDateInRange(getPhotoDateKey(p), dateRange);
  });

  const sectionEntries = entries.filter((e) => {
    if (e.sectionId !== section.id) return false;
    return isDateInRange(e.workDate, dateRange);
  });

  const gpsOrdered = sortSectionPhotos(
    sectionPhotos.filter(
      (p): p is PhotoItem & {lat: number; lng: number} =>
        p.hasGps && typeof p.lat === 'number' && typeof p.lng === 'number'
    )
  );

  const fallbackDist = calculateOrderedPathMeters(gpsOrdered);
  const measuredDistanceMeters = roadDistanceMeters ?? fallbackDist;

  const checkedPhotos = sectionPhotos.filter((p) => p.isChecked).length;
  const completedEntries = sectionEntries.filter(
    (e) => e.status === 'completed'
  ).length;

  const dateSet: Record<string, true> = {};
  for (const p of sectionPhotos) dateSet[getPhotoDateKey(p)] = true;
  for (const e of sectionEntries) dateSet[e.workDate] = true;
  const uniqueDates = Object.keys(dateSet).sort();

  let progressPercent = 0;
  if (section.status === 'completed') {
    progressPercent = 100;
  } else if (section.targetDistanceMeters && section.targetDistanceMeters > 0) {
    progressPercent = Math.min(
      100,
      Math.round((measuredDistanceMeters / section.targetDistanceMeters) * 100)
    );
  } else {
    const totalUnits =
      (section.targetPhotoCount && section.targetPhotoCount > 0
        ? Math.max(section.targetPhotoCount, sectionPhotos.length)
        : sectionPhotos.length) + sectionEntries.length;
    const doneUnits = checkedPhotos + completedEntries;
    if (totalUnits > 0) {
      progressPercent = Math.min(100, Math.round((doneUnits / totalUnits) * 100));
    }
  }

  return {
    totalPhotos: sectionPhotos.length,
    checkedPhotos,
    totalEntries: sectionEntries.length,
    completedEntries,
    measuredDistanceMeters,
    progressPercent,
    uniqueDates,
  };
}
