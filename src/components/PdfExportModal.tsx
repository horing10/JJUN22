import {
  Camera,
  CheckSquare,
  FileDown,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  X,
} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import type {
  DateRangeFilter,
  PhotoItem,
  WorkEntry,
  WorkSection,
} from '../types/photo';
import type {SectionProgressSummary} from '../utils/geo';
import {generateWorkReportPdf} from '../utils/pdfExport';

interface PdfExportModalProps {
  activeSection: WorkSection | null;
  dateRange: DateRangeFilter;
  sections: WorkSection[];
  allSections: WorkSection[];
  photos: PhotoItem[];
  allPhotos: PhotoItem[];
  workEntries: WorkEntry[];
  sectionProgressLookup: Record<string, SectionProgressSummary>;
  onCaptureMap: () => Promise<string | null>;
  onClose: () => void;
}

function formatScopeRange(range: DateRangeFilter): string {
  if (!range.startDate && !range.endDate) return '전체 기간';
  if (range.startDate && range.endDate) {
    return range.startDate === range.endDate
      ? range.startDate
      : `${range.startDate} ~ ${range.endDate}`;
  }
  return range.startDate ? `${range.startDate} 이후` : `${range.endDate} 이전`;
}

export function PdfExportModal({
  activeSection,
  dateRange,
  sections,
  allSections,
  photos,
  allPhotos,
  workEntries,
  sectionProgressLookup,
  onCaptureMap,
  onClose,
}: PdfExportModalProps) {
  const defaultTitle = activeSection
    ? `${activeSection.name} 작업 보고서`
    : '현장 작업구간 종합 보고서';

  const [title, setTitle] = useState(defaultTitle);
  const [author, setAuthor] = useState('');
  const [notes, setNotes] = useState('');
  const [includeMap, setIncludeMap] = useState(true);
  const [includeSections, setIncludeSections] = useState(true);
  const [includeEntries, setIncludeEntries] = useState(true);
  const [includePhotos, setIncludePhotos] = useState(true);

  const [mapPreviewUrl, setMapPreviewUrl] = useState<string | null>(null);
  const [isCapturingMap, setIsCapturingMap] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runMapCapture = useCallback(async () => {
    setIsCapturingMap(true);
    setErrorMsg(null);
    try {
      const captured = await onCaptureMap();
      setMapPreviewUrl(captured);
    } catch {
      setMapPreviewUrl(null);
    } finally {
      setIsCapturingMap(false);
    }
  }, [onCaptureMap]);

  useEffect(() => {
    void runMapCapture();
  }, [runMapCapture]);

  const handleExport = async () => {
    if (
      !includeMap &&
      !includeSections &&
      !includeEntries &&
      !includePhotos
    ) {
      setErrorMsg('보고서에 포함할 항목을 하나 이상 선택해주세요.');
      return;
    }

    setIsGenerating(true);
    setErrorMsg(null);
    try {
      await generateWorkReportPdf({
        title,
        author,
        notes,
        includeMap,
        includeSections,
        includeEntries,
        includePhotos,
        mapImageDataUrl: includeMap ? mapPreviewUrl : null,
        activeSection,
        dateRange,
        sections,
        allSections,
        photos,
        allPhotos,
        workEntries,
        sectionProgressLookup,
      });
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? `PDF 생성 중 오류가 발생했습니다: ${err.message}`
          : 'PDF 생성에 실패했습니다. 다시 시도해 주세요.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              PDF 작업 보고서 내보내기
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              {activeSection ? activeSection.name : '전체 작업구간'} ·{' '}
              {formatScopeRange(dateRange)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Scope Summary Strip */}
          <div className="grid grid-cols-3 gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
            <div>
              <p className="text-[11px] text-slate-500">작업구간</p>
              <p className="text-sm font-semibold text-slate-900 tabular-nums mt-0.5">
                {sections.length}개
              </p>
            </div>
            <div className="border-x border-slate-200">
              <p className="text-[11px] text-slate-500">포함 사진</p>
              <p className="text-sm font-semibold text-slate-900 tabular-nums mt-0.5">
                {photos.length}장
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">작업 기록</p>
              <p className="text-sm font-semibold text-slate-900 tabular-nums mt-0.5">
                {workEntries.length}건
              </p>
            </div>
          </div>

          {/* Map Capture Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <MapIcon className="w-3.5 h-3.5 text-blue-600" />
                지도 캡처 미리보기
              </label>
              <button
                type="button"
                onClick={() => void runMapCapture()}
                disabled={isCapturingMap}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 disabled:text-slate-400 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3 h-3 ${isCapturingMap ? 'animate-spin' : ''}`}
                />
                다시 캡처
              </button>
            </div>

            <div className="relative w-full h-44 rounded-lg border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center">
              {isCapturingMap ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  현재 지도 화면과 경로·핀을 캡처하는 중...
                </div>
              ) : mapPreviewUrl ? (
                <img
                  src={mapPreviewUrl}
                  alt="지도 캡처 미리보기"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-center px-4">
                  <Camera className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                  <p className="text-xs text-slate-500">
                    지도 타일을 캡처하지 못했습니다. 다시 캡처하거나 지도 없이 저장할 수 있습니다.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Report Metadata Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                보고서 제목
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="현장 작업구간 보고서"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                작성자 / 담당팀 (선택)
              </label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="예: 현장 1팀 홍길동"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              보고서 요약 메모 (선택)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="금일 작업 특이사항이나 보고서 머릿말을 입력하세요"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 resize-none"
            />
          </div>

          {/* Included Content Checkboxes */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
              <CheckSquare className="w-3.5 h-3.5 text-slate-500" />
              PDF 포함 항목
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeMap}
                  onChange={(e) => setIncludeMap(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                지도 캡처 이미지
              </label>
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSections}
                  onChange={(e) => setIncludeSections(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                작업구간별 진행 현황
              </label>
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeEntries}
                  onChange={(e) => setIncludeEntries(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                작업 내용 및 첨부 기록
              </label>
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includePhotos}
                  onChange={(e) => setIncludePhotos(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                사진 목록 · 썸네일 · 상세 주소
              </label>
            </div>
          </div>

          {errorMsg && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isGenerating}
            className="px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={isGenerating || isCapturingMap}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors cursor-pointer"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                PDF 보고서 생성 중...
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4" />
                PDF 보고서 저장
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
