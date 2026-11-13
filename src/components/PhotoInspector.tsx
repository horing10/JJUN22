import {
  Camera,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Compass,
  Copy,
  Crosshair,
  Edit3,
  ExternalLink,
  MapPin,
  MapPinOff,
  X,
} from 'lucide-react';
import {useState} from 'react';
import type {PhotoItem, WorkEntry, WorkSection} from '../types/photo';
import {
  formatDecimalCoords,
  formatDmsCoords,
  formatFileSize,
} from '../utils/exif';
import {PhotoThumbnail} from './PhotoThumbnail';

interface PhotoInspectorProps {
  photo: PhotoItem | null;
  workEntry: WorkEntry | null;
  allPhotos: PhotoItem[];
  sections: WorkSection[];
  isAssigningManualPin: boolean;
  onClose: () => void;
  onStartManualPin: (photoId: string) => void;
  onTogglePhotoChecked: (photoId: string) => void;
  onAssignPhotoSection: (photoId: string, sectionId: string) => void;
  onEditWorkEntry: (entry: WorkEntry) => void;
  onToggleEntryStatus: (entryId: string) => void;
  onSelectPhotoFromEntry: (photoId: string) => void;
  onFocusOnMap: () => void;
  onOpenRoadview?: (target: {lat: number; lng: number; label?: string}) => void;
}

export function PhotoInspector({
  photo,
  workEntry,
  allPhotos,
  sections,
  isAssigningManualPin,
  onClose,
  onStartManualPin,
  onTogglePhotoChecked,
  onAssignPhotoSection,
  onEditWorkEntry,
  onToggleEntryStatus,
  onSelectPhotoFromEntry,
  onFocusOnMap,
  onOpenRoadview,
}: PhotoInspectorProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyCoords = async (lat: number, lng: number) => {
    try {
      await navigator.clipboard.writeText(formatDecimalCoords(lat, lng));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable
    }
  };

  if (!photo && !workEntry) return null;

  // WORK ENTRY INSPECTOR
  if (workEntry) {
    const attachedPhotos = allPhotos.filter((p) =>
      workEntry.photoIds.includes(p.id)
    );
    const sec = sections.find((s) => s.id === workEntry.sectionId);

    return (
      <div className="absolute bottom-3 left-3 right-3 sm:left-auto sm:right-3 sm:w-[376px] z-20 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-[72vh] flex flex-col">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardCheck className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="text-xs font-semibold text-slate-800 truncate">
              지도 작업 기록
            </span>
          </div>
          <button
            type="button"
            aria-label="상세 패널 닫기"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3.5">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">
                {workEntry.title}
              </h3>
              <button
                type="button"
                onClick={() => onToggleEntryStatus(workEntry.id)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer shrink-0 ${
                  workEntry.status === 'completed'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {workEntry.status === 'completed' ? '완료됨' : '진행중'}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1 tabular-nums">
              {workEntry.teamName} · {workEntry.workDate}
              {sec ? ` · ${sec.name}` : ''}
            </p>
          </div>

          {workEntry.description && (
            <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 border border-slate-200/80 rounded-lg p-2.5">
              {workEntry.description}
            </p>
          )}

          <div className="space-y-1">
            <p className="text-[11px] font-medium text-slate-500">작업 위치 주소</p>
            <p className="text-xs font-medium text-slate-900">
              {workEntry.isGeocoding
                ? '정확한 주소 판별 중...'
                : workEntry.location?.formattedAddress ||
                  '좌표 위치 확인됨'}
            </p>
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 tabular-nums">
              <span>{formatDecimalCoords(workEntry.lat, workEntry.lng)}</span>
              <button
                type="button"
                onClick={() => handleCopyCoords(workEntry.lat, workEntry.lng)}
                className="inline-flex items-center gap-1 text-slate-600 hover:text-blue-600 cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                {copied ? '복사됨' : '복사'}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-700">
              첨부된 현장 사진 ({attachedPhotos.length}장)
            </p>
            {attachedPhotos.length === 0 ? (
              <p className="text-xs text-slate-400">첨부된 사진이 없습니다.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {attachedPhotos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectPhotoFromEntry(p.id)}
                    className="aspect-square rounded-lg overflow-hidden border border-slate-200 hover:ring-2 hover:ring-blue-600 cursor-pointer"
                  >
                    <PhotoThumbnail
                      src={p.previewUrl}
                      fallbackSrc={p.fallbackPreviewUrl}
                      alt={p.fileName}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onFocusOnMap}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium cursor-pointer"
            >
              <MapPin className="w-3.5 h-3.5" />
              위치로 이동
            </button>
            {onOpenRoadview && (
              <button
                type="button"
                onClick={() =>
                  onOpenRoadview({
                    lat: workEntry.lat,
                    lng: workEntry.lng,
                    label: workEntry.location?.shortAddress || workEntry.title,
                  })
                }
                className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-xs font-medium text-blue-700 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Compass className="w-3.5 h-3.5" />
                로드뷰
              </button>
            )}
            <button
              type="button"
              onClick={() => onEditWorkEntry(workEntry)}
              className="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Edit3 className="w-3.5 h-3.5" />
              수정·사진추가
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!photo) return null;

  // PHOTO INSPECTOR
  const cameraLine = [photo.exif.make, photo.exif.model].filter(Boolean).join(' ');
  const exposureSummary = [
    photo.exif.focalLength,
    photo.exif.fNumber,
    photo.exif.exposureTime,
    photo.exif.iso ? `ISO ${photo.exif.iso}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="absolute bottom-3 left-3 right-3 sm:left-auto sm:right-3 sm:w-[376px] z-20 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-[72vh] flex flex-col">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-500 truncate">
          {photo.fileName}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onTogglePhotoChecked(photo.id)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
              photo.isChecked
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            {photo.isChecked ? '확인 완료' : '확인 체크'}
          </button>
          <button
            type="button"
            aria-label="상세 패널 닫기"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="overflow-y-auto p-4 space-y-3.5">
        <div className="relative w-full h-44 rounded-lg overflow-hidden bg-slate-100 border border-slate-200/70">
          <PhotoThumbnail
            src={photo.previewUrl}
            fallbackSrc={photo.fallbackPreviewUrl}
            alt={photo.fileName}
            className="w-full h-full object-cover"
          />
        </div>

        {/* Section Assignment */}
        {sections.length > 0 && (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-500 font-medium">소속 작업구간</span>
            <select
              value={photo.sectionId || ''}
              onChange={(e) => onAssignPhotoSection(photo.id, e.target.value)}
              className="px-2.5 py-1 border border-slate-200 rounded-md bg-white text-slate-800 text-xs focus:outline-none focus:border-blue-600 cursor-pointer"
            >
              <option value="">구간 미지정</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Location Section */}
        {photo.hasGps && photo.lat !== undefined && photo.lng !== undefined ? (
          <div className="space-y-2">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-blue-600">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {photo.isManualLocation ? '수동 지정 위치' : 'EXIF 정확한 주소'}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mt-1 leading-snug">
                {photo.isGeocoding
                  ? '정확한 주소를 판별하는 중...'
                  : photo.location?.formattedAddress ||
                    photo.location?.shortAddress ||
                    '좌표 위치 확인됨'}
              </h3>
              {photo.location?.plusCode && (
                <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                  Plus Code: {photo.location.plusCode}
                </p>
              )}
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">위도 · 경도</span>
                <button
                  type="button"
                  onClick={() => handleCopyCoords(photo.lat!, photo.lng!)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-blue-600 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600" />
                      복사됨
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      복사
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs font-mono font-medium text-slate-900 tabular-nums">
                {formatDecimalCoords(photo.lat, photo.lng)}
              </p>
              <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                {formatDmsCoords(photo.lat, photo.lng)}
              </p>
              {(photo.exif.altitude !== undefined ||
                photo.exif.heading !== undefined) && (
                <div className="flex items-center gap-2 pt-1 border-t border-slate-200/70 text-[11px] text-slate-600 font-mono tabular-nums">
                  {photo.exif.altitude !== undefined && (
                    <span>고도 {photo.exif.altitude}m</span>
                  )}
                  {photo.exif.altitude !== undefined &&
                    photo.exif.heading !== undefined && (
                      <span aria-hidden="true">·</span>
                    )}
                  {photo.exif.heading !== undefined && (
                    <span>방향 {photo.exif.heading}°</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={onFocusOnMap}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <MapPin className="w-3.5 h-3.5" />
                지도 중앙으로
              </button>
              {onOpenRoadview && (
                <button
                  type="button"
                  onClick={() =>
                    onOpenRoadview({
                      lat: photo.lat!,
                      lng: photo.lng!,
                      label: photo.location?.shortAddress || photo.fileName,
                    })
                  }
                  className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-xs font-medium text-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Compass className="w-3.5 h-3.5" />
                  로드뷰
                </button>
              )}
              <button
                type="button"
                onClick={() => onStartManualPin(photo.id)}
                className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isAssigningManualPin
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                위치 변경
              </button>
              <a
                href={`https://map.kakao.com/link/map/${encodeURIComponent(
                  photo.location?.shortAddress || photo.fileName
                )},${photo.lat},${photo.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                title="카카오맵에서 열기"
                className="inline-flex items-center justify-center p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-blue-600 transition-colors shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        ) : (
          <div className="bg-amber-50/70 border border-amber-200/80 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
              <MapPinOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span>사진에 GPS 위치 정보가 없습니다</span>
            </div>
            <p className="text-xs text-amber-800 leading-relaxed">
              메신저 압축 등으로 GPS가 제거된 사진입니다. 지도를 클릭해 직접 위치를 지정할 수 있습니다.
            </p>
            <button
              type="button"
              onClick={() => onStartManualPin(photo.id)}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900 hover:bg-amber-950 text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <Crosshair className="w-3.5 h-3.5" />
              지도 클릭해서 위치 지정하기
            </button>
          </div>
        )}

        <div className="pt-2.5 border-t border-slate-100 space-y-1.5 text-xs">
          <div className="flex items-center gap-1.5 text-slate-500 font-medium">
            <Camera className="w-3.5 h-3.5" />
            <span>촬영 정보</span>
          </div>
          <dl className="grid grid-cols-[72px_1fr] gap-y-1 gap-x-2 text-xs">
            <dt className="text-slate-400">촬영 일시</dt>
            <dd className="text-slate-700 tabular-nums">
              {photo.exif.dateTimeOriginal || '정보 없음'}
            </dd>
            {cameraLine && (
              <>
                <dt className="text-slate-400">카메라</dt>
                <dd className="text-slate-700 truncate">{cameraLine}</dd>
              </>
            )}
            {exposureSummary && (
              <>
                <dt className="text-slate-400">노출</dt>
                <dd className="text-slate-700 font-mono tabular-nums">
                  {exposureSummary}
                </dd>
              </>
            )}
            <dt className="text-slate-400">파일</dt>
            <dd className="text-slate-700 tabular-nums">
              {photo.exif.width && photo.exif.height
                ? `${photo.exif.width} × ${photo.exif.height} · `
                : ''}
              {formatFileSize(photo.fileSize)}
            </dd>
          </dl>
        </div>
      </div>
    </div>
  );
}
