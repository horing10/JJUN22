import {CalendarRange, ChevronDown, ChevronUp, RotateCcw} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {
  DateRangeFilter,
  PhotoItem,
  WorkEntry,
  WorkSection,
} from '../types/photo';
import {getPhotoDateKey, isDateInRange, toDateInputString} from '../utils/geo';

interface TimelineFilterBarProps {
  photos: PhotoItem[];
  sections: WorkSection[];
  workEntries: WorkEntry[];
  dateRange: DateRangeFilter;
  visibleSectionCount: number;
  visiblePhotoCount: number;
  visibleEntryCount: number;
  onDateRangeChange: (range: DateRangeFilter) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseYmdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

function utcMsToYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type DragMode =
  | {type: 'start'; anchorEndMs: number}
  | {type: 'end'; anchorStartMs: number}
  | {type: 'move'; initialClientX: number; initialStartMs: number; initialEndMs: number}
  | {type: 'create'; anchorMs: number};

export function TimelineFilterBar({
  photos,
  sections,
  workEntries,
  dateRange,
  visibleSectionCount,
  visiblePhotoCount,
  visibleEntryCount,
  onDateRangeChange,
}: TimelineFilterBarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Compute full timeline bounds across all photos, sections, and work entries
  const {minDayMs, maxDayMs, totalDays, hasData} = useMemo(() => {
    const allDates: string[] = [];
    for (const p of photos) {
      allDates.push(getPhotoDateKey(p));
    }
    for (const s of sections) {
      if (s.startDate) allDates.push(s.startDate);
      if (s.endDate) allDates.push(s.endDate);
    }
    for (const e of workEntries) {
      if (e.workDate) allDates.push(e.workDate);
    }

    if (allDates.length === 0) {
      const todayMs = parseYmdToUtcMs(toDateInputString(Date.now()));
      return {
        minDayMs: todayMs - 6 * DAY_MS,
        maxDayMs: todayMs,
        totalDays: 7,
        hasData: false,
      };
    }

    allDates.sort();
    let minMs = parseYmdToUtcMs(allDates[0]);
    let maxMs = parseYmdToUtcMs(allDates[allDates.length - 1]);

    // Ensure at least a 7-day visual span so single-day uploads are draggable
    const spanDays = Math.round((maxMs - minMs) / DAY_MS) + 1;
    if (spanDays < 7) {
      const padBefore = Math.floor((7 - spanDays) / 2);
      const padAfter = 7 - spanDays - padBefore;
      minMs -= padBefore * DAY_MS;
      maxMs += padAfter * DAY_MS;
    }

    return {
      minDayMs: minMs,
      maxDayMs: maxMs,
      totalDays: Math.max(2, Math.round((maxMs - minMs) / DAY_MS) + 1),
      hasData: true,
    };
  }, [photos, sections, workEntries]);

  const minYmd = useMemo(() => utcMsToYmd(minDayMs), [minDayMs]);
  const maxYmd = useMemo(() => utcMsToYmd(maxDayMs), [maxDayMs]);

  const isFiltered = Boolean(dateRange.startDate || dateRange.endDate);

  const activeStartMs = useMemo(() => {
    if (!dateRange.startDate) return minDayMs;
    const ms = parseYmdToUtcMs(dateRange.startDate);
    return Math.max(minDayMs, Math.min(maxDayMs, ms));
  }, [dateRange.startDate, minDayMs, maxDayMs]);

  const activeEndMs = useMemo(() => {
    if (!dateRange.endDate) return maxDayMs;
    const ms = parseYmdToUtcMs(dateRange.endDate);
    return Math.max(activeStartMs, Math.min(maxDayMs, ms));
  }, [dateRange.endDate, activeStartMs, maxDayMs]);

  // Build day-by-day activity histogram across the full range
  const dayBuckets = useMemo(() => {
    const countsByDay: Record<
      string,
      {photos: number; entries: number; color: string}
    > = {};

    const sectionColorLookup: Record<string, string> = {};
    for (const s of sections) {
      sectionColorLookup[s.id] = s.color;
    }

    for (const p of photos) {
      const key = getPhotoDateKey(p);
      if (!countsByDay[key]) {
        countsByDay[key] = {
          photos: 0,
          entries: 0,
          color: p.sectionId ? sectionColorLookup[p.sectionId] || '#2563EB' : '#2563EB',
        };
      }
      countsByDay[key].photos += 1;
      if (p.sectionId && sectionColorLookup[p.sectionId]) {
        countsByDay[key].color = sectionColorLookup[p.sectionId];
      }
    }

    for (const e of workEntries) {
      const key = e.workDate;
      if (!countsByDay[key]) {
        countsByDay[key] = {
          photos: 0,
          entries: 0,
          color: e.sectionId ? sectionColorLookup[e.sectionId] || '#0F172A' : '#0F172A',
        };
      }
      countsByDay[key].entries += 1;
    }

    let maxCount = 1;
    const list: Array<{
      ymd: string;
      ms: number;
      total: number;
      photos: number;
      entries: number;
      color: string;
    }> = [];

    // Sample buckets cleanly if span exceeds 120 days, otherwise 1 bucket per day
    const stepDays = totalDays > 120 ? Math.ceil(totalDays / 120) : 1;

    for (let d = minDayMs; d <= maxDayMs; d += stepDays * DAY_MS) {
      let sumPhotos = 0;
      let sumEntries = 0;
      let color = '#2563EB';
      for (let sub = 0; sub < stepDays; sub++) {
        const subYmd = utcMsToYmd(d + sub * DAY_MS);
        const bucket = countsByDay[subYmd];
        if (bucket) {
          sumPhotos += bucket.photos;
          sumEntries += bucket.entries;
          color = bucket.color;
        }
      }
      const total = sumPhotos + sumEntries;
      if (total > maxCount) maxCount = total;
      list.push({
        ymd: utcMsToYmd(d),
        ms: d,
        total,
        photos: sumPhotos,
        entries: sumEntries,
        color,
      });
    }

    return {list, maxCount};
  }, [photos, workEntries, sections, minDayMs, maxDayMs, totalDays]);

  // Helper: map clientX -> snapped day UTC ms
  const clientXToDayMs = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return minDayMs;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return minDayMs;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const dayIndex = Math.round(ratio * (totalDays - 1));
      return minDayMs + dayIndex * DAY_MS;
    },
    [minDayMs, totalDays]
  );

  // Global pointer drag handling
  useEffect(() => {
    if (!dragMode) return;

    const handlePointerMove = (e: PointerEvent) => {
      const el = trackRef.current;
      if (!el) return;

      if (dragMode.type === 'start') {
        const nextStart = Math.min(
          dragMode.anchorEndMs,
          Math.max(minDayMs, clientXToDayMs(e.clientX))
        );
        onDateRangeChange({
          startDate: utcMsToYmd(nextStart),
          endDate: utcMsToYmd(dragMode.anchorEndMs),
        });
      } else if (dragMode.type === 'end') {
        const nextEnd = Math.max(
          dragMode.anchorStartMs,
          Math.min(maxDayMs, clientXToDayMs(e.clientX))
        );
        onDateRangeChange({
          startDate: utcMsToYmd(dragMode.anchorStartMs),
          endDate: utcMsToYmd(nextEnd),
        });
      } else if (dragMode.type === 'move') {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0) return;
        const deltaRatio = (e.clientX - dragMode.initialClientX) / rect.width;
        const deltaDays = Math.round(deltaRatio * (totalDays - 1));
        const span = dragMode.initialEndMs - dragMode.initialStartMs;

        let nextStart = dragMode.initialStartMs + deltaDays * DAY_MS;
        let nextEnd = nextStart + span;

        if (nextStart < minDayMs) {
          nextStart = minDayMs;
          nextEnd = minDayMs + span;
        }
        if (nextEnd > maxDayMs) {
          nextEnd = maxDayMs;
          nextStart = maxDayMs - span;
        }

        onDateRangeChange({
          startDate: utcMsToYmd(nextStart),
          endDate: utcMsToYmd(nextEnd),
        });
      } else if (dragMode.type === 'create') {
        const currentMs = Math.max(
          minDayMs,
          Math.min(maxDayMs, clientXToDayMs(e.clientX))
        );
        const start = Math.min(dragMode.anchorMs, currentMs);
        const end = Math.max(dragMode.anchorMs, currentMs);
        onDateRangeChange({
          startDate: utcMsToYmd(start),
          endDate: utcMsToYmd(end),
        });
      }
    };

    const handlePointerUp = () => {
      setDragMode(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [
    dragMode,
    minDayMs,
    maxDayMs,
    totalDays,
    clientXToDayMs,
    onDateRangeChange,
  ]);

  // Percentages for selection box
  const leftPct = ((activeStartMs - minDayMs) / Math.max(DAY_MS, maxDayMs - minDayMs)) * 100;
  const rightPct = ((activeEndMs - minDayMs) / Math.max(DAY_MS, maxDayMs - minDayMs)) * 100;
  const widthPct = Math.max(2, rightPct - leftPct);

  // Date axis tick labels (start, middle, end)
  const midYmd = utcMsToYmd(
    minDayMs + Math.floor((totalDays - 1) / 2) * DAY_MS
  );

  const nudgeHandle = (which: 'start' | 'end', deltaDays: number) => {
    if (which === 'start') {
      const next = Math.max(
        minDayMs,
        Math.min(activeEndMs, activeStartMs + deltaDays * DAY_MS)
      );
      onDateRangeChange({
        startDate: utcMsToYmd(next),
        endDate: utcMsToYmd(activeEndMs),
      });
    } else {
      const next = Math.min(
        maxDayMs,
        Math.max(activeStartMs, activeEndMs + deltaDays * DAY_MS)
      );
      onDateRangeChange({
        startDate: utcMsToYmd(activeStartMs),
        endDate: utcMsToYmd(next),
      });
    }
  };

  return (
    <section
      aria-label="전체 작업 기간 타임라인 필터"
      className="shrink-0 bg-white border-t border-slate-200 select-none z-20"
    >
      {/* Timeline Header Bar */}
      <div className="px-4 lg:px-6 py-2 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 whitespace-nowrap shrink-0">
            <CalendarRange className="w-4 h-4 text-blue-600" />
            <span>작업 기간 타임라인</span>
          </div>

          <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
            |
          </span>

          <div className="flex items-center gap-2 text-xs text-slate-600 truncate">
            <span className="font-mono font-medium text-slate-900 tabular-nums">
              {isFiltered
                ? `${utcMsToYmd(activeStartMs)} ~ ${utcMsToYmd(activeEndMs)}`
                : hasData
                  ? `전체 기간 (${minYmd} ~ ${maxYmd})`
                  : '데이터 업로드 시 전체 작업 기간이 표시됩니다'}
            </span>
            {hasData && (
              <>
                <span className="text-slate-300" aria-hidden="true">
                  ·
                </span>
                <span className="tabular-nums text-slate-500 whitespace-nowrap">
                  구간 {visibleSectionCount}개 · 사진 {visiblePhotoCount}장
                  {visibleEntryCount > 0 ? ` · 작업 ${visibleEntryCount}건` : ''}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isFiltered && (
            <button
              type="button"
              onClick={() => onDateRangeChange({startDate: '', endDate: ''})}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-700 transition-colors whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              전체 기간
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsCollapsed((v) => !v)}
            aria-label={isCollapsed ? '타임라인 펼치기' : '타임라인 접기'}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            {isCollapsed ? (
              <>
                <span>펼치기</span>
                <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                <span className="hidden sm:inline">접기</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Interactive Brush Track */}
      {!isCollapsed && (
        <div className="px-4 lg:px-6 pt-2 pb-2.5 space-y-1.5">
          {/* Work Section Span Strips */}
          {sections.length > 0 && (
            <div className="relative h-3.5 w-full overflow-hidden rounded bg-slate-50 border border-slate-100">
              {sections.slice(0, 4).map((sec, idx) => {
                const sMs = Math.max(minDayMs, parseYmdToUtcMs(sec.startDate));
                const eMs = Math.min(maxDayMs, parseYmdToUtcMs(sec.endDate));
                const totalSpan = Math.max(DAY_MS, maxDayMs - minDayMs);
                const sLeft = ((sMs - minDayMs) / totalSpan) * 100;
                const sWidth = Math.max(
                  1.5,
                  ((Math.max(sMs, eMs) - sMs) / totalSpan) * 100
                );
                const inFilter =
                  !isFiltered ||
                  isDateInRange(sec.startDate, dateRange) ||
                  isDateInRange(sec.endDate, dateRange) ||
                  (sec.startDate <= utcMsToYmd(activeStartMs) &&
                    sec.endDate >= utcMsToYmd(activeEndMs));

                return (
                  <div
                    key={sec.id}
                    title={`${sec.name} (${sec.startDate} ~ ${sec.endDate})`}
                    className="absolute h-1 rounded-full transition-opacity"
                    style={{
                      top: `${2 + idx * 3}px`,
                      left: `${sLeft}%`,
                      width: `${sWidth}%`,
                      backgroundColor: sec.color,
                      opacity: inFilter ? 0.9 : 0.2,
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* Main Histogram + Draggable Brush Track */}
          <div
            ref={trackRef}
            onPointerDown={(e) => {
              if (!hasData) return;
              const clickedMs = clientXToDayMs(e.clientX);
              setDragMode({type: 'create', anchorMs: clickedMs});
              onDateRangeChange({
                startDate: utcMsToYmd(clickedMs),
                endDate: utcMsToYmd(clickedMs),
              });
            }}
            className={`relative h-11 w-full rounded-lg bg-slate-50 border border-slate-200/90 overflow-visible ${
              hasData ? 'cursor-crosshair' : 'opacity-60'
            }`}
          >
            {/* Daily Photo/Work Activity Bars */}
            <div className="absolute inset-x-1 inset-y-1 flex items-end gap-[2px] pointer-events-none">
              {dayBuckets.list.map((bucket) => {
                const heightPct =
                  bucket.total > 0
                    ? Math.max(18, Math.round((bucket.total / dayBuckets.maxCount) * 100))
                    : 0;
                const inRange =
                  !isFiltered ||
                  isDateInRange(bucket.ymd, {
                    startDate: utcMsToYmd(activeStartMs),
                    endDate: utcMsToYmd(activeEndMs),
                  });

                return (
                  <div
                    key={bucket.ymd}
                    className="flex-1 h-full flex items-end justify-center"
                  >
                    {bucket.total > 0 ? (
                      <div
                        className="w-full max-w-[14px] rounded-t-[2px] transition-opacity"
                        style={{
                          height: `${heightPct}%`,
                          backgroundColor: bucket.color,
                          opacity: inRange ? 0.85 : 0.2,
                        }}
                      />
                    ) : (
                      <div className="w-full max-w-[14px] h-[2px] bg-slate-200/70 rounded-full" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Unselected Dimming Masks */}
            {hasData && leftPct > 0 && (
              <div
                className="absolute inset-y-0 left-0 bg-slate-900/10 rounded-l-lg pointer-events-none"
                style={{width: `${leftPct}%`}}
              />
            )}
            {hasData && leftPct + widthPct < 100 && (
              <div
                className="absolute inset-y-0 right-0 bg-slate-900/10 rounded-r-lg pointer-events-none"
                style={{width: `${Math.max(0, 100 - (leftPct + widthPct))}%`}}
              />
            )}

            {/* Selected Draggable Range Box */}
            {hasData && (
              <div
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDragMode({
                    type: 'move',
                    initialClientX: e.clientX,
                    initialStartMs: activeStartMs,
                    initialEndMs: activeEndMs,
                  });
                }}
                title="드래그하여 선택 기간 이동"
                className="absolute inset-y-0 border-y-2 border-blue-600 bg-blue-500/10 cursor-grab active:cursor-grabbing"
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                }}
              >
                {/* Left Resize Handle */}
                <button
                  type="button"
                  role="slider"
                  aria-label="시작 날짜 조절"
                  aria-valuemin={minDayMs}
                  aria-valuemax={activeEndMs}
                  aria-valuenow={activeStartMs}
                  aria-valuetext={utcMsToYmd(activeStartMs)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setDragMode({type: 'start', anchorEndMs: activeEndMs});
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') {
                      e.preventDefault();
                      nudgeHandle('start', -1);
                    } else if (e.key === 'ArrowRight') {
                      e.preventDefault();
                      nudgeHandle('start', 1);
                    }
                  }}
                  className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-7 rounded bg-white border-2 border-blue-600 shadow-sm flex items-center justify-center cursor-ew-resize hover:scale-105 focus-visible:outline-2 focus-visible:outline-blue-600"
                >
                  <span className="w-0.5 h-3 bg-blue-600 rounded-full" />
                </button>

                {/* Right Resize Handle */}
                <button
                  type="button"
                  role="slider"
                  aria-label="종료 날짜 조절"
                  aria-valuemin={activeStartMs}
                  aria-valuemax={maxDayMs}
                  aria-valuenow={activeEndMs}
                  aria-valuetext={utcMsToYmd(activeEndMs)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setDragMode({type: 'end', anchorStartMs: activeStartMs});
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') {
                      e.preventDefault();
                      nudgeHandle('end', -1);
                    } else if (e.key === 'ArrowRight') {
                      e.preventDefault();
                      nudgeHandle('end', 1);
                    }
                  }}
                  className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-7 rounded bg-white border-2 border-blue-600 shadow-sm flex items-center justify-center cursor-ew-resize hover:scale-105 focus-visible:outline-2 focus-visible:outline-blue-600"
                >
                  <span className="w-0.5 h-3 bg-blue-600 rounded-full" />
                </button>
              </div>
            )}
          </div>

          {/* Date Axis Labels */}
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums px-0.5">
            <span>{minYmd}</span>
            <span className="hidden sm:inline">{midYmd}</span>
            <span>{maxYmd}</span>
          </div>
        </div>
      )}
    </section>
  );
}
