import {Check, Crosshair, MapPin, Upload, X} from 'lucide-react';
import {useRef, useState} from 'react';
import type {PhotoItem, WorkEntry, WorkSection, WorkStatus} from '../types/photo';
import {formatDecimalCoords} from '../utils/exif';
import {extractFilesFromDataTransfer} from '../utils/fileDrop';
import {toDateInputString} from '../utils/geo';
import {PhotoThumbnail} from './PhotoThumbnail';

interface WorkEntryModalProps {
  initialEntry?: WorkEntry | null;
  pickedCoords?: {lat: number; lng: number} | null;
  sections: WorkSection[];
  photos: PhotoItem[];
  onClose: () => void;
  onRequestMapPick: () => void;
  onUploadAttachPhotos: (files: FileList | File[]) => Promise<PhotoItem[]>;
  onSave: (
    data: {
      title: string;
      description: string;
      teamName: string;
      workDate: string;
      status: WorkStatus;
      sectionId?: string;
      lat: number;
      lng: number;
      photoIds: string[];
    },
    existingId?: string
  ) => void;
}

export function WorkEntryModal({
  initialEntry,
  pickedCoords,
  sections,
  photos,
  onClose,
  onRequestMapPick,
  onUploadAttachPhotos,
  onSave,
}: WorkEntryModalProps) {
  const today = toDateInputString(Date.now());
  const [title, setTitle] = useState(initialEntry?.title || '');
  const [description, setDescription] = useState(initialEntry?.description || '');
  const [teamName, setTeamName] = useState(initialEntry?.teamName || '');
  const [workDate, setWorkDate] = useState(initialEntry?.workDate || today);
  const [status, setStatus] = useState<WorkStatus>(
    initialEntry?.status || 'completed'
  );
  const [sectionId, setSectionId] = useState(
    initialEntry?.sectionId || sections[0]?.id || ''
  );
  const [coords, setCoords] = useState<{lat: number; lng: number} | null>(
    pickedCoords ||
      (initialEntry
        ? {lat: initialEntry.lat, lng: initialEntry.lng}
        : null)
  );
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>(
    initialEntry?.photoIds || []
  );
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOverAttach, setIsDragOverAttach] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const togglePhotoId = (id: string) => {
    setSelectedPhotoIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    const photo = photos.find((p) => p.id === id);
    if (!coords && photo?.hasGps && photo.lat !== undefined && photo.lng !== undefined) {
      setCoords({lat: photo.lat, lng: photo.lng});
    }
  };

  const handleAttachFiles = async (fileList: FileList | File[] | null) => {
    const count = fileList ? fileList.length : 0;
    if (!fileList || count === 0) return;
    setIsUploading(true);
    setErrorMsg(null);
    try {
      const newlyUploaded = await onUploadAttachPhotos(fileList);
      if (newlyUploaded.length > 0) {
        setSelectedPhotoIds((prev) => [
          ...prev,
          ...newlyUploaded.map((p) => p.id),
        ]);
        const firstGps = newlyUploaded.find(
          (p) => p.hasGps && p.lat !== undefined && p.lng !== undefined
        );
        if (!coords && firstGps && firstGps.lat !== undefined && firstGps.lng !== undefined) {
          setCoords({lat: firstGps.lat, lng: firstGps.lng});
        }
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('작업 제목을 입력해 주세요.');
      return;
    }
    if (!coords) {
      setErrorMsg('지도에서 위치를 선택하거나 GPS 사진을 첨부해 좌표를 지정해 주세요.');
      return;
    }

    onSave(
      {
        title: title.trim(),
        description: description.trim(),
        teamName: teamName.trim() || '현장 작업팀',
        workDate: workDate || today,
        status,
        sectionId: sectionId || undefined,
        lat: coords.lat,
        lng: coords.lng,
        photoIds: selectedPhotoIds,
      },
      initialEntry?.id
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold text-slate-900">
            {initialEntry ? '지도 작업 기록 수정' : '지도에 작업 기록 및 사진 첨부'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          {errorMsg && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {errorMsg}
            </div>
          )}

          {/* Location Picker Row */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500">작업 위치 좌표</p>
              {coords ? (
                <p className="text-xs font-mono font-medium text-slate-900 tabular-nums mt-0.5 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  {formatDecimalCoords(coords.lat, coords.lng)}
                </p>
              ) : (
                <p className="text-xs text-amber-700 mt-0.5">
                  위치가 아직 지정되지 않았습니다
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onRequestMapPick}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:border-blue-500 text-xs font-medium text-slate-700 hover:text-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Crosshair className="w-3.5 h-3.5" />
              {coords ? '지도에서 변경' : '지도 클릭 지정'}
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              작업 내용 제목
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 배수로 정비 및 노면 복구 완료"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                작업팀 / 담당자
              </label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="예: 현장 A팀"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                작업 일자
              </label>
              <input
                type="date"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                소속 작업구간
              </label>
              <select
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-blue-600"
              >
                <option value="">구간 미지정</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                작업 상태
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as WorkStatus)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-blue-600"
              >
                <option value="planned">예정</option>
                <option value="in_progress">진행중</option>
                <option value="completed">작업 완료</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              상세 작업 내역
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="작업 범위, 자재 사용 내역, 특이사항 등을 입력하세요"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 resize-none"
            />
          </div>

          {/* Photo Attachments */}
          <div
            className={`space-y-2 rounded-xl p-2.5 -mx-1 border transition-colors ${
              isDragOverAttach
                ? 'border-blue-500 bg-blue-50/70'
                : 'border-transparent'
            }`}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOverAttach(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
              }
              setIsDragOverAttach(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setIsDragOverAttach(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOverAttach(false);
              if (e.dataTransfer) {
                void extractFilesFromDataTransfer(e.dataTransfer).then((files) => {
                  if (files.length > 0) {
                    void handleAttachFiles(files);
                  }
                });
              }
            }}
          >
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700">
                작업 사진 첨부 ({selectedPhotoIds.length}장 선택됨)
              </label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium transition-colors cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                {isUploading ? '불러오는 중...' : '새 사진 추가'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.heic,.heif,.hif,.avif,.tiff,.tif,.dng,.cr2,.cr3,.nef,.arw"
                className="hidden"
                onChange={(e) => {
                  void handleAttachFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            {photos.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
                {isDragOverAttach
                  ? '여기에 놓으면 작업 기록에 바로 첨부됩니다'
                  : '사진 파일 또는 폴더를 여기로 드래그하거나 위 ‘새 사진 추가’ 버튼을 눌러 첨부하세요.'}
              </p>
            ) : (
              <div className="grid grid-cols-5 gap-2 max-h-36 overflow-y-auto p-1 border border-slate-200 rounded-lg bg-slate-50/50">
                {photos.map((photo) => {
                  const selected = selectedPhotoIds.includes(photo.id);
                  return (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => togglePhotoId(photo.id)}
                      title={photo.fileName}
                      className={`relative aspect-square rounded-md overflow-hidden border transition-all cursor-pointer ${
                        selected
                          ? 'ring-2 ring-blue-600 border-blue-600'
                          : 'border-slate-200 opacity-75 hover:opacity-100'
                      }`}
                    >
                      <PhotoThumbnail
                        src={photo.previewUrl}
                        fallbackSrc={photo.fallbackPreviewUrl}
                        alt={photo.fileName}
                        className="w-full h-full object-cover"
                      />
                      {selected && (
                        <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors cursor-pointer"
            >
              {initialEntry ? '작업 기록 저장' : '지도에 등록'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
