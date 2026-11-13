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
    const parsed = new Date(value.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
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
    return {formatted: value};
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

function readImageDimensions(url: string): Promise<{width?: number; height?: number}> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({width: img.naturalWidth, height: img.naturalHeight});
    img.onerror = () => resolve({});
    img.src = url;
  });
}

export async function parsePhotoFile(file: File): Promise<PhotoItem> {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const previewUrl = URL.createObjectURL(file);
  let fallbackPreviewUrl: string | undefined;

  let lat: number | undefined;
  let lng: number | undefined;
  let hasGps = false;
  const exif: PhotoExifData = {};

  try {
    const gps = await exifr.gps(file).catch(() => undefined);
    if (
      gps &&
      typeof gps.latitude === 'number' &&
      typeof gps.longitude === 'number' &&
      Number.isFinite(gps.latitude) &&
      Number.isFinite(gps.longitude) &&
      gps.latitude >= -90 &&
      gps.latitude <= 90 &&
      gps.longitude >= -180 &&
      gps.longitude <= 180
    ) {
      lat = gps.latitude;
      lng = gps.longitude;
      hasGps = true;
    }

    const parsed = await exifr
      .parse(file, {
        tiff: true,
        exif: true,
        gps: true,
        xmp: false,
      })
      .catch(() => undefined);

    if (parsed) {
      if (typeof parsed.Make === 'string') exif.make = parsed.Make.trim();
      if (typeof parsed.Model === 'string') exif.model = parsed.Model.trim();
      if (typeof parsed.LensModel === 'string') exif.lensModel = parsed.LensModel.trim();

      const dateInfo = formatDateInput(
        parsed.DateTimeOriginal || parsed.CreateDate || parsed.ModifyDate
      );
      exif.dateTimeOriginal = dateInfo.formatted;
      exif.timestampMs = dateInfo.timestampMs;

      if (typeof parsed.FocalLength === 'number' && Number.isFinite(parsed.FocalLength)) {
        exif.focalLength = `${Math.round(parsed.FocalLength)}mm`;
      }
      if (typeof parsed.FNumber === 'number' && Number.isFinite(parsed.FNumber)) {
        exif.fNumber = `f/${parsed.FNumber.toFixed(1).replace(/\.0$/, '')}`;
      }
      if (typeof parsed.ExposureTime === 'number') {
        exif.exposureTime = formatExposureTime(parsed.ExposureTime);
      }
      if (typeof parsed.ISO === 'number' && Number.isFinite(parsed.ISO)) {
        exif.iso = parsed.ISO;
      } else if (
        typeof parsed.ISOSpeedRatings === 'number' &&
        Number.isFinite(parsed.ISOSpeedRatings)
      ) {
        exif.iso = parsed.ISOSpeedRatings;
      }

      if (typeof parsed.ExifImageWidth === 'number') exif.width = parsed.ExifImageWidth;
      if (typeof parsed.ExifImageHeight === 'number') exif.height = parsed.ExifImageHeight;
      if (typeof parsed.GPSAltitude === 'number' && Number.isFinite(parsed.GPSAltitude)) {
        const ref = parsed.GPSAltitudeRef === 1 ? -1 : 1;
        exif.altitude = Math.round(parsed.GPSAltitude * ref * 10) / 10;
      }
      if (
        typeof parsed.GPSImgDirection === 'number' &&
        Number.isFinite(parsed.GPSImgDirection)
      ) {
        exif.heading = Math.round(parsed.GPSImgDirection);
      }
    }

    if (
      file.type === 'image/heic' ||
      file.type === 'image/heif' ||
      /\.(heic|heif)$/i.test(file.name)
    ) {
      const thumbUrl = await exifr.thumbnailUrl(file).catch(() => undefined);
      if (thumbUrl) {
        fallbackPreviewUrl = thumbUrl;
      }
    }
  } catch (err) {
    console.warn('EXIF parse warning for file:', file.name, err);
  }

  if (!exif.width || !exif.height) {
    const dims = await readImageDimensions(fallbackPreviewUrl || previewUrl);
    if (dims.width && dims.height) {
      exif.width = dims.width;
      exif.height = dims.height;
    }
  }

  return {
    id,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'image/*',
    previewUrl,
    fallbackPreviewUrl,
    uploadedAt: Date.now(),
    hasGps,
    lat,
    lng,
    exif,
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
