import {
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  MapMouseEvent,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  Check,
  ClipboardCheck,
  Crosshair,
  ExternalLink,
  ImagePlus,
  Layers,
  Maximize2,
  Plus,
  Route as RouteIcon,
  Upload,
  X,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {
  MapLayerType,
  PhotoItem,
  WorkEntry,
  WorkSection,
} from '../types/photo';
import {formatDecimalCoords} from '../utils/exif';
import {formatDistance} from '../utils/geo';
import {PhotoThumbnail} from './PhotoThumbnail';

const DEFAULT_CENTER = {lat: 37.5665, lng: 126.978};
const DEFAULT_ZOOM = 11;
const Z_INDEX_SELECTED = 1000;
const Z_INDEX_HOVER = 999;

interface PhotoMarkerProps {
  photo: PhotoItem & {lat: number; lng: number};
  sectionColor: string;
  isSelected: boolean;
  isHovered: boolean;
  zIndex: number;
  orderIndex?: number;
  showOrderBadge: boolean;
  onSelect: (id: string, marker: google.maps.marker.AdvancedMarkerElement) => void;
  onHoverChange: (id: string | null) => void;
}

function PhotoMarkerPin({
  photo,
  sectionColor,
  isSelected,
  isHovered,
  zIndex,
  orderIndex,
  showOrderBadge,
  onSelect,
  onHoverChange,
}: PhotoMarkerProps) {
  const [markerRef, marker] = useAdvancedMarkerRef();

  const handleClick = useCallback(() => {
    if (marker) {
      onSelect(photo.id, marker);
    }
  }, [marker, onSelect, photo.id]);

  const active = isSelected || isHovered;

  return (
    <AdvancedMarker
      ref={markerRef}
      position={{lat: photo.lat, lng: photo.lng}}
      zIndex={zIndex}
      title={photo.location?.shortAddress || photo.fileName}
      onClick={handleClick}
    >
      <div
        onMouseEnter={() => onHoverChange(photo.id)}
        onMouseLeave={() => onHoverChange(null)}
        className={`relative flex flex-col items-center cursor-pointer transition-transform duration-150 ${
          active ? 'scale-110' : 'hover:scale-105'
        }`}
      >
        <div
          className="relative w-12 h-12 rounded-lg overflow-hidden bg-white p-0.5 shadow-md transition-all"
          style={{
            boxShadow: isSelected
              ? `0 0 0 3px ${sectionColor}, 0 10px 15px -3px rgb(0 0 0 / 0.2)`
              : isHovered
                ? `0 0 0 2px ${sectionColor}, 0 8px 12px -3px rgb(0 0 0 / 0.18)`
                : `0 0 0 2px ${sectionColor}`,
          }}
        >
          <PhotoThumbnail
            src={photo.previewUrl}
            fallbackSrc={photo.fallbackPreviewUrl}
            alt={photo.fileName}
            className="w-full h-full object-cover rounded-[5px]"
          />
          {showOrderBadge && orderIndex !== undefined && (
            <span
              className="absolute top-0.5 left-0.5 min-w-4 h-4 px-1 rounded text-white text-[10px] font-mono font-semibold flex items-center justify-center tabular-nums"
              style={{backgroundColor: sectionColor}}
            >
              {orderIndex + 1}
            </span>
          )}
          {photo.isChecked && (
            <span className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Check className="w-2.5 h-2.5" />
            </span>
          )}
        </div>
        <div
          className="w-2.5 h-2.5 -mt-1.5 rotate-45"
          style={{backgroundColor: sectionColor}}
        />
      </div>
    </AdvancedMarker>
  );
}

interface WorkEntryMarkerProps {
  entry: WorkEntry;
  sectionColor: string;
  isSelected: boolean;
  onSelect: (id: string, marker: google.maps.marker.AdvancedMarkerElement) => void;
}

function WorkEntryMarkerPin({
  entry,
  sectionColor,
  isSelected,
  onSelect,
}: WorkEntryMarkerProps) {
  const [markerRef, marker] = useAdvancedMarkerRef();

  const handleClick = useCallback(() => {
    if (marker) {
      onSelect(entry.id, marker);
    }
  }, [marker, onSelect, entry.id]);

  return (
    <AdvancedMarker
      ref={markerRef}
      position={{lat: entry.lat, lng: entry.lng}}
      zIndex={isSelected ? Z_INDEX_SELECTED + 10 : 850}
      title={entry.title}
      onClick={handleClick}
    >
      <div
        className={`flex flex-col items-center cursor-pointer transition-transform duration-150 ${
          isSelected ? 'scale-110' : 'hover:scale-105'
        }`}
      >
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white shadow-lg border-2 ${
            isSelected ? 'ring-2 ring-blue-400' : ''
          }`}
          style={{borderColor: sectionColor}}
        >
          <ClipboardCheck
            className="w-3.5 h-3.5 shrink-0"
            style={{
              color: entry.status === 'completed' ? '#34D399' : '#FBBF24',
            }}
          />
          <span className="text-[11px] font-semibold max-w-[110px] truncate">
            {entry.title}
          </span>
          {entry.photoIds.length > 0 && (
            <span className="text-[10px] font-mono text-slate-300 tabular-nums">
              {entry.photoIds.length}
            </span>
          )}
        </div>
        <div
          className="w-2.5 h-2.5 -mt-1.5 rotate-45"
          style={{backgroundColor: sectionColor}}
        />
      </div>
    </AdvancedMarker>
  );
}

interface CameraControllerProps {
  points: Array<{lat: number; lng: number}>;
  selectedTarget: {lat: number; lng: number} | null;
  fitTrigger: number;
  focusTrigger: number;
}

function MapCameraController({
  points,
  selectedTarget,
  fitTrigger,
  focusTrigger,
}: CameraControllerProps) {
  const map = useMap();
  const prevFitTrigger = useRef(0);
  const prevFocusTrigger = useRef(0);

  const fitAll = useCallback(() => {
    if (!map || points.length === 0) return;

    if (points.length === 1) {
      map.panTo(points[0]);
      map.setZoom(15);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    for (const p of points) {
      bounds.extend(p);
    }
    map.fitBounds(bounds, {top: 72, right: 72, bottom: 72, left: 72});
  }, [map, points]);

  useEffect(() => {
    if (!map) return;
    if (fitTrigger !== prevFitTrigger.current) {
      prevFitTrigger.current = fitTrigger;
      fitAll();
    }
  }, [map, fitTrigger, fitAll]);

  useEffect(() => {
    if (!map || !selectedTarget) return;
    if (focusTrigger !== prevFocusTrigger.current) {
      prevFocusTrigger.current = focusTrigger;
      map.panTo(selectedTarget);
      const currentZoom = map.getZoom() ?? 11;
      if (currentZoom < 14) {
        map.setZoom(15);
      }
    }
  }, [map, selectedTarget, focusTrigger]);

  return null;
}

interface SectionRouteGroup {
  sectionId: string;
  color: string;
  points: Array<{lat: number; lng: number}>;
  isActive: boolean;
}

interface SectionRoutesOverlayProps {
  groups: SectionRouteGroup[];
  visible: boolean;
  onDistancesComputed: (distances: Record<string, number>) => void;
}

function SectionRoutesOverlay({
  groups,
  visible,
  onDistancesComputed,
}: SectionRoutesOverlayProps) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const routeCacheRef = useRef<
    Record<string, {path: google.maps.LatLngLiteral[]; distanceMeters: number}>
  >({});

  useEffect(() => {
    if (!map || !visible) return;

    let cancelled = false;
    const polylines: google.maps.Polyline[] = [];

    const drawGroupPolyline = (
      path: google.maps.LatLngLiteral[],
      color: string,
      isActive: boolean,
      isRoadSnapped: boolean
    ) => {
      const polyline = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: color,
        strokeOpacity: isActive ? 0.95 : 0.78,
        strokeWeight: isActive ? 6 : 4.5,
        icons: [
          {
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 2.5,
              strokeColor: '#FFFFFF',
              fillColor: color,
              fillOpacity: 1,
            },
            offset: '24px',
            repeat: '110px',
          },
        ],
        ...(isRoadSnapped
          ? {}
          : {
              strokeOpacity: 0.65,
            }),
        map,
      });
      polylines.push(polyline);
    };

    const run = async () => {
      const computedDistances: Record<string, number> = {};

      for (const group of groups) {
        if (group.points.length < 2) continue;

        const sig = `${group.sectionId}:${group.points
          .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
          .join('|')}`;

        const cached = routeCacheRef.current[sig];
        if (cached) {
          if (!cancelled) {
            drawGroupPolyline(cached.path, group.color, group.isActive, true);
            computedDistances[group.sectionId] = cached.distanceMeters;
          }
          continue;
        }

        // Attempt road-following route using modern Routes API SDK wrapper
        if (routesLib && group.points.length <= 25) {
          try {
            const origin = group.points[0];
            const destination = group.points[group.points.length - 1];
            const intermediates =
              group.points.length > 2
                ? group.points.slice(1, -1).map((pt) => ({location: pt}))
                : undefined;

            const request: Record<string, unknown> = {
              origin,
              destination,
              travelMode: 'DRIVING',
              fields: ['path', 'distanceMeters'],
            };
            if (intermediates && intermediates.length > 0) {
              request.intermediates = intermediates;
            }

            const response = await (
              routesLib.Route as unknown as {
                computeRoutes: (req: Record<string, unknown>) => Promise<{
                  routes?: Array<{
                    path?: Array<google.maps.LatLng | google.maps.LatLngLiteral>;
                    distanceMeters?: number;
                    createPolylines?: () => google.maps.Polyline[];
                  }>;
                }>;
              }
            ).computeRoutes(request);

            const primaryRoute = response?.routes?.[0];
            if (primaryRoute && !cancelled) {
              let decodedPath: google.maps.LatLngLiteral[] = [];
              if (primaryRoute.path && primaryRoute.path.length > 0) {
                decodedPath = primaryRoute.path.map((pt) =>
                  typeof (pt as google.maps.LatLng).lat === 'function'
                    ? {
                        lat: (pt as google.maps.LatLng).lat(),
                        lng: (pt as google.maps.LatLng).lng(),
                      }
                    : (pt as google.maps.LatLngLiteral)
                );
              } else if (primaryRoute.createPolylines) {
                const tempLines = primaryRoute.createPolylines();
                for (const line of tempLines) {
                  const arr = line.getPath().getArray();
                  for (const pt of arr) {
                    decodedPath.push({lat: pt.lat(), lng: pt.lng()});
                  }
                  line.setMap(null);
                }
              }

              if (decodedPath.length >= 2) {
                const dist = primaryRoute.distanceMeters ?? 0;
                routeCacheRef.current[sig] = {
                  path: decodedPath,
                  distanceMeters: dist,
                };
                drawGroupPolyline(
                  decodedPath,
                  group.color,
                  group.isActive,
                  true
                );
                if (dist > 0) {
                  computedDistances[group.sectionId] = dist;
                }
                continue;
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (
              msg.includes('RESOURCE_EXHAUSTED') ||
              msg.includes('OVER_QUERY_LIMIT')
            ) {
              window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
            }
            // Fall back cleanly to direct path polyline below
          }
        }

        if (!cancelled) {
          drawGroupPolyline(group.points, group.color, group.isActive, false);
        }
      }

      if (!cancelled && Object.keys(computedDistances).length > 0) {
        onDistancesComputed(computedDistances);
      }
    };

    void run();

    return () => {
      cancelled = true;
      for (const p of polylines) {
        p.setMap(null);
      }
    };
  }, [map, routesLib, groups, visible, onDistancesComputed]);

  return null;
}

interface PhotoMapViewportProps {
  photos: PhotoItem[];
  sections: WorkSection[];
  workEntries: WorkEntry[];
  activeSectionId: string | null;
  selectedPhotoId: string | null;
  selectedEntryId: string | null;
  hoveredPhotoId: string | null;
  manualPinPhoto: PhotoItem | null;
  isPickingWorkLocation: boolean;
  mapLayer: MapLayerType;
  showSectionPaths: boolean;
  fitTrigger: number;
  focusTrigger: number;
  sectionProgressLookup: Record<string, {progressPercent: number; measuredDistanceMeters: number}>;
  onSelectPhoto: (id: string | null) => void;
  onSelectEntry: (id: string | null) => void;
  onSelectSectionFilter: (sectionId: string | null) => void;
  onHoverPhoto: (id: string | null) => void;
  onMapLayerChange: (layer: MapLayerType) => void;
  onToggleSectionPaths: () => void;
  onFitAll: () => void;
  onManualPinAssign: (photoId: string, lat: number, lng: number) => void;
  onCancelManualPin: () => void;
  onPickWorkLocation: (lat: number, lng: number) => void;
  onCancelWorkLocationPick: () => void;
  onStartWorkEntryPick: () => void;
  onTriggerUpload: () => void;
  onRoadDistancesComputed: (distances: Record<string, number>) => void;
}

const LAYER_OPTIONS: Array<{id: MapLayerType; label: string}> = [
  {id: 'roadmap', label: '지도'},
  {id: 'satellite', label: '위성'},
  {id: 'hybrid', label: '하이브리드'},
  {id: 'terrain', label: '지형'},
];

export function PhotoMapViewport({
  photos,
  sections,
  workEntries,
  activeSectionId,
  selectedPhotoId,
  selectedEntryId,
  hoveredPhotoId,
  manualPinPhoto,
  isPickingWorkLocation,
  mapLayer,
  showSectionPaths,
  fitTrigger,
  focusTrigger,
  sectionProgressLookup,
  onSelectPhoto,
  onSelectEntry,
  onSelectSectionFilter,
  onHoverPhoto,
  onMapLayerChange,
  onToggleSectionPaths,
  onFitAll,
  onManualPinAssign,
  onCancelManualPin,
  onPickWorkLocation,
  onCancelWorkLocationPick,
  onStartWorkEntryPick,
  onTriggerUpload,
  onRoadDistancesComputed,
}: PhotoMapViewportProps) {
  const [anchorMarker, setAnchorMarker] =
    useState<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [infoOpenForPhotoId, setInfoOpenForPhotoId] = useState<string | null>(
    null
  );

  const sectionColorLookup = useMemo(() => {
    const lookup: Record<string, string> = {};
    for (const s of sections) {
      lookup[s.id] = s.color;
    }
    return lookup;
  }, [sections]);

  const gpsPhotos = useMemo(() => {
    return photos
      .filter(
        (p): p is PhotoItem & {lat: number; lng: number} =>
          p.hasGps && typeof p.lat === 'number' && typeof p.lng === 'number'
      )
      .sort((a, b) => b.lat - a.lat);
  }, [photos]);

  const routeGroups = useMemo<SectionRouteGroup[]>(() => {
    const grouped: Record<string, Array<PhotoItem & {lat: number; lng: number}>> =
      {};
    for (const p of gpsPhotos) {
      const key = p.sectionId || '__unassigned__';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(p);
    }

    const result: SectionRouteGroup[] = [];
    for (const [secId, list] of Object.entries(grouped)) {
      if (list.length < 2) continue;
      const ordered = [...list].sort(
        (a, b) =>
          (a.exif.timestampMs ?? a.uploadedAt) -
          (b.exif.timestampMs ?? b.uploadedAt)
      );
      result.push({
        sectionId: secId,
        color:
          secId === '__unassigned__'
            ? '#475569'
            : sectionColorLookup[secId] || '#2563EB',
        points: ordered.map((p) => ({lat: p.lat, lng: p.lng})),
        isActive: activeSectionId === secId,
      });
    }
    return result;
  }, [gpsPhotos, sectionColorLookup, activeSectionId]);

  const timelineOrderLookup = useMemo(() => {
    const lookup: Record<string, number> = {};
    for (const group of routeGroups) {
      const groupPhotos = gpsPhotos
        .filter((p) => (p.sectionId || '__unassigned__') === group.sectionId)
        .sort(
          (a, b) =>
            (a.exif.timestampMs ?? a.uploadedAt) -
            (b.exif.timestampMs ?? b.uploadedAt)
        );
      groupPhotos.forEach((p, idx) => {
        lookup[p.id] = idx;
      });
    }
    return lookup;
  }, [gpsPhotos, routeGroups]);

  const allPoints = useMemo(() => {
    return [
      ...gpsPhotos.map((p) => ({lat: p.lat, lng: p.lng})),
      ...workEntries.map((e) => ({lat: e.lat, lng: e.lng})),
    ];
  }, [gpsPhotos, workEntries]);

  const selectedTarget = useMemo(() => {
    if (selectedPhotoId) {
      const p = gpsPhotos.find((x) => x.id === selectedPhotoId);
      if (p) return {lat: p.lat, lng: p.lng};
    }
    if (selectedEntryId) {
      const e = workEntries.find((x) => x.id === selectedEntryId);
      if (e) return {lat: e.lat, lng: e.lng};
    }
    return null;
  }, [selectedPhotoId, selectedEntryId, gpsPhotos, workEntries]);

  const infoPhoto = useMemo(
    () => gpsPhotos.find((p) => p.id === infoOpenForPhotoId) || null,
    [gpsPhotos, infoOpenForPhotoId]
  );

  useEffect(() => {
    if (!selectedPhotoId) {
      setInfoOpenForPhotoId(null);
      setAnchorMarker(null);
    }
  }, [selectedPhotoId]);

  const handlePhotoMarkerSelect = useCallback(
    (id: string, marker: google.maps.marker.AdvancedMarkerElement) => {
      onSelectEntry(null);
      onSelectPhoto(id);
      setAnchorMarker(marker);
      setInfoOpenForPhotoId(id);
    },
    [onSelectPhoto, onSelectEntry]
  );

  const handleEntryMarkerSelect = useCallback(
    (id: string) => {
      onSelectPhoto(null);
      setInfoOpenForPhotoId(null);
      onSelectEntry(id);
    },
    [onSelectPhoto, onSelectEntry]
  );

  const handleMapClick = useCallback(
    (event: MapMouseEvent) => {
      if (event.detail.latLng) {
        if (manualPinPhoto) {
          onManualPinAssign(
            manualPinPhoto.id,
            event.detail.latLng.lat,
            event.detail.latLng.lng
          );
          return;
        }
        if (isPickingWorkLocation) {
          onPickWorkLocation(
            event.detail.latLng.lat,
            event.detail.latLng.lng
          );
          return;
        }
      }
      setInfoOpenForPhotoId(null);
    },
    [
      manualPinPhoto,
      isPickingWorkLocation,
      onManualPinAssign,
      onPickWorkLocation,
    ]
  );

  const isPickingMode = Boolean(manualPinPhoto) || isPickingWorkLocation;

  return (
    <div
      className={`relative w-full h-full bg-slate-100 ${
        isPickingMode ? 'cursor-crosshair' : ''
      }`}
    >
      <GoogleMap
        mapId="DEMO_MAP_ID"
        mapTypeId={mapLayer}
        defaultCenter={DEFAULT_CENTER}
        defaultZoom={DEFAULT_ZOOM}
        gestureHandling="greedy"
        mapTypeControl={false}
        fullscreenControl={false}
        streetViewControl={true}
        zoomControl={true}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        onClick={handleMapClick}
        style={{width: '100%', height: '100%'}}
      >
        <MapCameraController
          points={allPoints}
          selectedTarget={selectedTarget}
          fitTrigger={fitTrigger}
          focusTrigger={focusTrigger}
        />

        <SectionRoutesOverlay
          groups={routeGroups}
          visible={showSectionPaths}
          onDistancesComputed={onRoadDistancesComputed}
        />

        {gpsPhotos.map((photo, index) => {
          let zIndex = index;
          if (hoveredPhotoId === photo.id) zIndex = Z_INDEX_HOVER;
          if (selectedPhotoId === photo.id) zIndex = Z_INDEX_SELECTED;
          const color = photo.sectionId
            ? sectionColorLookup[photo.sectionId] || '#2563EB'
            : '#2563EB';

          return (
            <PhotoMarkerPin
              key={photo.id}
              photo={photo}
              sectionColor={color}
              isSelected={selectedPhotoId === photo.id}
              isHovered={hoveredPhotoId === photo.id}
              zIndex={zIndex}
              orderIndex={timelineOrderLookup[photo.id]}
              showOrderBadge={showSectionPaths}
              onSelect={handlePhotoMarkerSelect}
              onHoverChange={onHoverPhoto}
            />
          );
        })}

        {workEntries.map((entry) => (
          <WorkEntryMarkerPin
            key={entry.id}
            entry={entry}
            sectionColor={
              entry.sectionId
                ? sectionColorLookup[entry.sectionId] || '#0F172A'
                : '#0F172A'
            }
            isSelected={selectedEntryId === entry.id}
            onSelect={handleEntryMarkerSelect}
          />
        ))}

        {infoPhoto && anchorMarker && (
          <InfoWindow
            anchor={anchorMarker}
            maxWidth={270}
            pixelOffset={[0, -4]}
            onCloseClick={() => setInfoOpenForPhotoId(null)}
          >
            <div className="p-0.5 text-slate-900 font-sans">
              <div className="w-full h-32 rounded-md overflow-hidden bg-slate-100 mb-2">
                <PhotoThumbnail
                  src={infoPhoto.previewUrl}
                  fallbackSrc={infoPhoto.fallbackPreviewUrl}
                  alt={infoPhoto.fileName}
                  className="w-full h-full object-cover"
                />
              </div>
              <p className="text-xs font-semibold text-slate-900 truncate">
                {infoPhoto.location?.shortAddress || infoPhoto.fileName}
              </p>
              {infoPhoto.location?.formattedAddress && (
                <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                  {infoPhoto.location.formattedAddress}
                </p>
              )}
              <div className="flex items-center justify-between gap-2 mt-2 pt-1.5 border-t border-slate-100 text-[11px] text-slate-500">
                <span className="font-mono tabular-nums">
                  {formatDecimalCoords(infoPhoto.lat, infoPhoto.lng)}
                </span>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${infoPhoto.lat},${infoPhoto.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap shrink-0"
                >
                  지도
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>

      {/* Top Floating Map Controls */}
      <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none z-10">
        <div className="flex items-center gap-1 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg p-1 shadow-sm pointer-events-auto">
          <Layers className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-1 hidden sm:block" />
          {LAYER_OPTIONS.map((layer) => (
            <button
              key={layer.id}
              type="button"
              onClick={() => onMapLayerChange(layer.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mapLayer === layer.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {layer.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 pointer-events-auto flex-wrap">
          <button
            type="button"
            onClick={onStartWorkEntryPick}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-white shadow-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            지도에 작업·사진 등록
          </button>

          {routeGroups.length > 0 && (
            <button
              type="button"
              onClick={onToggleSectionPaths}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border shadow-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showSectionPaths
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white/95 border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <RouteIcon className="w-3.5 h-3.5" />
              구간 경로 {showSectionPaths ? '표시중' : '숨김'}
            </button>
          )}

          {allPoints.length > 0 && (
            <button
              type="button"
              onClick={onFitAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white/95 border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              전체 보기
            </button>
          )}
        </div>
      </div>

      {/* Section Legend Overlay */}
      {sections.length > 0 && (
        <div className="hidden sm:flex flex-col gap-1.5 absolute bottom-4 left-3 z-10 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl p-2.5 shadow-md max-w-[240px]">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-[11px] font-semibold text-slate-500">
              작업구간 ({sections.length})
            </span>
            {activeSectionId && (
              <button
                type="button"
                onClick={() => onSelectSectionFilter(null)}
                className="text-[11px] text-blue-600 hover:underline cursor-pointer"
              >
                전체 보기
              </button>
            )}
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {sections.map((sec) => {
              const prog = sectionProgressLookup[sec.id];
              const isSelected = activeSectionId === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() =>
                    onSelectSectionFilter(isSelected ? null : sec.id)
                  }
                  className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md text-left text-xs transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900 text-white'
                      : 'hover:bg-slate-100 text-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{backgroundColor: sec.color}}
                    />
                    <span className="truncate font-medium">{sec.name}</span>
                  </span>
                  {prog && (
                    <span
                      className={`font-mono text-[11px] tabular-nums shrink-0 ${
                        isSelected ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {prog.measuredDistanceMeters > 0
                        ? formatDistance(prog.measuredDistanceMeters)
                        : `${prog.progressPercent}%`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Manual Pin or Work Location Pick Banner */}
      {isPickingMode && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg max-w-[92vw]">
          <Crosshair className="w-4 h-4 text-blue-400 shrink-0" />
          <p className="text-xs sm:text-sm font-medium truncate">
            {manualPinPhoto
              ? `지도를 클릭해 ${manualPinPhoto.fileName}의 위치를 지정하세요`
              : '지도를 클릭해 작업 및 사진 첨부 위치를 선택하세요'}
          </p>
          <button
            type="button"
            onClick={
              manualPinPhoto ? onCancelManualPin : onCancelWorkLocationPick
            }
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-white/15 hover:bg-white/25 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            취소
          </button>
        </div>
      )}

      {/* Initial Empty State Card over Live Map */}
      {photos.length === 0 && workEntries.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none z-10">
          <div className="pointer-events-auto max-w-md w-full bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl p-6 shadow-lg text-center">
            <div className="w-11 h-11 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3.5">
              <ImagePlus className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">
              작업팀 사진을 올려 구간을 자동 분석하세요
            </h2>
            <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
              GPS가 담긴 현장 사진을 여러 장 올리면 작업구간을 색상별로 자동 분류하고, 도로를 따라 경로를 이어 정확한 주소와 진행도를 표시합니다.
            </p>
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={onTriggerUpload}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                현장 사진 올리기
              </button>
              <button
                type="button"
                onClick={onStartWorkEntryPick}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                지도에 작업 등록
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-3.5">
              JPG · HEIC · PNG · WebP 지원 · 기간별 작업 진행도 체크 가능
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
