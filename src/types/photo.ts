export type MapLayerType = 'roadmap' | 'satellite' | 'hybrid' | 'terrain';

export type PhotoFilter = 'all' | 'with-gps' | 'without-gps';

export type PhotoSort = 'captured-desc' | 'captured-asc' | 'uploaded-desc' | 'name-asc';

export type SidebarTab = 'sections' | 'photos' | 'entries';

export type WorkStatus = 'planned' | 'in_progress' | 'completed';

export interface PhotoExifData {
  make?: string;
  model?: string;
  lensModel?: string;
  dateTimeOriginal?: string;
  timestampMs?: number;
  focalLength?: string;
  fNumber?: string;
  exposureTime?: string;
  iso?: number;
  width?: number;
  height?: number;
  altitude?: number;
  heading?: number;
}

export interface ResolvedLocation {
  formattedAddress: string;
  shortAddress: string;
  roadAddress?: string;
  granularity?: string;
  country?: string;
  locality?: string;
  neighborhood?: string;
  placeId?: string;
  plusCode?: string;
}

export interface PhotoItem {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  previewUrl: string;
  fallbackPreviewUrl?: string;
  uploadedAt: number;
  hasGps: boolean;
  isManualLocation?: boolean;
  lat?: number;
  lng?: number;
  exif: PhotoExifData;
  location?: ResolvedLocation;
  isGeocoding?: boolean;
  sectionId?: string;
  routeOrder?: number;
  workEntryId?: string;
  teamName?: string;
  isChecked?: boolean;
  uploadedBy?: string;
  uploadedByName?: string;
}

export interface WorkSection {
  id: string;
  name: string;
  color: string;
  status: WorkStatus;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  targetDistanceMeters?: number;
  targetPhotoCount?: number;
  memo?: string;
  createdAt: number;
  createdBy?: string;
}

export interface WorkEntry {
  id: string;
  title: string;
  description: string;
  teamName: string;
  workDate: string; // YYYY-MM-DD
  status: WorkStatus;
  sectionId?: string;
  lat: number;
  lng: number;
  location?: ResolvedLocation;
  isGeocoding?: boolean;
  photoIds: string[];
  createdAt: number;
  createdBy?: string;
  createdByName?: string;
}

export interface DateRangeFilter {
  startDate: string; // YYYY-MM-DD or ''
  endDate: string;   // YYYY-MM-DD or ''
}
