import type {User} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  type FieldValue,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../firebase';
import type {
  PhotoExifData,
  PhotoItem,
  WorkEntry,
  WorkSection,
  WorkStatus,
} from '../types/photo';
import {compressImageUrlToDataUrl} from './imageCompress';

export interface WorkspaceSummary {
  workspaceId: string;
  name: string;
  ownerId: string;
  ownerName: string;
}

export interface WorkspaceMemberInfo {
  uid: string;
  displayName: string;
  role: 'owner' | 'member';
}

export interface SavedWorkspaceLink {
  workspaceId: string;
  workspaceName: string;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

export function sanitizeFirestoreId(raw: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_\-]/g, '-');
  return cleaned.slice(0, 120) || `id-${Date.now()}`;
}

export function isValidWorkspaceId(id: string): boolean {
  return Boolean(id) && id.length <= 128 && VALID_ID_REGEX.test(id);
}

export function getSafeDisplayName(user: User): string {
  const fromName = user.displayName?.trim();
  if (fromName) return fromName.slice(0, 80);
  const fromEmailPrefix = user.email?.split('@')[0]?.trim();
  if (fromEmailPrefix) return fromEmailPrefix.slice(0, 80);
  return '작업팀원';
}

function generateWorkspaceId(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `team-${suffix}`;
}

function sanitizeExif(exif: PhotoExifData): Record<string, string | number> {
  const clean: Record<string, string | number> = {};
  if (typeof exif.make === 'string' && exif.make) clean.make = exif.make.slice(0, 100);
  if (typeof exif.model === 'string' && exif.model) clean.model = exif.model.slice(0, 100);
  if (typeof exif.lensModel === 'string' && exif.lensModel) {
    clean.lensModel = exif.lensModel.slice(0, 120);
  }
  if (typeof exif.dateTimeOriginal === 'string' && exif.dateTimeOriginal) {
    clean.dateTimeOriginal = exif.dateTimeOriginal.slice(0, 64);
  }
  if (typeof exif.timestampMs === 'number' && Number.isFinite(exif.timestampMs)) {
    clean.timestampMs = exif.timestampMs;
  }
  if (typeof exif.focalLength === 'string' && exif.focalLength) {
    clean.focalLength = exif.focalLength.slice(0, 32);
  }
  if (typeof exif.fNumber === 'string' && exif.fNumber) {
    clean.fNumber = exif.fNumber.slice(0, 32);
  }
  if (typeof exif.exposureTime === 'string' && exif.exposureTime) {
    clean.exposureTime = exif.exposureTime.slice(0, 32);
  }
  if (typeof exif.iso === 'number' && Number.isFinite(exif.iso)) {
    clean.iso = exif.iso;
  }
  if (typeof exif.width === 'number' && Number.isFinite(exif.width)) {
    clean.width = exif.width;
  }
  if (typeof exif.height === 'number' && Number.isFinite(exif.height)) {
    clean.height = exif.height;
  }
  if (typeof exif.altitude === 'number' && Number.isFinite(exif.altitude)) {
    clean.altitude = exif.altitude;
  }
  if (typeof exif.heading === 'number' && Number.isFinite(exif.heading)) {
    clean.heading = exif.heading;
  }
  return clean;
}

export async function listUserSavedWorkspaces(
  user: User
): Promise<SavedWorkspaceLink[]> {
  const colPath = `users/${user.uid}/workspaces`;
  try {
    const q = query(
      collection(db, colPath),
      where('userId', '==', user.uid)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() as {workspaceId: string; workspaceName: string};
      return {
        workspaceId: data.workspaceId,
        workspaceName: data.workspaceName,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colPath);
  }
}

export async function createSharedWorkspace(
  user: User,
  workspaceName: string
): Promise<WorkspaceSummary> {
  const workspaceId = generateWorkspaceId();
  const cleanName = (workspaceName.trim() || '공동 현장 작업공간').slice(0, 120);
  const ownerName = getSafeDisplayName(user);
  const wsPath = `workspaces/${workspaceId}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, wsPath), {
      name: cleanName,
      ownerId: user.uid,
      ownerName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, `${wsPath}/members/${user.uid}`), {
      uid: user.uid,
      displayName: ownerName,
      role: 'owner',
      joinedAt: serverTimestamp(),
    });
    batch.set(doc(db, `users/${user.uid}/workspaces/${workspaceId}`), {
      workspaceId,
      workspaceName: cleanName,
      userId: user.uid,
      joinedAt: serverTimestamp(),
    });
    await batch.commit();

    return {
      workspaceId,
      name: cleanName,
      ownerId: user.uid,
      ownerName,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, wsPath);
  }
}

export async function joinSharedWorkspace(
  user: User,
  rawWorkspaceId: string
): Promise<WorkspaceSummary> {
  const workspaceId = rawWorkspaceId.trim();
  if (!isValidWorkspaceId(workspaceId)) {
    throw new Error('올바른 작업공간 코드 형식이 아닙니다.');
  }

  const wsPath = `workspaces/${workspaceId}`;
  let wsSnap;
  try {
    wsSnap = await getDoc(doc(db, wsPath));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, wsPath);
  }

  if (!wsSnap.exists()) {
    throw new Error('해당 코드의 공유 작업공간을 찾을 수 없습니다.');
  }

  const wsData = wsSnap.data() as {
    name: string;
    ownerId: string;
    ownerName: string;
  };
  const displayName = getSafeDisplayName(user);
  const memberPath = `${wsPath}/members/${user.uid}`;

  try {
    const existingMember = await getDoc(doc(db, memberPath));
    const batch = writeBatch(db);
    if (!existingMember.exists()) {
      batch.set(doc(db, memberPath), {
        uid: user.uid,
        displayName,
        role: wsData.ownerId === user.uid ? 'owner' : 'member',
        joinedAt: serverTimestamp(),
      });
    } else {
      batch.update(doc(db, memberPath), {displayName});
    }
    batch.set(doc(db, `users/${user.uid}/workspaces/${workspaceId}`), {
      workspaceId,
      workspaceName: wsData.name.slice(0, 120),
      userId: user.uid,
      joinedAt: serverTimestamp(),
    });
    await batch.commit();

    return {
      workspaceId,
      name: wsData.name,
      ownerId: wsData.ownerId,
      ownerName: wsData.ownerName,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, memberPath);
  }
}

export async function getSharedWorkspaceSummary(
  workspaceId: string
): Promise<WorkspaceSummary | null> {
  if (!isValidWorkspaceId(workspaceId)) return null;
  const wsPath = `workspaces/${workspaceId}`;
  try {
    const snap = await getDoc(doc(db, wsPath));
    if (!snap.exists()) return null;
    const data = snap.data() as {
      name: string;
      ownerId: string;
      ownerName: string;
    };
    return {
      workspaceId,
      name: data.name,
      ownerId: data.ownerId,
      ownerName: data.ownerName,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, wsPath);
  }
}

export async function createSharedSection(
  workspaceId: string,
  user: User,
  section: WorkSection
): Promise<void> {
  const id = sanitizeFirestoreId(section.id);
  const docPath = `workspaces/${workspaceId}/sections/${id}`;
  const payload: Record<string, unknown> = {
    id,
    name: section.name.trim().slice(0, 120) || '작업구간',
    color: section.color.slice(0, 32) || '#2563EB',
    status: section.status,
    startDate: section.startDate.slice(0, 20),
    endDate: section.endDate.slice(0, 20),
    createdBy: user.uid,
    createdAt: section.createdAt,
    updatedAt: serverTimestamp(),
  };
  if (
    typeof section.targetDistanceMeters === 'number' &&
    Number.isFinite(section.targetDistanceMeters) &&
    section.targetDistanceMeters >= 0
  ) {
    payload.targetDistanceMeters = section.targetDistanceMeters;
  }
  if (
    typeof section.targetPhotoCount === 'number' &&
    Number.isFinite(section.targetPhotoCount) &&
    section.targetPhotoCount >= 0
  ) {
    payload.targetPhotoCount = section.targetPhotoCount;
  }
  if (typeof section.memo === 'string' && section.memo.trim()) {
    payload.memo = section.memo.trim().slice(0, 2000);
  }

  try {
    await setDoc(doc(db, docPath), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

export async function updateSharedSection(
  workspaceId: string,
  section: WorkSection
): Promise<void> {
  const id = sanitizeFirestoreId(section.id);
  const docPath = `workspaces/${workspaceId}/sections/${id}`;
  const payload: Record<string, unknown> = {
    name: section.name.trim().slice(0, 120) || '작업구간',
    color: section.color.slice(0, 32) || '#2563EB',
    status: section.status,
    startDate: section.startDate.slice(0, 20),
    endDate: section.endDate.slice(0, 20),
    updatedAt: serverTimestamp(),
    targetDistanceMeters:
      typeof section.targetDistanceMeters === 'number' &&
      Number.isFinite(section.targetDistanceMeters) &&
      section.targetDistanceMeters >= 0
        ? section.targetDistanceMeters
        : deleteField(),
    targetPhotoCount:
      typeof section.targetPhotoCount === 'number' &&
      Number.isFinite(section.targetPhotoCount) &&
      section.targetPhotoCount >= 0
        ? section.targetPhotoCount
        : deleteField(),
    memo:
      typeof section.memo === 'string' && section.memo.trim()
        ? section.memo.trim().slice(0, 2000)
        : deleteField(),
  };

  try {
    await updateDoc(doc(db, docPath), payload as Record<string, FieldValue>);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }
}

export async function removeSharedSection(
  workspaceId: string,
  sectionId: string
): Promise<void> {
  const id = sanitizeFirestoreId(sectionId);
  const docPath = `workspaces/${workspaceId}/sections/${id}`;
  try {
    await deleteDoc(doc(db, docPath));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export async function createSharedPhoto(
  workspaceId: string,
  user: User,
  photo: PhotoItem
): Promise<void> {
  const id = sanitizeFirestoreId(photo.id);
  const docPath = `workspaces/${workspaceId}/photos/${id}`;
  const uploaderName = getSafeDisplayName(user);
  const payload: Record<string, unknown> = {
    id,
    fileName: (photo.fileName || 'photo.jpg').slice(0, 255),
    fileSize: Math.max(0, photo.fileSize || 0),
    mimeType: (photo.mimeType || 'image/jpeg').slice(0, 100),
    uploadedAt: photo.uploadedAt || Date.now(),
    hasGps: Boolean(photo.hasGps),
    exif: sanitizeExif(photo.exif || {}),
    isChecked: Boolean(photo.isChecked),
    uploadedBy: user.uid,
    uploadedByName: uploaderName,
    updatedAt: serverTimestamp(),
  };

  if (typeof photo.isManualLocation === 'boolean') {
    payload.isManualLocation = photo.isManualLocation;
  }
  if (typeof photo.lat === 'number' && Number.isFinite(photo.lat)) {
    payload.lat = photo.lat;
  }
  if (typeof photo.lng === 'number' && Number.isFinite(photo.lng)) {
    payload.lng = photo.lng;
  }
  if (photo.location?.formattedAddress) {
    payload.locationFormatted = photo.location.formattedAddress.slice(0, 400);
  }
  if (photo.location?.shortAddress) {
    payload.locationShort = photo.location.shortAddress.slice(0, 200);
  }
  if (photo.sectionId) {
    payload.sectionId = sanitizeFirestoreId(photo.sectionId);
  }
  if (typeof photo.routeOrder === 'number' && Number.isFinite(photo.routeOrder)) {
    payload.routeOrder = photo.routeOrder;
  }
  if (photo.workEntryId) {
    payload.workEntryId = sanitizeFirestoreId(photo.workEntryId);
  }
  if (photo.teamName) {
    payload.teamName = photo.teamName.slice(0, 80);
  }

  try {
    await setDoc(doc(db, docPath), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }

  // Upload compressed JPEG preview so teammates on any device see the photo
  const sourceUrl = photo.fallbackPreviewUrl || photo.previewUrl;
  if (sourceUrl) {
    const dataUrl = await compressImageUrlToDataUrl(sourceUrl, 1080, 650000);
    if (dataUrl) {
      const mediaPath = `workspaces/${workspaceId}/photoMedia/${id}`;
      try {
        await setDoc(doc(db, mediaPath), {
          photoId: id,
          dataUrl,
          uploadedBy: user.uid,
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, mediaPath);
      }
    }
  }
}

export async function updateSharedPhotoFields(
  workspaceId: string,
  photoId: string,
  updates: {
    isManualLocation?: boolean;
    lat?: number;
    lng?: number;
    locationFormatted?: string | null;
    locationShort?: string | null;
    sectionId?: string | null;
    routeOrder?: number | null;
    workEntryId?: string | null;
    teamName?: string | null;
    isChecked?: boolean;
  }
): Promise<void> {
  const id = sanitizeFirestoreId(photoId);
  const docPath = `workspaces/${workspaceId}/photos/${id}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (updates.isManualLocation !== undefined) {
    payload.isManualLocation = updates.isManualLocation;
  }
  if (updates.lat !== undefined) payload.lat = updates.lat;
  if (updates.lng !== undefined) payload.lng = updates.lng;
  if (updates.locationFormatted !== undefined) {
    payload.locationFormatted = updates.locationFormatted
      ? updates.locationFormatted.slice(0, 400)
      : deleteField();
  }
  if (updates.locationShort !== undefined) {
    payload.locationShort = updates.locationShort
      ? updates.locationShort.slice(0, 200)
      : deleteField();
  }
  if (updates.sectionId !== undefined) {
    payload.sectionId = updates.sectionId
      ? sanitizeFirestoreId(updates.sectionId)
      : deleteField();
  }
  if (updates.routeOrder !== undefined) {
    payload.routeOrder =
      typeof updates.routeOrder === 'number' && Number.isFinite(updates.routeOrder)
        ? updates.routeOrder
        : deleteField();
  }
  if (updates.workEntryId !== undefined) {
    payload.workEntryId = updates.workEntryId
      ? sanitizeFirestoreId(updates.workEntryId)
      : deleteField();
  }
  if (updates.teamName !== undefined) {
    payload.teamName = updates.teamName
      ? updates.teamName.slice(0, 80)
      : deleteField();
  }
  if (updates.isChecked !== undefined) {
    payload.isChecked = updates.isChecked;
  }

  try {
    await updateDoc(doc(db, docPath), payload as Record<string, FieldValue>);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }
}

export async function removeSharedPhoto(
  workspaceId: string,
  photoId: string
): Promise<void> {
  const id = sanitizeFirestoreId(photoId);
  const docPath = `workspaces/${workspaceId}/photos/${id}`;
  const mediaPath = `workspaces/${workspaceId}/photoMedia/${id}`;
  try {
    await Promise.all([
      deleteDoc(doc(db, docPath)),
      deleteDoc(doc(db, mediaPath)),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export async function createSharedWorkEntry(
  workspaceId: string,
  user: User,
  entry: WorkEntry
): Promise<void> {
  const id = sanitizeFirestoreId(entry.id);
  const docPath = `workspaces/${workspaceId}/workEntries/${id}`;
  const payload: Record<string, unknown> = {
    id,
    title: entry.title.trim().slice(0, 200) || '현장 작업',
    description: (entry.description || '').slice(0, 4000),
    teamName: (entry.teamName || '').slice(0, 80),
    workDate: entry.workDate.slice(0, 20),
    status: entry.status,
    lat: entry.lat,
    lng: entry.lng,
    photoIds: entry.photoIds.slice(0, 50).map(sanitizeFirestoreId),
    createdBy: user.uid,
    createdByName: getSafeDisplayName(user),
    createdAt: entry.createdAt,
    updatedAt: serverTimestamp(),
  };

  if (entry.sectionId) {
    payload.sectionId = sanitizeFirestoreId(entry.sectionId);
  }
  if (entry.location?.formattedAddress) {
    payload.locationFormatted = entry.location.formattedAddress.slice(0, 400);
  }
  if (entry.location?.shortAddress) {
    payload.locationShort = entry.location.shortAddress.slice(0, 200);
  }

  try {
    await setDoc(doc(db, docPath), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

export async function updateSharedWorkEntryFields(
  workspaceId: string,
  entryId: string,
  updates: {
    title?: string;
    description?: string;
    teamName?: string;
    workDate?: string;
    status?: WorkStatus;
    sectionId?: string | null;
    lat?: number;
    lng?: number;
    locationFormatted?: string | null;
    locationShort?: string | null;
    photoIds?: string[];
  }
): Promise<void> {
  const id = sanitizeFirestoreId(entryId);
  const docPath = `workspaces/${workspaceId}/workEntries/${id}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (updates.title !== undefined) {
    payload.title = updates.title.trim().slice(0, 200) || '현장 작업';
  }
  if (updates.description !== undefined) {
    payload.description = updates.description.slice(0, 4000);
  }
  if (updates.teamName !== undefined) {
    payload.teamName = updates.teamName.slice(0, 80);
  }
  if (updates.workDate !== undefined) {
    payload.workDate = updates.workDate.slice(0, 20);
  }
  if (updates.status !== undefined) {
    payload.status = updates.status;
  }
  if (updates.sectionId !== undefined) {
    payload.sectionId = updates.sectionId
      ? sanitizeFirestoreId(updates.sectionId)
      : deleteField();
  }
  if (updates.lat !== undefined) payload.lat = updates.lat;
  if (updates.lng !== undefined) payload.lng = updates.lng;
  if (updates.locationFormatted !== undefined) {
    payload.locationFormatted = updates.locationFormatted
      ? updates.locationFormatted.slice(0, 400)
      : deleteField();
  }
  if (updates.locationShort !== undefined) {
    payload.locationShort = updates.locationShort
      ? updates.locationShort.slice(0, 200)
      : deleteField();
  }
  if (updates.photoIds !== undefined) {
    payload.photoIds = updates.photoIds.slice(0, 50).map(sanitizeFirestoreId);
  }

  try {
    await updateDoc(doc(db, docPath), payload as Record<string, FieldValue>);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }
}

export async function removeSharedWorkEntry(
  workspaceId: string,
  entryId: string
): Promise<void> {
  const id = sanitizeFirestoreId(entryId);
  const docPath = `workspaces/${workspaceId}/workEntries/${id}`;
  try {
    await deleteDoc(doc(db, docPath));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export async function clearSharedWorkspaceItems(
  workspaceId: string,
  sectionIds: string[],
  photoIds: string[],
  entryIds: string[]
): Promise<void> {
  const ops: Array<Promise<void>> = [
    ...sectionIds.map((id) => removeSharedSection(workspaceId, id)),
    ...photoIds.map((id) => removeSharedPhoto(workspaceId, id)),
    ...entryIds.map((id) => removeSharedWorkEntry(workspaceId, id)),
  ];
  await Promise.all(ops);
}

export function subscribeToSharedWorkspace(
  workspaceId: string,
  callbacks: {
    onSections: (sections: WorkSection[]) => void;
    onPhotos: (photos: PhotoItem[]) => void;
    onPhotoMedia: (mediaLookup: Record<string, string>) => void;
    onWorkEntries: (entries: WorkEntry[]) => void;
    onMembers: (members: WorkspaceMemberInfo[]) => void;
  }
): () => void {
  const basePath = `workspaces/${workspaceId}`;

  const unsubSections = onSnapshot(
    collection(db, `${basePath}/sections`),
    (snap) => {
      const items: WorkSection[] = snap.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: String(data.id || d.id),
            name: String(data.name || ''),
            color: String(data.color || '#2563EB'),
            status: (data.status as WorkStatus) || 'in_progress',
            startDate: String(data.startDate || ''),
            endDate: String(data.endDate || ''),
            targetDistanceMeters:
              typeof data.targetDistanceMeters === 'number'
                ? data.targetDistanceMeters
                : undefined,
            targetPhotoCount:
              typeof data.targetPhotoCount === 'number'
                ? data.targetPhotoCount
                : undefined,
            memo: typeof data.memo === 'string' ? data.memo : undefined,
            createdAt:
              typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
            createdBy:
              typeof data.createdBy === 'string' ? data.createdBy : undefined,
          };
        })
        .sort((a, b) => a.createdAt - b.createdAt);
      callbacks.onSections(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, `${basePath}/sections`)
  );

  const unsubPhotos = onSnapshot(
    collection(db, `${basePath}/photos`),
    (snap) => {
      const items: PhotoItem[] = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        const locFormatted =
          typeof data.locationFormatted === 'string'
            ? data.locationFormatted
            : undefined;
        const locShort =
          typeof data.locationShort === 'string' ? data.locationShort : undefined;
        return {
          id: String(data.id || d.id),
          fileName: String(data.fileName || ''),
          fileSize: typeof data.fileSize === 'number' ? data.fileSize : 0,
          mimeType: String(data.mimeType || 'image/jpeg'),
          previewUrl: '',
          uploadedAt:
            typeof data.uploadedAt === 'number' ? data.uploadedAt : Date.now(),
          hasGps: Boolean(data.hasGps),
          isManualLocation:
            typeof data.isManualLocation === 'boolean'
              ? data.isManualLocation
              : undefined,
          lat: typeof data.lat === 'number' ? data.lat : undefined,
          lng: typeof data.lng === 'number' ? data.lng : undefined,
          exif: (data.exif as PhotoExifData) || {},
          location:
            locFormatted || locShort
              ? {
                  formattedAddress: locFormatted || locShort || '',
                  shortAddress: locShort || locFormatted || '',
                }
              : undefined,
          sectionId:
            typeof data.sectionId === 'string' ? data.sectionId : undefined,
          routeOrder:
            typeof data.routeOrder === 'number' ? data.routeOrder : undefined,
          workEntryId:
            typeof data.workEntryId === 'string' ? data.workEntryId : undefined,
          teamName:
            typeof data.teamName === 'string' ? data.teamName : undefined,
          isChecked: Boolean(data.isChecked),
          uploadedBy:
            typeof data.uploadedBy === 'string' ? data.uploadedBy : undefined,
          uploadedByName:
            typeof data.uploadedByName === 'string'
              ? data.uploadedByName
              : undefined,
        };
      });
      callbacks.onPhotos(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, `${basePath}/photos`)
  );

  const unsubMedia = onSnapshot(
    collection(db, `${basePath}/photoMedia`),
    (snap) => {
      const lookup: Record<string, string> = {};
      for (const d of snap.docs) {
        const data = d.data() as {photoId?: string; dataUrl?: string};
        if (data.photoId && data.dataUrl) {
          lookup[data.photoId] = data.dataUrl;
        }
      }
      callbacks.onPhotoMedia(lookup);
    },
    (err) =>
      handleFirestoreError(err, OperationType.LIST, `${basePath}/photoMedia`)
  );

  const unsubEntries = onSnapshot(
    collection(db, `${basePath}/workEntries`),
    (snap) => {
      const items: WorkEntry[] = snap.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>;
          const locFormatted =
            typeof data.locationFormatted === 'string'
              ? data.locationFormatted
              : undefined;
          const locShort =
            typeof data.locationShort === 'string' ? data.locationShort : undefined;
          return {
            id: String(data.id || d.id),
            title: String(data.title || ''),
            description: String(data.description || ''),
            teamName: String(data.teamName || ''),
            workDate: String(data.workDate || ''),
            status: (data.status as WorkStatus) || 'in_progress',
            sectionId:
              typeof data.sectionId === 'string' ? data.sectionId : undefined,
            lat: typeof data.lat === 'number' ? data.lat : 0,
            lng: typeof data.lng === 'number' ? data.lng : 0,
            location:
              locFormatted || locShort
                ? {
                    formattedAddress: locFormatted || locShort || '',
                    shortAddress: locShort || locFormatted || '',
                  }
                : undefined,
            photoIds: Array.isArray(data.photoIds)
              ? data.photoIds.map(String)
              : [],
            createdAt:
              typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
            createdBy:
              typeof data.createdBy === 'string' ? data.createdBy : undefined,
            createdByName:
              typeof data.createdByName === 'string'
                ? data.createdByName
                : undefined,
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
      callbacks.onWorkEntries(items);
    },
    (err) =>
      handleFirestoreError(err, OperationType.LIST, `${basePath}/workEntries`)
  );

  const unsubMembers = onSnapshot(
    collection(db, `${basePath}/members`),
    (snap) => {
      const items: WorkspaceMemberInfo[] = snap.docs.map((d) => {
        const data = d.data() as {
          uid?: string;
          displayName?: string;
          role?: 'owner' | 'member';
        };
        return {
          uid: data.uid || d.id,
          displayName: data.displayName || '작업팀원',
          role: data.role || 'member',
        };
      });
      callbacks.onMembers(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, `${basePath}/members`)
  );

  return () => {
    unsubSections();
    unsubPhotos();
    unsubMedia();
    unsubEntries();
    unsubMembers();
  };
}
