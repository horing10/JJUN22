import {APIProvider} from '@vis.gl/react-google-maps';
import {ImagePlus, Upload} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {PhotoInspector} from './components/PhotoInspector';
import {PhotoMapViewport} from './components/PhotoMapViewport';
import {PhotoSidebar} from './components/PhotoSidebar';
import {SectionModal} from './components/SectionModal';
import {TimelineFilterBar} from './components/TimelineFilterBar';
import {WorkEntryModal} from './components/WorkEntryModal';
import type {
  DateRangeFilter,
  MapLayerType,
  PhotoFilter,
  PhotoItem,
  PhotoSort,
  SidebarTab,
  WorkEntry,
  WorkSection,
  WorkStatus,
} from './types/photo';
import {
  exportPhotosAsGeoJson,
  parsePhotoFile,
  reverseGeocodeCoords,
} from './utils/exif';
import {
  autoClusterPhotosIntoSections,
  computeSectionProgress,
  getPhotoDateKey,
  isDateInRange,
  SECTION_COLORS,
  type SectionProgressSummary,
} from './utils/geo';
import {
  clearAllWorkspaceStorage,
  deletePhotoBlob,
  loadWorkspaceState,
  savePhotoBlob,
  saveWorkspaceState,
} from './utils/storage';

export default function App() {
  const [apiKey, setApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [isLoadingKey, setIsLoadingKey] = useState<boolean>(
    !import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  );
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [sections, setSections] = useState<WorkSection[]>([]);
  const [workEntries, setWorkEntries] = useState<WorkEntry[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  const [activeTab, setActiveTab] = useState<SidebarTab>('sections');
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [hoveredPhotoId, setHoveredPhotoId] = useState<string | null>(null);
  const [manualPinPhotoId, setManualPinPhotoId] = useState<string | null>(null);

  const [filter, setFilter] = useState<PhotoFilter>('all');
  const [sort, setSort] = useState<PhotoSort>('captured-desc');
  const [dateRange, setDateRange] = useState<DateRangeFilter>({
    startDate: '',
    endDate: '',
  });
  const [mapLayer, setMapLayer] = useState<MapLayerType>('roadmap');
  const [showSectionPaths, setShowSectionPaths] = useState(true);
  const [roadDistances, setRoadDistances] = useState<Record<string, number>>({});

  const [isParsing, setIsParsing] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  const [sectionModalOpen, setSectionModalOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<WorkSection | null>(null);

  const [workModalOpen, setWorkModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<WorkEntry | null>(null);
  const [isPickingWorkLocation, setIsPickingWorkLocation] = useState(false);
  const [pickedWorkCoords, setPickedWorkCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  const [fitTrigger, setFitTrigger] = useState(0);
  const [focusTrigger, setFocusTrigger] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounterRef = useRef(0);
  const photosRef = useRef<PhotoItem[]>([]);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  // Hydrate persisted workspace from IndexedDB
  useEffect(() => {
    let active = true;
    loadWorkspaceState()
      .then((saved) => {
        if (!active) return;
        if (saved) {
          setPhotos(saved.photos);
          setSections(saved.sections);
          setWorkEntries(saved.workEntries);
          if (saved.photos.some((p) => p.hasGps) || saved.workEntries.length > 0) {
            setFitTrigger((n) => n + 1);
          }
        }
      })
      .finally(() => {
        if (active) setIsHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Persist workspace changes to IndexedDB
  useEffect(() => {
    if (!isHydrated) return;
    void saveWorkspaceState(photos, sections, workEntries);
  }, [photos, sections, workEntries, isHydrated]);

  useEffect(() => {
    return () => {
      for (const p of photosRef.current) {
        URL.revokeObjectURL(p.previewUrl);
        if (p.fallbackPreviewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(p.fallbackPreviewUrl);
        }
      }
    };
  }, []);

  useEffect(() => {
    const handleQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuota);
  }, []);

  useEffect(() => {
    if (apiKey) {
      setIsLoadingKey(false);
      return;
    }

    let cancelled = false;
    fetch('/api/maps-config')
      .then((res) => res.json())
      .then((data: {apiKey?: string}) => {
        if (!cancelled && data.apiKey) {
          setApiKey(data.apiKey);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoadingKey(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  const enrichPhotoLocation = useCallback(
    async (photoId: string, lat: number, lng: number) => {
      const location = await reverseGeocodeCoords(lat, lng);
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId
            ? {
                ...p,
                isGeocoding: false,
                location: location || p.location,
              }
            : p
        )
      );
      if (location?.locality || location?.shortAddress) {
        setSections((prevSections) =>
          prevSections.map((sec) => {
            if (/^작업구간 \d+$/.test(sec.name)) {
              const targetPhoto = photosRef.current.find(
                (p) => p.id === photoId && p.sectionId === sec.id
              );
              if (targetPhoto) {
                const idx = prevSections.findIndex((s) => s.id === sec.id);
                return {
                  ...sec,
                  name: `${idx + 1}구간 · ${location.locality || location.shortAddress}`,
                };
              }
            }
            return sec;
          })
        );
      }
    },
    []
  );

  const enrichEntryLocation = useCallback(
    async (entryId: string, lat: number, lng: number) => {
      const location = await reverseGeocodeCoords(lat, lng);
      setWorkEntries((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? {
                ...e,
                isGeocoding: false,
                location: location || e.location,
              }
            : e
        )
      );
    },
    []
  );

  const processPhotoFiles = useCallback(
    async (fileList: FileList | File[], autoCluster = true): Promise<PhotoItem[]> => {
      const files = Array.from(fileList).filter(
        (f) =>
          f.type.startsWith('image/') ||
          /\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(f.name)
      );

      if (files.length === 0) {
        setUploadNotice('이미지 파일(JPG, HEIC, PNG, WebP)만 업로드할 수 있습니다.');
        return [];
      }

      setIsParsing(true);
      setUploadNotice(null);

      try {
        const parsedItems = await Promise.all(
          files.map(async (file) => {
            const parsed = await parsePhotoFile(file);
            await savePhotoBlob(parsed.id, file);
            return parsed;
          })
        );

        let nextPhotos = [...parsedItems, ...photosRef.current];

        if (autoCluster) {
          const {sections: nextSections, assignments} =
            autoClusterPhotosIntoSections(nextPhotos, sections);
          nextPhotos = nextPhotos.map((p) =>
            assignments[p.id] ? {...p, sectionId: assignments[p.id]} : p
          );
          setSections(nextSections);
          setPhotos(nextPhotos);
        } else {
          setPhotos(nextPhotos);
        }

        const gpsItems = parsedItems.filter((item) => item.hasGps);
        if (gpsItems.length > 0) {
          setSelectedEntryId(null);
          setSelectedPhotoId(gpsItems[0].id);
          setFitTrigger((n) => n + 1);
          setUploadNotice(
            `${parsedItems.length}장 중 ${gpsItems.length}장의 GPS를 분석해 작업구간과 경로를 지도에 표시했습니다.`
          );
        } else if (parsedItems.length > 0) {
          setSelectedEntryId(null);
          setSelectedPhotoId(parsedItems[0].id);
          setUploadNotice(
            `${parsedItems.length}장을 불러왔으나 GPS 정보가 없습니다. 지도에서 직접 위치를 지정할 수 있습니다.`
          );
        }

        for (const item of gpsItems) {
          if (item.lat !== undefined && item.lng !== undefined) {
            void enrichPhotoLocation(item.id, item.lat, item.lng);
          }
        }

        return parsedItems;
      } finally {
        setIsParsing(false);
      }
    },
    [sections, enrichPhotoLocation]
  );

  const handleTriggerUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAutoClusterSections = useCallback(() => {
    const {sections: nextSections, assignments} = autoClusterPhotosIntoSections(
      photos,
      []
    );
    setSections(nextSections);
    setPhotos((prev) =>
      prev.map((p) =>
        assignments[p.id] ? {...p, sectionId: assignments[p.id]} : p
      )
    );
    setActiveSectionId(null);
    setShowSectionPaths(true);
    setFitTrigger((n) => n + 1);
    setUploadNotice(
      `GPS 위치와 촬영 시간을 분석해 ${nextSections.length}개의 작업구간으로 자동 정리했습니다.`
    );
  }, [photos]);

  const handleSelectPhoto = useCallback(
    (id: string | null) => {
      setSelectedEntryId(null);
      setSelectedPhotoId(id);
      if (id) {
        const target = photos.find((p) => p.id === id);
        if (target?.hasGps) {
          setFocusTrigger((n) => n + 1);
        }
      }
    },
    [photos]
  );

  const handleSelectEntry = useCallback(
    (id: string | null) => {
      setSelectedPhotoId(null);
      setSelectedEntryId(id);
      if (id) {
        setFocusTrigger((n) => n + 1);
      }
    },
    []
  );

  const handleDeletePhoto = useCallback((id: string) => {
    void deletePhotoBlob(id);
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        if (target.fallbackPreviewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(target.fallbackPreviewUrl);
        }
      }
      return prev.filter((p) => p.id !== id);
    });
    setWorkEntries((prev) =>
      prev.map((e) => ({
        ...e,
        photoIds: e.photoIds.filter((pid) => pid !== id),
      }))
    );
    setSelectedPhotoId((prev) => (prev === id ? null : prev));
    setManualPinPhotoId((prev) => (prev === id ? null : prev));
  }, []);

  const handleTogglePhotoChecked = useCallback((id: string) => {
    setPhotos((prev) =>
      prev.map((p) => (p.id === id ? {...p, isChecked: !p.isChecked} : p))
    );
  }, []);

  const handleAssignPhotoSection = useCallback(
    (photoId: string, sectionId: string) => {
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId ? {...p, sectionId: sectionId || undefined} : p
        )
      );
    },
    []
  );

  const handleSaveSection = useCallback(
    (data: Omit<WorkSection, 'id' | 'createdAt'>, existingId?: string) => {
      if (existingId) {
        setSections((prev) =>
          prev.map((s) => (s.id === existingId ? {...s, ...data} : s))
        );
      } else {
        const newSection: WorkSection = {
          ...data,
          id:
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `sec-${Date.now()}`,
          color: data.color || SECTION_COLORS[sections.length % SECTION_COLORS.length],
          createdAt: Date.now(),
        };
        setSections((prev) => [...prev, newSection]);
      }
      setSectionModalOpen(false);
      setEditingSection(null);
    },
    [sections.length]
  );

  const handleDeleteSection = useCallback((sectionId: string) => {
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
    setPhotos((prev) =>
      prev.map((p) =>
        p.sectionId === sectionId ? {...p, sectionId: undefined} : p
      )
    );
    setWorkEntries((prev) =>
      prev.map((e) =>
        e.sectionId === sectionId ? {...e, sectionId: undefined} : e
      )
    );
    setActiveSectionId((prev) => (prev === sectionId ? null : prev));
  }, []);

  const handleSaveWorkEntry = useCallback(
    (
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
    ) => {
      const id =
        existingId ||
        (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `work-${Date.now()}`);

      if (existingId) {
        setWorkEntries((prev) =>
          prev.map((e) =>
            e.id === existingId
              ? {
                  ...e,
                  ...data,
                  isGeocoding: true,
                }
              : e
          )
        );
      } else {
        const newEntry: WorkEntry = {
          id,
          ...data,
          isGeocoding: true,
          createdAt: Date.now(),
        };
        setWorkEntries((prev) => [newEntry, ...prev]);
      }

      if (data.sectionId && data.photoIds.length > 0) {
        setPhotos((prev) =>
          prev.map((p) =>
            data.photoIds.includes(p.id)
              ? {...p, sectionId: data.sectionId, workEntryId: id}
              : p
          )
        );
      }

      setWorkModalOpen(false);
      setEditingEntry(null);
      setPickedWorkCoords(null);
      setSelectedPhotoId(null);
      setSelectedEntryId(id);
      setActiveTab('entries');
      setFocusTrigger((n) => n + 1);
      void enrichEntryLocation(id, data.lat, data.lng);
    },
    [enrichEntryLocation]
  );

  const handleToggleEntryStatus = useCallback((entryId: string) => {
    setWorkEntries((prev) =>
      prev.map((e) =>
        e.id === entryId
          ? {
              ...e,
              status: e.status === 'completed' ? 'in_progress' : 'completed',
            }
          : e
      )
    );
  }, []);

  const handleDeleteEntry = useCallback((entryId: string) => {
    setWorkEntries((prev) => prev.filter((e) => e.id !== entryId));
    setSelectedEntryId((prev) => (prev === entryId ? null : prev));
  }, []);

  const handleClearAll = useCallback(() => {
    for (const p of photosRef.current) {
      URL.revokeObjectURL(p.previewUrl);
      if (p.fallbackPreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(p.fallbackPreviewUrl);
      }
    }
    void clearAllWorkspaceStorage();
    setPhotos([]);
    setSections([]);
    setWorkEntries([]);
    setActiveSectionId(null);
    setSelectedPhotoId(null);
    setSelectedEntryId(null);
    setManualPinPhotoId(null);
    setRoadDistances({});
    setUploadNotice(null);
  }, []);

  const handleManualPinAssign = useCallback(
    (photoId: string, lat: number, lng: number) => {
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId
            ? {
                ...p,
                hasGps: true,
                isManualLocation: true,
                lat,
                lng,
                isGeocoding: true,
                location: undefined,
              }
            : p
        )
      );
      setManualPinPhotoId(null);
      setSelectedPhotoId(photoId);
      setFocusTrigger((n) => n + 1);
      void enrichPhotoLocation(photoId, lat, lng);
    },
    [enrichPhotoLocation]
  );

  const handleRoadDistancesComputed = useCallback(
    (distances: Record<string, number>) => {
      setRoadDistances((prev) => {
        let changed = false;
        const next = {...prev};
        for (const [k, v] of Object.entries(distances)) {
          if (next[k] !== v) {
            next[k] = v;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    []
  );

  // Period + Section filtered Photos (shown on map & list)
  const visiblePhotosOnMap = useMemo(() => {
    return photos.filter((p) => {
      if (!isDateInRange(getPhotoDateKey(p), dateRange)) return false;
      if (activeSectionId && p.sectionId !== activeSectionId) return false;
      return true;
    });
  }, [photos, dateRange, activeSectionId]);

  const filteredPhotos = useMemo(() => {
    const base = visiblePhotosOnMap.filter((p) => {
      if (filter === 'with-gps') return p.hasGps;
      if (filter === 'without-gps') return !p.hasGps;
      return true;
    });

    return [...base].sort((a, b) => {
      switch (sort) {
        case 'captured-desc':
          return (
            (b.exif.timestampMs ?? b.uploadedAt) -
            (a.exif.timestampMs ?? a.uploadedAt)
          );
        case 'captured-asc':
          return (
            (a.exif.timestampMs ?? a.uploadedAt) -
            (b.exif.timestampMs ?? b.uploadedAt)
          );
        case 'uploaded-desc':
          return b.uploadedAt - a.uploadedAt;
        case 'name-asc':
          return a.fileName.localeCompare(b.fileName, 'ko');
      }
    });
  }, [visiblePhotosOnMap, filter, sort]);

  const filteredEntries = useMemo(() => {
    return workEntries.filter((e) => {
      if (!isDateInRange(e.workDate, dateRange)) return false;
      if (activeSectionId && e.sectionId !== activeSectionId) return false;
      return true;
    });
  }, [workEntries, dateRange, activeSectionId]);

  const visibleSections = useMemo(() => {
    if (!dateRange.startDate && !dateRange.endDate) return sections;
    return sections.filter((sec) => {
      const overlapsRange =
        (!dateRange.endDate || sec.startDate <= dateRange.endDate) &&
        (!dateRange.startDate || sec.endDate >= dateRange.startDate);
      if (overlapsRange) return true;
      const hasPhotoInRange = photos.some(
        (p) =>
          p.sectionId === sec.id && isDateInRange(getPhotoDateKey(p), dateRange)
      );
      if (hasPhotoInRange) return true;
      return workEntries.some(
        (e) => e.sectionId === sec.id && isDateInRange(e.workDate, dateRange)
      );
    });
  }, [sections, photos, workEntries, dateRange]);

  const sectionProgressLookup = useMemo(() => {
    const lookup: Record<string, SectionProgressSummary> = {};
    for (const sec of sections) {
      lookup[sec.id] = computeSectionProgress(
        sec,
        photos,
        workEntries,
        dateRange,
        roadDistances[sec.id]
      );
    }
    return lookup;
  }, [sections, photos, workEntries, dateRange, roadDistances]);

  const selectedPhoto = useMemo(
    () => photos.find((p) => p.id === selectedPhotoId) || null,
    [photos, selectedPhotoId]
  );

  const selectedEntry = useMemo(
    () => workEntries.find((e) => e.id === selectedEntryId) || null,
    [workEntries, selectedEntryId]
  );

  const manualPinPhoto = useMemo(
    () => photos.find((p) => p.id === manualPinPhotoId) || null,
    [photos, manualPinPhotoId]
  );

  const gpsCount = useMemo(
    () => photos.filter((p) => p.hasGps).length,
    [photos]
  );

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden bg-slate-50 text-slate-900"
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounterRef.current += 1;
        setIsDraggingOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounterRef.current -= 1;
        if (dragCounterRef.current <= 0) {
          dragCounterRef.current = 0;
          setIsDraggingOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDraggingOver(false);
        if (e.dataTransfer.files?.length) {
          void processPhotoFiles(e.dataTransfer.files, true);
        }
      }}
    >
      {/* Required Google Maps Demo Key Quota Banner */}
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-8">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setActiveSectionId(null);
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          PhotoAtlas
        </a>

        <nav
          aria-label="작업 뷰 이동"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
        >
          <button
            type="button"
            onClick={() => setActiveTab('sections')}
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer py-1 border-b-2 ${
              activeTab === 'sections'
                ? 'text-slate-900 border-slate-900'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            작업구간 현황
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('photos')}
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer py-1 border-b-2 ${
              activeTab === 'photos'
                ? 'text-slate-900 border-slate-900'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            사진 주소
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('entries')}
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer py-1 border-b-2 ${
              activeTab === 'entries'
                ? 'text-slate-900 border-slate-900'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            작업 기록
          </button>
          <button
            type="button"
            onClick={() => {
              if (gpsCount > 0 || workEntries.length > 0) {
                setFitTrigger((n) => n + 1);
              }
            }}
            className="whitespace-nowrap shrink-0 transition-colors cursor-pointer py-1 border-b-2 border-transparent hover:text-slate-900"
          >
            지도 맞추기
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleTriggerUpload}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            사진 업로드
          </button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            void processPhotoFiles(e.target.files, true);
          }
          e.target.value = '';
        }}
      />

      {uploadNotice && (
        <div className="bg-slate-900 text-white px-4 py-2 text-xs flex items-center justify-between gap-4 shrink-0">
          <span className="truncate">{uploadNotice}</span>
          <button
            type="button"
            onClick={() => setUploadNotice(null)}
            className="text-slate-300 hover:text-white font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            닫기
          </button>
        </div>
      )}

      {/* Main Split Studio */}
      <main className="flex-1 min-h-0 flex flex-col lg:flex-row relative">
        <PhotoSidebar
          activeTab={activeTab}
          photos={photos}
          filteredPhotos={filteredPhotos}
          sections={visibleSections}
          allSections={sections}
          workEntries={workEntries}
          filteredEntries={filteredEntries}
          activeSectionId={activeSectionId}
          selectedPhotoId={selectedPhotoId}
          selectedEntryId={selectedEntryId}
          filter={filter}
          sort={sort}
          dateRange={dateRange}
          isParsing={isParsing}
          sectionProgressLookup={sectionProgressLookup}
          onTabChange={setActiveTab}
          onFilterChange={setFilter}
          onSortChange={setSort}
          onDateRangeChange={setDateRange}
          onSelectSectionFilter={(secId) => {
            setActiveSectionId(secId);
            setFitTrigger((n) => n + 1);
          }}
          onOpenNewSection={() => {
            setEditingSection(null);
            setSectionModalOpen(true);
          }}
          onEditSection={(sec) => {
            setEditingSection(sec);
            setSectionModalOpen(true);
          }}
          onDeleteSection={handleDeleteSection}
          onAutoClusterSections={handleAutoClusterSections}
          onSelectPhoto={handleSelectPhoto}
          onTogglePhotoChecked={handleTogglePhotoChecked}
          onAssignPhotoSection={handleAssignPhotoSection}
          onHoverPhoto={setHoveredPhotoId}
          onDeletePhoto={handleDeletePhoto}
          onSelectEntry={handleSelectEntry}
          onToggleEntryStatus={handleToggleEntryStatus}
          onDeleteEntry={handleDeleteEntry}
          onOpenNewWorkEntry={() => {
            setEditingEntry(null);
            setPickedWorkCoords(null);
            setWorkModalOpen(true);
          }}
          onClearAll={handleClearAll}
          onTriggerUpload={handleTriggerUpload}
          onExportGeoJson={() =>
            exportPhotosAsGeoJson(photos, sections, workEntries)
          }
        />

        <section
          aria-label="Google 지도 뷰포트"
          className="flex-1 relative min-h-[360px] lg:min-h-0 h-full"
        >
          {isLoadingKey ? (
            <div className="w-full h-full flex items-center justify-center bg-slate-100 text-sm text-slate-500">
              Google 지도를 불러오는 중입니다...
            </div>
          ) : !apiKey ? (
            <div className="w-full h-full flex items-center justify-center bg-slate-100 p-6">
              <div className="max-w-md bg-white border border-slate-200 rounded-xl p-6 text-center shadow-sm">
                <p className="text-sm font-semibold text-slate-900">
                  Google Maps API 키가 필요합니다
                </p>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  Google Maps Platform 설정을 완료하면 지도와 도로 연결·주소 변환 기능을 사용할 수 있습니다.
                </p>
              </div>
            </div>
          ) : (
            <APIProvider
              apiKey={apiKey}
              libraries={['marker', 'routes']}
              language="ko"
              region="KR"
            >
              <PhotoMapViewport
                photos={visiblePhotosOnMap}
                sections={visibleSections}
                workEntries={filteredEntries}
                activeSectionId={activeSectionId}
                selectedPhotoId={selectedPhotoId}
                selectedEntryId={selectedEntryId}
                hoveredPhotoId={hoveredPhotoId}
                manualPinPhoto={manualPinPhoto}
                isPickingWorkLocation={isPickingWorkLocation}
                mapLayer={mapLayer}
                showSectionPaths={showSectionPaths}
                fitTrigger={fitTrigger}
                focusTrigger={focusTrigger}
                sectionProgressLookup={sectionProgressLookup}
                onSelectPhoto={handleSelectPhoto}
                onSelectEntry={handleSelectEntry}
                onSelectSectionFilter={(secId) => {
                  setActiveSectionId(secId);
                  setFitTrigger((n) => n + 1);
                }}
                onHoverPhoto={setHoveredPhotoId}
                onMapLayerChange={setMapLayer}
                onToggleSectionPaths={() => setShowSectionPaths((v) => !v)}
                onFitAll={() => setFitTrigger((n) => n + 1)}
                onManualPinAssign={handleManualPinAssign}
                onCancelManualPin={() => setManualPinPhotoId(null)}
                onPickWorkLocation={(lat, lng) => {
                  setIsPickingWorkLocation(false);
                  setPickedWorkCoords({lat, lng});
                  setWorkModalOpen(true);
                }}
                onCancelWorkLocationPick={() => setIsPickingWorkLocation(false)}
                onStartWorkEntryPick={() => {
                  setManualPinPhotoId(null);
                  setEditingEntry(null);
                  setIsPickingWorkLocation(true);
                }}
                onTriggerUpload={handleTriggerUpload}
                onRoadDistancesComputed={handleRoadDistancesComputed}
              />
            </APIProvider>
          )}

          {(selectedPhoto || selectedEntry) && (
            <PhotoInspector
              photo={selectedPhoto}
              workEntry={selectedEntry}
              allPhotos={photos}
              sections={sections}
              isAssigningManualPin={
                selectedPhoto ? manualPinPhotoId === selectedPhoto.id : false
              }
              onClose={() => {
                setSelectedPhotoId(null);
                setSelectedEntryId(null);
                setManualPinPhotoId(null);
              }}
              onStartManualPin={(photoId) =>
                setManualPinPhotoId((prev) =>
                  prev === photoId ? null : photoId
                )
              }
              onTogglePhotoChecked={handleTogglePhotoChecked}
              onAssignPhotoSection={handleAssignPhotoSection}
              onEditWorkEntry={(entry) => {
                setEditingEntry(entry);
                setPickedWorkCoords({lat: entry.lat, lng: entry.lng});
                setWorkModalOpen(true);
              }}
              onToggleEntryStatus={handleToggleEntryStatus}
              onSelectPhotoFromEntry={(pid) => handleSelectPhoto(pid)}
              onFocusOnMap={() => setFocusTrigger((n) => n + 1)}
            />
          )}
        </section>
      </main>

      <TimelineFilterBar
        photos={photos}
        sections={sections}
        workEntries={workEntries}
        dateRange={dateRange}
        visibleSectionCount={visibleSections.length}
        visiblePhotoCount={visiblePhotosOnMap.length}
        visibleEntryCount={filteredEntries.length}
        onDateRangeChange={setDateRange}
      />

      {/* Modals */}
      {sectionModalOpen && (
        <SectionModal
          section={editingSection}
          onClose={() => {
            setSectionModalOpen(false);
            setEditingSection(null);
          }}
          onSave={handleSaveSection}
        />
      )}

      {workModalOpen && (
        <WorkEntryModal
          initialEntry={editingEntry}
          pickedCoords={pickedWorkCoords}
          sections={sections}
          photos={photos}
          onClose={() => {
            setWorkModalOpen(false);
            setEditingEntry(null);
            setPickedWorkCoords(null);
          }}
          onRequestMapPick={() => {
            setWorkModalOpen(false);
            setIsPickingWorkLocation(true);
          }}
          onUploadAttachPhotos={(fileList) => processPhotoFiles(fileList, false)}
          onSave={handleSaveWorkEntry}
        />
      )}

      {isDraggingOver && (
        <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-6 pointer-events-none">
          <div className="bg-white border-2 border-dashed border-blue-600 rounded-2xl px-10 py-8 text-center shadow-2xl max-w-sm">
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3">
              <ImagePlus className="w-6 h-6" />
            </div>
            <p className="text-base font-semibold text-slate-900">
              여기에 작업 사진을 놓으세요
            </p>
            <p className="text-xs text-slate-500 mt-1">
              GPS를 분석해 작업구간 색상 표기, 도로 연결 및 정확한 주소를 판별합니다
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
