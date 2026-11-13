import {
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  ClipboardList,
  Download,
  Edit3,
  FileText,
  FolderPlus,
  GitMerge,
  MapPin,
  MapPinOff,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import {useEffect, useState} from 'react';
import type {
  DateRangeFilter,
  PhotoFilter,
  PhotoItem,
  PhotoSort,
  SidebarTab,
  WorkEntry,
  WorkSection,
  WorkStatus,
} from '../types/photo';
import {formatDecimalCoords, formatFileSize} from '../utils/exif';
import {
  formatDistance,
  getPhotoDateKey,
  toDateInputString,
  type SectionProgressSummary,
} from '../utils/geo';
import {PhotoThumbnail} from './PhotoThumbnail';

interface PhotoSidebarProps {
  activeTab: SidebarTab;
  photos: PhotoItem[];
  filteredPhotos: PhotoItem[];
  sections: WorkSection[];
  allSections: WorkSection[];
  workEntries: WorkEntry[];
  filteredEntries: WorkEntry[];
  activeSectionId: string | null;
  selectedPhotoId: string | null;
  selectedEntryId: string | null;
  filter: PhotoFilter;
  sort: PhotoSort;
  dateRange: DateRangeFilter;
  isParsing: boolean;
  sectionProgressLookup: Record<string, SectionProgressSummary>;
  onTabChange: (tab: SidebarTab) => void;
  onFilterChange: (filter: PhotoFilter) => void;
  onSortChange: (sort: PhotoSort) => void;
  onDateRangeChange: (range: DateRangeFilter) => void;
  onSelectSectionFilter: (sectionId: string | null) => void;
  onOpenNewSection: () => void;
  onOpenMergeSections: () => void;
  onEditSection: (section: WorkSection) => void;
  onDeleteSection: (sectionId: string) => void;
  onAutoClusterSections: () => void;
  onSelectPhoto: (id: string) => void;
  onTogglePhotoChecked: (id: string) => void;
  onAssignPhotoSection: (photoId: string, sectionId: string) => void;
  onHoverPhoto: (id: string | null) => void;
  onDeletePhoto: (id: string) => void;
  onSelectEntry: (id: string) => void;
  onToggleEntryStatus: (id: string) => void;
  onDeleteEntry: (id: string) => void;
  onOpenNewWorkEntry: () => void;
  onClearAll: () => void;
  onTriggerUpload: () => void;
  onExportGeoJson: () => void;
  onOpenPdfExport: () => void;
}

const STATUS_LABELS: Record<WorkStatus, string> = {
  planned: '예정',
  in_progress: '진행중',
  completed: '완료',
};

export function PhotoSidebar({
  activeTab,
  photos,
  filteredPhotos,
  sections,
  allSections,
  workEntries,
  filteredEntries,
  activeSectionId,
  selectedPhotoId,
  selectedEntryId,
  filter,
  sort,
  dateRange,
  isParsing,
  sectionProgressLookup,
  onTabChange,
  onFilterChange,
  onSortChange,
  onDateRangeChange,
  onSelectSectionFilter,
  onOpenNewSection,
  onOpenMergeSections,
  onEditSection,
  onDeleteSection,
  onAutoClusterSections,
  onSelectPhoto,
  onTogglePhotoChecked,
  onAssignPhotoSection,
  onHoverPhoto,
  onDeletePhoto,
  onSelectEntry,
  onToggleEntryStatus,
  onDeleteEntry,
  onOpenNewWorkEntry,
  onClearAll,
  onTriggerUpload,
  onExportGeoJson,
  onOpenPdfExport,
}: PhotoSidebarProps) {
  const gpsCount = photos.filter((p) => p.hasGps).length;
  const noGpsCount = photos.length - gpsCount;

  const [isMobileCollapsed, setIsMobileCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((window.navigator as {standalone?: boolean}).standalone);
    const isMobileWidth = window.innerWidth < 1024;
    return isStandalone && isMobileWidth;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(display-mode: standalone)');
    const handleChange = () => {
      if (mq.matches && window.innerWidth < 1024) {
        setIsMobileCollapsed(true);
      }
    };
    mq.addEventListener?.('change', handleChange);
    return () => mq.removeEventListener?.('change', handleChange);
  }, []);

  const sectionLookup: Record<string, WorkSection> = {};
  for (const s of allSections) {
    sectionLookup[s.id] = s;
  }

  const applyPresetDays = (days: number | null) => {
    if (days === null) {
      onDateRangeChange({startDate: '', endDate: ''});
      return;
    }
    const end = toDateInputString(Date.now());
    const start = toDateInputString(Date.now() - days * 24 * 60 * 60 * 1000);
    onDateRangeChange({startDate: start, endDate: end});
  };

  return (
    <aside
      className={`w-full lg:w-[410px] xl:w-[440px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col lg:max-h-none lg:h-full min-h-0 ${
        isMobileCollapsed ? '' : 'max-h-[48vh]'
      }`}
    >
      {/* Compact Dropzone */}
      <div className="p-3 sm:p-3.5 border-b border-slate-200">
        <button
          type="button"
          onClick={onTriggerUpload}
          className="w-full group border border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50/40 rounded-lg px-3.5 py-2.5 transition-colors flex items-center gap-3 text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-blue-100 text-slate-600 group-hover:text-blue-600 flex items-center justify-center shrink-0 transition-colors">
            <Upload className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs sm:text-sm font-semibold text-slate-900">
              {isParsing
                ? 'GPS 분석 및 주소 확인 중...'
                : '작업팀 사진 올리기 (드래그 또는 선택)'}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">
              GPS 분석 · 구간 자동 색상 표기 · 도로 연결 및 주소 판별
            </p>
          </div>
        </button>
      </div>

      {/* Mobile / Installed PWA Collapse Toggle */}
      <div className="lg:hidden px-3.5 py-1.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-600 tabular-nums truncate">
          구간 {sections.length} · 사진 {filteredPhotos.length} · 기록 {filteredEntries.length}
        </span>
        <button
          type="button"
          onClick={() => setIsMobileCollapsed((v) => !v)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-slate-200 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
        >
          {isMobileCollapsed ? (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
              작업 목록 펼치기
            </>
          ) : (
            <>
              <ChevronUp className="w-3.5 h-3.5 text-slate-600" />
              목록 접고 지도 크게 보기
            </>
          )}
        </button>
      </div>

      {/* Period Filter Bar */}
      <div
        className={`px-3.5 py-2.5 border-b border-slate-200 bg-slate-50/80 space-y-2 ${
          isMobileCollapsed ? 'hidden lg:block' : 'block'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            <span>기간별 확인</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => applyPresetDays(null)}
              className={`px-2 py-0.5 text-[11px] rounded transition-colors cursor-pointer ${
                !dateRange.startDate && !dateRange.endDate
                  ? 'bg-slate-900 text-white font-medium'
                  : 'text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              전체
            </button>
            <button
              type="button"
              onClick={() => applyPresetDays(0)}
              className="px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200/70 rounded transition-colors cursor-pointer"
            >
              오늘
            </button>
            <button
              type="button"
              onClick={() => applyPresetDays(7)}
              className="px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200/70 rounded transition-colors cursor-pointer"
            >
              7일
            </button>
            <button
              type="button"
              onClick={() => applyPresetDays(30)}
              className="px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200/70 rounded transition-colors cursor-pointer"
            >
              30일
            </button>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
          <input
            type="date"
            aria-label="조회 시작일"
            value={dateRange.startDate}
            onChange={(e) =>
              onDateRangeChange({...dateRange, startDate: e.target.value})
            }
            className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-blue-600 tabular-nums"
          />
          <span className="text-xs text-slate-400">~</span>
          <input
            type="date"
            aria-label="조회 종료일"
            value={dateRange.endDate}
            onChange={(e) =>
              onDateRangeChange({...dateRange, endDate: e.target.value})
            }
            className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-blue-600 tabular-nums"
          />
        </div>
      </div>

      {/* Workspace Tabs */}
      <div
        className={`px-3.5 pt-2 border-b border-slate-200 items-center gap-4 text-xs font-medium ${
          isMobileCollapsed ? 'hidden lg:flex' : 'flex'
        }`}
      >
        <button
          type="button"
          onClick={() => onTabChange('sections')}
          className={`pb-2 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'sections'
              ? 'border-blue-600 text-blue-700 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          작업구간 <span className="tabular-nums ml-0.5">{sections.length}</span>
        </button>
        <button
          type="button"
          onClick={() => onTabChange('photos')}
          className={`pb-2 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'photos'
              ? 'border-blue-600 text-blue-700 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          사진 목록 <span className="tabular-nums ml-0.5">{filteredPhotos.length}</span>
        </button>
        <button
          type="button"
          onClick={() => onTabChange('entries')}
          className={`pb-2 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'entries'
              ? 'border-blue-600 text-blue-700 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          작업 기록 <span className="tabular-nums ml-0.5">{filteredEntries.length}</span>
        </button>
      </div>

      {/* TAB 1: WORK SECTIONS & PROGRESS */}
      {activeTab === 'sections' && (
        <div
          className={`flex-1 min-h-0 flex-col ${
            isMobileCollapsed ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="px-3.5 py-2 border-b border-slate-100 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onAutoClusterSections}
              disabled={gpsCount === 0}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800 disabled:text-slate-300 cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5" />
              GPS 자동 분석
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenMergeSections}
                disabled={allSections.length < 2}
                title={
                  allSections.length < 2
                    ? '2개 이상의 작업구간이 있을 때 합칠 수 있습니다'
                    : '다른 작업구간끼리 합쳐서 도로로 연결'
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-xs font-medium text-blue-700 disabled:bg-slate-50 disabled:text-slate-300 transition-colors cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
              >
                <GitMerge className="w-3.5 h-3.5" />
                구간 합치기
              </button>
              <button
                type="button"
                onClick={onOpenNewSection}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                구간 추가
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
            {sections.length === 0 ? (
              <div className="px-6 py-10 text-center space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  아직 설정된 작업구간이 없습니다
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  현장 사진을 업로드하면 GPS 위치와 날짜를 분석해 작업구간과 경로를 자동으로 색상 표기합니다.
                </p>
              </div>
            ) : (
              sections.map((section) => {
                const progress = sectionProgressLookup[section.id];
                const isSelected = activeSectionId === section.id;

                return (
                  <div
                    key={section.id}
                    className={`p-3.5 transition-colors ${
                      isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          onSelectSectionFilter(isSelected ? null : section.id)
                        }
                        className="flex items-center gap-2 min-w-0 text-left cursor-pointer"
                      >
                        <span
                          className="w-3 h-3 rounded-xs shrink-0"
                          style={{backgroundColor: section.color}}
                        />
                        <span className="text-sm font-semibold text-slate-900 truncate">
                          {section.name}
                        </span>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          aria-label={`${section.name} 수정`}
                          onClick={() => onEditSection(section)}
                          className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`${section.name} 삭제`}
                          onClick={() => onDeleteSection(section.id)}
                          className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Unboxed Metadata Line */}
                    <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500 mt-1 tabular-nums">
                      <span className="font-medium text-slate-700">
                        {STATUS_LABELS[section.status]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {section.startDate} ~ {section.endDate}
                      </span>
                      {progress && progress.measuredDistanceMeters > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-700">
                            {formatDistance(progress.measuredDistanceMeters)}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Progress Bar */}
                    {progress && (
                      <div className="mt-2.5 space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500 tabular-nums">
                            확인 사진 {progress.checkedPhotos}/{progress.totalPhotos}장
                            {progress.totalEntries > 0 &&
                              ` · 작업 ${progress.completedEntries}/${progress.totalEntries}건`}
                          </span>
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            {progress.progressPercent}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-200"
                            style={{
                              width: `${progress.progressPercent}%`,
                              backgroundColor: section.color,
                            }}
                          />
                        </div>
                        {progress.uniqueDates.length > 0 && (
                          <p className="text-[11px] text-slate-400 tabular-nums truncate">
                            기간 내 작업일: {progress.uniqueDates.join(', ')}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 2: PHOTO LIST */}
      {activeTab === 'photos' && (
        <div
          className={`flex-1 min-h-0 flex-col ${
            isMobileCollapsed ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="px-3.5 py-2 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/60">
            <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-lg">
              <button
                type="button"
                onClick={() => onFilterChange('all')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                전체 <span className="tabular-nums text-slate-400">{photos.length}</span>
              </button>
              <button
                type="button"
                onClick={() => onFilterChange('with-gps')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === 'with-gps'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                GPS <span className="tabular-nums text-slate-400">{gpsCount}</span>
              </button>
              <button
                type="button"
                onClick={() => onFilterChange('without-gps')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === 'without-gps'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                미포함 <span className="tabular-nums text-slate-400">{noGpsCount}</span>
              </button>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <ArrowUpDown className="w-3 h-3 text-slate-400" />
              <select
                aria-label="사진 정렬"
                value={sort}
                onChange={(e) => onSortChange(e.target.value as PhotoSort)}
                className="text-[11px] font-medium text-slate-700 bg-transparent border-0 focus:outline-none cursor-pointer py-0.5"
              >
                <option value="captured-desc">촬영 최신순</option>
                <option value="captured-asc">촬영 오래된순</option>
                <option value="uploaded-desc">업로드순</option>
                <option value="name-asc">이름순</option>
              </select>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
            {filteredPhotos.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <p className="text-sm font-medium text-slate-700">
                  {photos.length === 0
                    ? '업로드된 사진이 없습니다'
                    : '선택한 기간·조건의 사진이 없습니다'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  기간 필터나 작업구간 필터를 조정해 보세요.
                </p>
              </div>
            ) : (
              filteredPhotos.map((photo) => {
                const isSelected = selectedPhotoId === photo.id;
                const sec = photo.sectionId
                  ? sectionLookup[photo.sectionId]
                  : undefined;

                return (
                  <div
                    key={photo.id}
                    onClick={() => onSelectPhoto(photo.id)}
                    onMouseEnter={() => onHoverPhoto(photo.id)}
                    onMouseLeave={() => onHoverPhoto(null)}
                    className={`group flex items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                      isSelected ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                    }`}
                  >
                    <button
                      type="button"
                      aria-label={
                        photo.isChecked ? '확인 완료 해제' : '작업 확인 완료 체크'
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePhotoChecked(photo.id);
                      }}
                      className="mt-1 text-slate-400 hover:text-emerald-600 cursor-pointer shrink-0"
                    >
                      {photo.isChecked ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Circle className="w-4 h-4" />
                      )}
                    </button>

                    <div
                      className="w-12 h-12 rounded-md overflow-hidden bg-slate-100 shrink-0 border-2"
                      style={{borderColor: sec?.color || '#E2E8F0'}}
                    >
                      <PhotoThumbnail
                        src={photo.previewUrl}
                        fallbackSrc={photo.fallbackPreviewUrl}
                        alt={photo.fileName}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {photo.location?.formattedAddress ||
                            photo.location?.shortAddress ||
                            photo.fileName}
                        </p>
                        <button
                          type="button"
                          aria-label={`${photo.fileName} 삭제`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeletePhoto(photo.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5 truncate">
                        {photo.hasGps &&
                        photo.lat !== undefined &&
                        photo.lng !== undefined ? (
                          <>
                            <MapPin className="w-3 h-3 text-blue-600 shrink-0" />
                            <span className="font-mono tabular-nums truncate">
                              {photo.isGeocoding
                                ? '정확한 주소 판별 중...'
                                : formatDecimalCoords(photo.lat, photo.lng)}
                            </span>
                          </>
                        ) : (
                          <>
                            <MapPinOff className="w-3 h-3 text-amber-600 shrink-0" />
                            <span className="text-amber-700">GPS 없음</span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="text-[11px] text-slate-400 tabular-nums truncate">
                          {photo.exif.dateTimeOriginal ||
                            `${getPhotoDateKey(photo)} · ${formatFileSize(photo.fileSize)}`}
                          {photo.uploadedByName ? ` · ${photo.uploadedByName}` : ''}
                        </span>
                        {allSections.length > 0 && (
                          <select
                            aria-label="소속 작업구간 변경"
                            value={photo.sectionId || ''}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation();
                              onAssignPhotoSection(photo.id, e.target.value);
                            }}
                            className="text-[11px] text-slate-600 bg-transparent border border-slate-200 rounded px-1 py-0.5 max-w-[110px] truncate cursor-pointer"
                          >
                            <option value="">구간 미지정</option>
                            {allSections.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 3: WORK ENTRIES WITH ATTACHED PHOTOS */}
      {activeTab === 'entries' && (
        <div
          className={`flex-1 min-h-0 flex-col ${
            isMobileCollapsed ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="px-3.5 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              지도 위치별 작업 내역 및 첨부 사진
            </span>
            <button
              type="button"
              onClick={onOpenNewWorkEntry}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              작업 등록
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
            {filteredEntries.length === 0 ? (
              <div className="px-6 py-10 text-center space-y-2">
                <ClipboardList className="w-6 h-6 text-slate-300 mx-auto" />
                <p className="text-sm font-medium text-slate-700">
                  등록된 지도 작업 기록이 없습니다
                </p>
                <p className="text-xs text-slate-500">
                  지도 위 위치를 찍어 작업 내용과 현장 사진들을 함께 첨부하세요.
                </p>
              </div>
            ) : (
              filteredEntries.map((entry) => {
                const isSelected = selectedEntryId === entry.id;
                const sec = entry.sectionId
                  ? sectionLookup[entry.sectionId]
                  : undefined;

                return (
                  <div
                    key={entry.id}
                    onClick={() => onSelectEntry(entry.id)}
                    className={`group p-3.5 transition-colors cursor-pointer ${
                      isSelected ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <button
                          type="button"
                          aria-label="작업 완료 상태 토글"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleEntryStatus(entry.id);
                          }}
                          className="mt-0.5 shrink-0 cursor-pointer"
                        >
                          {entry.status === 'completed' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Circle className="w-4 h-4 text-slate-400 hover:text-blue-600" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {entry.title}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                            {entry.location?.shortAddress ||
                              formatDecimalCoords(entry.lat, entry.lng)}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        aria-label={`${entry.title} 삭제`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteEntry(entry.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1.5 pl-6 tabular-nums truncate">
                      <span>{entry.teamName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{entry.workDate}</span>
                      <span aria-hidden="true">·</span>
                      <span>첨부 {entry.photoIds.length}장</span>
                      {entry.createdByName && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{entry.createdByName}</span>
                        </>
                      )}
                      {sec && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span style={{color: sec.color}} className="font-medium">
                            {sec.name}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Footer Utility Strip */}
      {(photos.length > 0 || sections.length > 0 || workEntries.length > 0) && (
        <div
          className={`px-3.5 py-2 border-t border-slate-200 bg-slate-50/70 items-center justify-between gap-2 text-xs ${
            isMobileCollapsed ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <button
            type="button"
            onClick={onClearAll}
            className="text-slate-500 hover:text-red-600 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            전체 초기화
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onOpenPdfExport}
              className="inline-flex items-center gap-1.5 text-blue-700 hover:text-blue-800 font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              PDF 보고서
            </button>
            {gpsCount > 0 && (
              <button
                type="button"
                onClick={onExportGeoJson}
                className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                GeoJSON
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
