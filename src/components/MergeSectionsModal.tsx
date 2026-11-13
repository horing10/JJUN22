import {
  ArrowDown,
  ArrowUp,
  Check,
  GitMerge,
  Route as RouteIcon,
  X,
} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import type {
  PhotoItem,
  WorkEntry,
  WorkSection,
  WorkStatus,
} from '../types/photo';
import {
  formatDistance,
  SECTION_COLORS,
  type SectionConnectionMode,
  type SectionProgressSummary,
} from '../utils/geo';

export interface MergeSectionsPayload {
  orderedSectionIds: string[];
  connectionMode: SectionConnectionMode;
  includeUnassignedGps: boolean;
  name: string;
  color: string;
  status: WorkStatus;
  startDate: string;
  endDate: string;
  memo: string;
}

interface MergeSectionsModalProps {
  sections: WorkSection[];
  photos: PhotoItem[];
  workEntries: WorkEntry[];
  activeSectionId: string | null;
  sectionProgressLookup: Record<string, SectionProgressSummary>;
  onClose: () => void;
  onMerge: (payload: MergeSectionsPayload) => void;
}

const CONNECTION_MODES: Array<{
  id: SectionConnectionMode;
  label: string;
  desc: string;
}> = [
  {
    id: 'section-order',
    label: '구간 순서대로 연결',
    desc: '아래에 지정한 구간 순서(1→2→3)대로 다른 지역의 길까지 이어 연결합니다',
  },
  {
    id: 'nearest-chain',
    label: '최단 거리순 연결',
    desc: '첫 구간의 시작점에서 가장 가까운 위치 순으로 거리를 최소화해 연결합니다',
  },
  {
    id: 'chronological',
    label: '촬영 시간순 연결',
    desc: '합쳐진 모든 사진을 촬영 일시 순서대로 이어 연결합니다',
  },
];

export function MergeSectionsModal({
  sections,
  photos,
  workEntries,
  activeSectionId,
  sectionProgressLookup,
  onClose,
  onMerge,
}: MergeSectionsModalProps) {
  const initialSelected = useMemo(() => {
    if (sections.length < 2) return sections.map((s) => s.id);
    if (activeSectionId) {
      const other = sections.find((s) => s.id !== activeSectionId);
      return other ? [activeSectionId, other.id] : [sections[0].id, sections[1].id];
    }
    return [sections[0].id, sections[1].id];
  }, [sections, activeSectionId]);

  const [selectedOrder, setSelectedOrder] = useState<string[]>(initialSelected);
  const [connectionMode, setConnectionMode] =
    useState<SectionConnectionMode>('section-order');
  const [includeUnassignedGps, setIncludeUnassignedGps] = useState(false);

  const selectedSections = useMemo(
    () =>
      selectedOrder
        .map((id) => sections.find((s) => s.id === id))
        .filter((s): s is WorkSection => Boolean(s)),
    [selectedOrder, sections]
  );

  const suggestedName = useMemo(() => {
    if (selectedSections.length === 0) return '통합 작업구간';
    if (selectedSections.length <= 2) {
      return `${selectedSections.map((s) => s.name).join(' + ')} 연결`;
    }
    return `${selectedSections[0].name} 외 ${selectedSections.length - 1}개 통합 구간`;
  }, [selectedSections]);

  const [name, setName] = useState(suggestedName);
  const [nameEdited, setNameEdited] = useState(false);
  const [color, setColor] = useState(
    selectedSections[0]?.color || SECTION_COLORS[0]
  );
  const [status, setStatus] = useState<WorkStatus>('in_progress');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [memo, setMemo] = useState('');

  useEffect(() => {
    if (!nameEdited) {
      setName(suggestedName);
    }
  }, [suggestedName, nameEdited]);

  useEffect(() => {
    if (selectedSections.length === 0) return;
    const starts = selectedSections.map((s) => s.startDate).filter(Boolean).sort();
    const ends = selectedSections.map((s) => s.endDate).filter(Boolean).sort();
    if (starts.length > 0) setStartDate(starts[0]);
    if (ends.length > 0) setEndDate(ends[ends.length - 1]);

    const allCompleted = selectedSections.every((s) => s.status === 'completed');
    const allPlanned = selectedSections.every((s) => s.status === 'planned');
    setStatus(allCompleted ? 'completed' : allPlanned ? 'planned' : 'in_progress');
  }, [selectedSections]);

  const unassignedGpsCount = useMemo(
    () => photos.filter((p) => p.hasGps && !p.sectionId).length,
    [photos]
  );

  const mergedStats = useMemo(() => {
    const idSet = new Set(selectedOrder);
    const matchingPhotos = photos.filter(
      (p) =>
        (p.sectionId && idSet.has(p.sectionId)) ||
        (includeUnassignedGps && p.hasGps && !p.sectionId)
    );
    const gpsPhotosCount = matchingPhotos.filter((p) => p.hasGps).length;
    const entriesCount = workEntries.filter(
      (e) => e.sectionId && idSet.has(e.sectionId)
    ).length;
    return {
      totalPhotos: matchingPhotos.length,
      gpsPhotos: gpsPhotosCount,
      entries: entriesCount,
    };
  }, [selectedOrder, photos, workEntries, includeUnassignedGps]);

  const toggleSection = (id: string) => {
    setSelectedOrder((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const moveOrder = (id: string, delta: -1 | 1) => {
    setSelectedOrder((prev) => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  };

  const unselectedSections = useMemo(
    () => sections.filter((s) => !selectedOrder.includes(s.id)),
    [sections, selectedOrder]
  );

  const canMerge = selectedOrder.length >= 2;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canMerge) return;
    onMerge({
      orderedSectionIds: selectedOrder,
      connectionMode,
      includeUnassignedGps,
      name: name.trim() || suggestedName,
      color,
      status,
      startDate: startDate || new Date().toISOString().slice(0, 10),
      endDate: endDate || new Date().toISOString().slice(0, 10),
      memo: memo.trim(),
    });
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
          <div className="flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-blue-600" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                작업구간 합치기 및 경로 연결
              </h2>
              <p className="text-xs text-slate-500">
                다른 지역이나 날짜의 작업구간을 하나로 통합해 도로로 이어 연결합니다
              </p>
            </div>
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

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="p-5 space-y-4 overflow-y-auto">
            {/* Step 1: Select & Order Sections */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-700">
                  1. 합칠 작업구간 선택 및 연결 순서 ({selectedOrder.length}개 선택됨)
                </label>
                {selectedOrder.length < 2 && (
                  <span className="text-[11px] text-amber-600 font-medium">
                    2개 이상 선택하세요
                  </span>
                )}
              </div>

              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-52 overflow-y-auto">
                {/* Selected sections in connection order */}
                {selectedSections.map((sec, idx) => {
                  const prog = sectionProgressLookup[sec.id];
                  return (
                    <div
                      key={sec.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 bg-blue-50/50"
                    >
                      <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
                        <span className="w-5 h-5 rounded bg-blue-600 text-white text-[11px] font-mono font-bold flex items-center justify-center shrink-0 tabular-nums">
                          {idx + 1}
                        </span>
                        <input
                          type="checkbox"
                          checked
                          onChange={() => toggleSection(sec.id)}
                          className="sr-only"
                        />
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{backgroundColor: sec.color}}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 truncate">
                            {sec.name}
                          </p>
                          <p className="text-[11px] text-slate-500 tabular-nums truncate">
                            사진 {prog?.totalPhotos ?? 0}장
                            {prog && prog.measuredDistanceMeters > 0
                              ? ` · ${formatDistance(prog.measuredDistanceMeters)}`
                              : ''}
                            {` · ${sec.startDate} ~ ${sec.endDate}`}
                          </p>
                        </div>
                      </label>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveOrder(sec.id, -1)}
                          disabled={idx === 0}
                          aria-label={`${sec.name} 위로 이동`}
                          className="p-1 text-slate-500 hover:text-slate-900 disabled:text-slate-300 rounded cursor-pointer disabled:cursor-not-allowed"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveOrder(sec.id, 1)}
                          disabled={idx === selectedSections.length - 1}
                          aria-label={`${sec.name} 아래로 이동`}
                          className="p-1 text-slate-500 hover:text-slate-900 disabled:text-slate-300 rounded cursor-pointer disabled:cursor-not-allowed"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleSection(sec.id)}
                          className="ml-1 px-2 py-0.5 text-[11px] text-slate-500 hover:text-red-600 rounded cursor-pointer"
                        >
                          제외
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Unselected sections available to add */}
                {unselectedSections.map((sec) => {
                  const prog = sectionProgressLookup[sec.id];
                  return (
                    <label
                      key={sec.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={false}
                          onChange={() => toggleSection(sec.id)}
                          className="rounded border-slate-300 text-blue-600"
                        />
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{backgroundColor: sec.color}}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-800 truncate">
                            {sec.name}
                          </p>
                          <p className="text-[11px] text-slate-500 tabular-nums truncate">
                            사진 {prog?.totalPhotos ?? 0}장
                            {prog && prog.measuredDistanceMeters > 0
                              ? ` · ${formatDistance(prog.measuredDistanceMeters)}`
                              : ''}
                            {` · ${sec.startDate} ~ ${sec.endDate}`}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] text-blue-600 font-medium shrink-0">
                        + 추가
                      </span>
                    </label>
                  );
                })}
              </div>

              {unassignedGpsCount > 0 && (
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeUnassignedGps}
                    onChange={(e) => setIncludeUnassignedGps(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>
                    구간 미지정 GPS 사진 {unassignedGpsCount}장도 함께 합쳐서 연결하기
                  </span>
                </label>
              )}
            </div>

            {/* Step 2: Connection Strategy */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-2">
                <RouteIcon className="w-3.5 h-3.5 text-blue-600" />
                2. 다른 위치 간 경로 연결 방식
              </label>
              <div className="space-y-1.5">
                {CONNECTION_MODES.map((m) => {
                  const active = connectionMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setConnectionMode(m.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                        active
                          ? 'bg-blue-50/70 border-blue-500'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900">
                          {m.label}
                        </span>
                        {active && <Check className="w-3.5 h-3.5 text-blue-600" />}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{m.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 3: Merged Section Details */}
            <div className="pt-1 border-t border-slate-200 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  3. 통합 작업구간 이름
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => {
                    setNameEdited(true);
                    setName(e.target.value);
                  }}
                  placeholder="예: 강남-서초 통합 연결 구간"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    구간 대표 색상
                  </label>
                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    {SECTION_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        aria-label={`색상 ${c}`}
                        className={`w-6 h-6 rounded-md cursor-pointer transition-transform ${
                          color === c
                            ? 'ring-2 ring-offset-2 ring-slate-900 scale-110'
                            : 'hover:scale-105'
                        }`}
                        style={{backgroundColor: c}}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    통합 구간 상태
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as WorkStatus)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-blue-600"
                  >
                    <option value="planned">예정</option>
                    <option value="in_progress">진행중</option>
                    <option value="completed">완료</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    시작일
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    종료일
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  메모 (선택)
                </label>
                <input
                  type="text"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="통합 구간 특이사항"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>

            {/* Live Merge Summary */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-slate-600 tabular-nums">
              병합 결과: <strong className="text-slate-900">사진 {mergedStats.totalPhotos}장</strong>
              {` (GPS ${mergedStats.gpsPhotos}장)`}
              {mergedStats.entries > 0 ? ` · 작업 기록 ${mergedStats.entries}건` : ''}
              이 하나의 구간으로 통합되어 지도 위 도로로 연결됩니다.
            </div>
          </div>

          <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!canMerge}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <GitMerge className="w-4 h-4" />
              합쳐서 경로 연결하기
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
