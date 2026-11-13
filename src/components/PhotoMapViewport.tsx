import L from 'leaflet';
import {
  Crosshair,
  ImagePlus,
  Layers,
  Maximize2,
  Plus,
  Route as RouteIcon,
  Upload,
  X,
} from 'lucide-react';
import {type MutableRefObject, useEffect, useMemo, useRef} from 'react';
import type {
  MapLayerType,
  PhotoItem,
  WorkEntry,
  WorkSection,
} from '../types/photo';
import {formatDecimalCoords} from '../utils/exif';
import {formatDistance} from '../utils/geo';

const DEFAULT_CENTER: [number, number] = [37.5665, 126.978];
const DEFAULT_ZOOM = 11;

interface SectionRouteGroup {
  sectionId: string;
  color: string;
  points: Array<{lat: number; lng: number}>;
  isActive: boolean;
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
  sectionProgressLookup: Record<
    string,
    {progressPercent: number; measuredDistanceMeters: number}
  >;
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
  mapCaptureRef?: MutableRefObject<(() => Promise<string | null>) | null>;
}

const LAYER_OPTIONS: Array<{id: MapLayerType; label: string}> = [
  {id: 'roadmap', label: '지도'},
  {id: 'satellite', label: '위성'},
  {id: 'hybrid', label: '하이브리드'},
  {id: 'terrain', label: '지형'},
];

function createTileLayers(layer: MapLayerType): L.TileLayer[] {
  switch (layer) {
    case 'satellite':
      return [
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            maxZoom: 19,
            attribution: '&copy; Esri, Maxar, Earthstar Geographics',
          }
        ),
      ];
    case 'hybrid':
      return [
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            maxZoom: 19,
            attribution: '&copy; Esri',
          }
        ),
        L.tileLayer(
          'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
          {
            subdomains: 'abcd',
            maxZoom: 19,
            attribution: '&copy; CARTO',
          }
        ),
      ];
    case 'terrain':
      return [
        L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
          maxZoom: 17,
          attribution: '&copy; OpenStreetMap, SRTM &copy; OpenTopoMap',
        }),
      ];
    case 'roadmap':
    default:
      return [
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }),
      ];
  }
}

function createCheckSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '10');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '3');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const poly = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'polyline'
  );
  poly.setAttribute('points', '20 6 9 17 4 12');
  svg.appendChild(poly);
  return svg;
}

function createClipboardCheckSvg(color: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', color);
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.flexShrink = '0';

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '8');
  rect.setAttribute('height', '4');
  rect.setAttribute('x', '8');
  rect.setAttribute('y', '2');
  rect.setAttribute('rx', '1');
  rect.setAttribute('ry', '1');
  svg.appendChild(rect);

  const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path1.setAttribute(
    'd',
    'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'
  );
  svg.appendChild(path1);

  const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path2.setAttribute('d', 'm9 14 2 2 4-4');
  svg.appendChild(path2);

  return svg;
}

function createPhotoFallbackElement(): HTMLElement {
  const box = document.createElement('div');
  box.className =
    'w-full h-full rounded-[5px] bg-slate-100 text-slate-400 flex items-center justify-center';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '18');
  rect.setAttribute('height', '18');
  rect.setAttribute('x', '3');
  rect.setAttribute('y', '3');
  rect.setAttribute('rx', '2');
  svg.appendChild(rect);
  const circle = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'circle'
  );
  circle.setAttribute('cx', '9');
  circle.setAttribute('cy', '9');
  circle.setAttribute('r', '2');
  svg.appendChild(circle);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21');
  svg.appendChild(path);
  box.appendChild(svg);
  return box;
}

function buildPhotoMarkerIcon(
  photo: PhotoItem & {lat: number; lng: number},
  sectionColor: string,
  isSelected: boolean,
  isHovered: boolean,
  orderIndex: number | undefined,
  showOrderBadge: boolean,
  onHover: (id: string | null) => void
): L.DivIcon {
  const wrapper = document.createElement('div');
  const active = isSelected || isHovered;
  wrapper.className = `relative flex flex-col items-center cursor-pointer transition-transform duration-150 ${
    active ? 'scale-110' : 'hover:scale-105'
  }`;
  wrapper.addEventListener('mouseenter', () => onHover(photo.id));
  wrapper.addEventListener('mouseleave', () => onHover(null));

  const card = document.createElement('div');
  card.className =
    'relative w-12 h-12 rounded-lg overflow-hidden bg-white p-0.5 shadow-md transition-all';
  card.style.boxShadow = isSelected
    ? `0 0 0 3px ${sectionColor}, 0 10px 15px -3px rgb(0 0 0 / 0.25)`
    : isHovered
      ? `0 0 0 2px ${sectionColor}, 0 8px 12px -3px rgb(0 0 0 / 0.2)`
      : `0 0 0 2px ${sectionColor}`;

  const img = document.createElement('img');
  img.src = photo.previewUrl;
  img.alt = photo.fileName;
  img.referrerPolicy = 'no-referrer';
  img.className = 'w-full h-full object-cover rounded-[5px] block';
  let triedFallback = false;
  img.onerror = () => {
    if (!triedFallback && photo.fallbackPreviewUrl) {
      triedFallback = true;
      img.src = photo.fallbackPreviewUrl;
      return;
    }
    img.replaceWith(createPhotoFallbackElement());
  };
  card.appendChild(img);

  if (showOrderBadge && orderIndex !== undefined) {
    const badge = document.createElement('span');
    badge.className =
      'absolute top-0.5 left-0.5 min-w-4 h-4 px-1 rounded text-white text-[10px] font-mono font-semibold flex items-center justify-center tabular-nums';
    badge.style.backgroundColor = sectionColor;
    badge.textContent = String(orderIndex + 1);
    card.appendChild(badge);
  }

  if (photo.isChecked) {
    const checked = document.createElement('span');
    checked.className =
      'absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-xs';
    checked.appendChild(createCheckSvg());
    card.appendChild(checked);
  }

  wrapper.appendChild(card);

  const tip = document.createElement('div');
  tip.className = 'w-2.5 h-2.5 -mt-1.5 rotate-45';
  tip.style.backgroundColor = sectionColor;
  wrapper.appendChild(tip);

  return L.divIcon({
    html: wrapper,
    className: 'photoatlas-marker-icon',
    iconSize: [48, 54],
    iconAnchor: [24, 53],
    popupAnchor: [0, -52],
  });
}

function buildPhotoPopupNode(
  photo: PhotoItem & {lat: number; lng: number}
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'w-[228px] text-slate-900 font-sans';

  const mediaBox = document.createElement('div');
  mediaBox.className =
    'w-full h-28 rounded-md overflow-hidden bg-slate-100 mb-2';
  const img = document.createElement('img');
  img.src = photo.previewUrl;
  img.alt = photo.fileName;
  img.referrerPolicy = 'no-referrer';
  img.className = 'w-full h-full object-cover block';
  let triedFallback = false;
  img.onerror = () => {
    if (!triedFallback && photo.fallbackPreviewUrl) {
      triedFallback = true;
      img.src = photo.fallbackPreviewUrl;
      return;
    }
    img.replaceWith(createPhotoFallbackElement());
  };
  mediaBox.appendChild(img);
  root.appendChild(mediaBox);

  const title = document.createElement('p');
  title.className = 'text-xs font-semibold text-slate-900 truncate m-0';
  title.textContent = photo.location?.shortAddress || photo.fileName;
  root.appendChild(title);

  if (photo.location?.formattedAddress) {
    const addr = document.createElement('p');
    addr.className = 'text-[11px] text-slate-600 mt-0.5 leading-snug mb-0';
    addr.textContent = photo.location.formattedAddress;
    root.appendChild(addr);
  }

  const footer = document.createElement('div');
  footer.className =
    'flex items-center justify-between gap-2 mt-2 pt-1.5 border-t border-slate-100 text-[11px] text-slate-500';

  const coords = document.createElement('span');
  coords.className = 'font-mono tabular-nums';
  coords.textContent = formatDecimalCoords(photo.lat, photo.lng);
  footer.appendChild(coords);

  const link = document.createElement('a');
  link.href = `https://www.openstreetmap.org/?mlat=${photo.lat}&mlon=${photo.lng}#map=17/${photo.lat}/${photo.lng}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className =
    'inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap shrink-0';
  link.textContent = 'OSM';
  footer.appendChild(link);

  root.appendChild(footer);
  return root;
}

function buildWorkEntryMarkerIcon(
  entry: WorkEntry,
  sectionColor: string,
  isSelected: boolean
): L.DivIcon {
  const wrapper = document.createElement('div');
  wrapper.className = `flex flex-col items-center cursor-pointer transition-transform duration-150 ${
    isSelected ? 'scale-110' : 'hover:scale-105'
  }`;

  const pill = document.createElement('div');
  pill.className = `flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white shadow-lg border-2 ${
    isSelected ? 'ring-2 ring-blue-400' : ''
  }`;
  pill.style.borderColor = sectionColor;

  pill.appendChild(
    createClipboardCheckSvg(
      entry.status === 'completed' ? '#34D399' : '#FBBF24'
    )
  );

  const title = document.createElement('span');
  title.className = 'text-[11px] font-semibold max-w-[110px] truncate';
  title.textContent = entry.title;
  pill.appendChild(title);

  if (entry.photoIds.length > 0) {
    const count = document.createElement('span');
    count.className = 'text-[10px] font-mono text-slate-300 tabular-nums';
    count.textContent = String(entry.photoIds.length);
    pill.appendChild(count);
  }

  wrapper.appendChild(pill);

  const tip = document.createElement('div');
  tip.className = 'w-2.5 h-2.5 -mt-1.5 rotate-45';
  tip.style.backgroundColor = sectionColor;
  wrapper.appendChild(tip);

  return L.divIcon({
    html: wrapper,
    className: 'photoatlas-entry-icon',
    iconSize: [148, 36],
    iconAnchor: [74, 35],
  });
}

function computeBearingDeg(
  from: {lat: number; lng: number},
  to: {lat: number; lng: number}
): number {
  const dLat = to.lat - from.lat;
  const dLng = (to.lng - from.lng) * Math.cos((from.lat * Math.PI) / 180);
  return (Math.atan2(dLng, dLat) * 180) / Math.PI;
}

function createDirectionArrowMarker(
  lat: number,
  lng: number,
  bearingDeg: number,
  color: string
): L.Marker {
  const wrap = document.createElement('div');
  wrap.className = 'flex items-center justify-center pointer-events-none';
  wrap.style.transform = `rotate(${bearingDeg}deg)`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  const poly = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'polygon'
  );
  poly.setAttribute('points', '8,1 14,13 8,10 2,13');
  poly.setAttribute('fill', color);
  poly.setAttribute('stroke', '#FFFFFF');
  poly.setAttribute('stroke-width', '1.5');
  poly.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(poly);
  wrap.appendChild(svg);

  return L.marker([lat, lng], {
    interactive: false,
    keyboard: false,
    icon: L.divIcon({
      html: wrap,
      className: 'photoatlas-arrow-icon',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    }),
  });
}

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
  mapCaptureRef,
}: PhotoMapViewportProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const photoLayerRef = useRef<L.LayerGroup | null>(null);
  const entryLayerRef = useRef<L.LayerGroup | null>(null);
  const photoMarkerByIdRef = useRef<Record<string, L.Marker>>({});
  const routeCacheRef = useRef<
    Record<string, {path: Array<{lat: number; lng: number}>; distanceMeters: number}>
  >({});

  const prevFitTriggerRef = useRef(0);
  const prevFocusTriggerRef = useRef(0);

  // Refs for latest callbacks & pick state inside Leaflet click handler
  const pickStateRef = useRef({
    manualPinPhoto,
    isPickingWorkLocation,
    onManualPinAssign,
    onPickWorkLocation,
  });
  pickStateRef.current = {
    manualPinPhoto,
    isPickingWorkLocation,
    onManualPinAssign,
    onPickWorkLocation,
  };

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

  // Initialize Leaflet map once
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: true,
    });

    L.control.zoom({position: 'bottomright'}).addTo(map);

    const tileGroup = L.layerGroup().addTo(map);
    const routeGroup = L.layerGroup().addTo(map);
    const photoGroup = L.layerGroup().addTo(map);
    const entryGroup = L.layerGroup().addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      const {
        manualPinPhoto: pinPhoto,
        isPickingWorkLocation: pickingWork,
        onManualPinAssign: assignPin,
        onPickWorkLocation: pickWork,
      } = pickStateRef.current;

      if (pinPhoto) {
        assignPin(pinPhoto.id, e.latlng.lat, e.latlng.lng);
        return;
      }
      if (pickingWork) {
        pickWork(e.latlng.lat, e.latlng.lng);
      }
    });

    mapRef.current = map;
    tileLayerGroupRef.current = tileGroup;
    routeLayerRef.current = routeGroup;
    photoLayerRef.current = photoGroup;
    entryLayerRef.current = entryGroup;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({pan: false});
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerGroupRef.current = null;
      routeLayerRef.current = null;
      photoLayerRef.current = null;
      entryLayerRef.current = null;
    };
  }, []);

  // Switch free base tile layers
  useEffect(() => {
    const tileGroup = tileLayerGroupRef.current;
    if (!tileGroup) return;
    tileGroup.clearLayers();
    for (const layer of createTileLayers(mapLayer)) {
      tileGroup.addLayer(layer);
    }
  }, [mapLayer]);

  // Update crosshair cursor during picking modes
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;
    const isPicking = Boolean(manualPinPhoto) || isPickingWorkLocation;
    el.style.cursor = isPicking ? 'crosshair' : '';
  }, [manualPinPhoto, isPickingWorkLocation]);

  // Render section routes (cached OSRM road-snapping + directional markers)
  useEffect(() => {
    const routeGroup = routeLayerRef.current;
    if (!routeGroup) return;

    routeGroup.clearLayers();
    if (!showSectionPaths || routeGroups.length === 0) return;

    let cancelled = false;

    const drawPath = (
      layerBucket: L.LayerGroup,
      path: Array<{lat: number; lng: number}>,
      color: string,
      isActive: boolean,
      isRoadSnapped: boolean
    ) => {
      if (path.length < 2) return;
      const latLngs: L.LatLngTuple[] = path.map((p) => [p.lat, p.lng]);

      const line = L.polyline(latLngs, {
        color,
        weight: isActive ? 6 : 4.5,
        opacity: isRoadSnapped ? (isActive ? 0.94 : 0.78) : 0.6,
        dashArray: isRoadSnapped ? undefined : '6 6',
        lineCap: 'round',
        lineJoin: 'round',
      });
      layerBucket.addLayer(line);

      // Draw directional arrows along the path
      const arrowStep = Math.max(1, Math.floor(path.length / 4));
      for (let i = 0; i < path.length - 1; i += arrowStep) {
        const a = path[i];
        const b = path[i + 1];
        const midLat = (a.lat + b.lat) / 2;
        const midLng = (a.lng + b.lng) / 2;
        const bearing = computeBearingDeg(a, b);
        layerBucket.addLayer(
          createDirectionArrowMarker(midLat, midLng, bearing, color)
        );
      }
    };

    const run = async () => {
      const computedDistances: Record<string, number> = {};

      for (const group of routeGroups) {
        if (cancelled) return;
        if (group.points.length < 2) continue;

        const sig = `${group.sectionId}:${group.points
          .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
          .join('|')}`;

        const groupBucket = L.layerGroup();
        routeGroup.addLayer(groupBucket);

        const cached = routeCacheRef.current[sig];
        if (cached) {
          drawPath(groupBucket, cached.path, group.color, group.isActive, true);
          if (cached.distanceMeters > 0) {
            computedDistances[group.sectionId] = cached.distanceMeters;
          }
          continue;
        }

        // Draw immediate fallback polyline while OSRM responds
        drawPath(groupBucket, group.points, group.color, group.isActive, false);

        try {
          const response = await fetch('/api/route', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({points: group.points}),
          });
          if (!response.ok || cancelled) continue;

          const data = (await response.json()) as {
            path?: Array<{lat: number; lng: number}>;
            distanceMeters?: number;
            fallback?: boolean;
          };

          if (
            !cancelled &&
            Array.isArray(data.path) &&
            data.path.length >= 2 &&
            !data.fallback
          ) {
            const dist = data.distanceMeters || 0;
            routeCacheRef.current[sig] = {
              path: data.path,
              distanceMeters: dist,
            };
            groupBucket.clearLayers();
            drawPath(groupBucket, data.path, group.color, group.isActive, true);
            if (dist > 0) {
              computedDistances[group.sectionId] = dist;
            }
          }
        } catch {
          // Keep direct polyline fallback cleanly
        }
      }

      if (!cancelled && Object.keys(computedDistances).length > 0) {
        onRoadDistancesComputed(computedDistances);
      }
    };

    void run();

    return () => {
      cancelled = true;
      routeGroup.clearLayers();
    };
  }, [routeGroups, showSectionPaths, onRoadDistancesComputed]);

  // Render Photo Markers
  useEffect(() => {
    const photoGroup = photoLayerRef.current;
    if (!photoGroup) return;

    photoGroup.clearLayers();
    const nextById: Record<string, L.Marker> = {};

    gpsPhotos.forEach((photo, index) => {
      const color = photo.sectionId
        ? sectionColorLookup[photo.sectionId] || '#2563EB'
        : '#2563EB';
      const isSelected = selectedPhotoId === photo.id;
      const isHovered = hoveredPhotoId === photo.id;

      const marker = L.marker([photo.lat, photo.lng], {
        icon: buildPhotoMarkerIcon(
          photo,
          color,
          isSelected,
          isHovered,
          timelineOrderLookup[photo.id],
          showSectionPaths,
          onHoverPhoto
        ),
        zIndexOffset: isSelected ? 1000 : isHovered ? 800 : index,
        title: photo.location?.shortAddress || photo.fileName,
      });

      marker.bindPopup(buildPhotoPopupNode(photo), {
        maxWidth: 260,
        closeButton: true,
        autoPanPadding: [24, 24],
      });

      marker.on('click', () => {
        onSelectEntry(null);
        onSelectPhoto(photo.id);
      });

      photoGroup.addLayer(marker);
      nextById[photo.id] = marker;
    });

    photoMarkerByIdRef.current = nextById;
  }, [
    gpsPhotos,
    sectionColorLookup,
    selectedPhotoId,
    hoveredPhotoId,
    timelineOrderLookup,
    showSectionPaths,
    onHoverPhoto,
    onSelectEntry,
    onSelectPhoto,
  ]);

  // Render Work Entry Markers
  useEffect(() => {
    const entryGroup = entryLayerRef.current;
    if (!entryGroup) return;

    entryGroup.clearLayers();

    for (const entry of workEntries) {
      const color = entry.sectionId
        ? sectionColorLookup[entry.sectionId] || '#0F172A'
        : '#0F172A';
      const isSelected = selectedEntryId === entry.id;

      const marker = L.marker([entry.lat, entry.lng], {
        icon: buildWorkEntryMarkerIcon(entry, color, isSelected),
        zIndexOffset: isSelected ? 1020 : 850,
        title: entry.title,
      });

      marker.on('click', () => {
        onSelectPhoto(null);
        onSelectEntry(entry.id);
      });

      entryGroup.addLayer(marker);
    }
  }, [
    workEntries,
    sectionColorLookup,
    selectedEntryId,
    onSelectPhoto,
    onSelectEntry,
  ]);

  // Fit all points when fitTrigger changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (fitTrigger === prevFitTriggerRef.current) return;
    prevFitTriggerRef.current = fitTrigger;

    if (allPoints.length === 0) return;
    if (allPoints.length === 1) {
      map.setView([allPoints[0].lat, allPoints[0].lng], 15);
      return;
    }

    const bounds = L.latLngBounds(allPoints.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, {padding: [72, 72], maxZoom: 16});
  }, [fitTrigger, allPoints]);

  // Focus selected target when focusTrigger changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedTarget) return;
    if (focusTrigger === prevFocusTriggerRef.current) return;
    prevFocusTriggerRef.current = focusTrigger;

    const targetZoom = Math.max(map.getZoom(), 15);
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    if (reducedMotion) {
      map.setView([selectedTarget.lat, selectedTarget.lng], targetZoom);
    } else {
      map.flyTo([selectedTarget.lat, selectedTarget.lng], targetZoom, {
        duration: 0.45,
      });
    }
  }, [focusTrigger, selectedTarget]);

  // Register high-DPI map canvas capture for PDF report export
  useEffect(() => {
    if (!mapCaptureRef) return;

    const loadCorsImg = (src: string, timeoutMs = 4000) =>
      new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timer = window.setTimeout(() => resolve(null), timeoutMs);
        img.onload = () => {
          window.clearTimeout(timer);
          resolve(img);
        };
        img.onerror = () => {
          window.clearTimeout(timer);
          resolve(null);
        };
        img.src = src;
      });

    const getTileUrls = (
      layer: MapLayerType,
      z: number,
      tx: number,
      ty: number
    ): string[] => {
      const osmSub = ['a', 'b', 'c'][Math.abs(tx + ty) % 3];
      const cartoSub = ['a', 'b', 'c', 'd'][Math.abs(tx + ty) % 4];
      switch (layer) {
        case 'satellite':
          return [
            `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`,
          ];
        case 'hybrid':
          return [
            `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`,
            `https://${cartoSub}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/${z}/${tx}/${ty}.png`,
          ];
        case 'terrain':
          return [`https://${osmSub}.tile.opentopomap.org/${z}/${tx}/${ty}.png`];
        case 'roadmap':
        default:
          return [`https://${osmSub}.tile.openstreetmap.org/${z}/${tx}/${ty}.png`];
      }
    };

    const drawRoundRect = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
      r: number
    ) => {
      const rad = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.lineTo(x + w - rad, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
      ctx.lineTo(x + w, y + h - rad);
      ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
      ctx.lineTo(x + rad, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
      ctx.lineTo(x, y + rad);
      ctx.quadraticCurveTo(x, y, x + rad, y);
      ctx.closePath();
    };

    mapCaptureRef.current = async () => {
      const map = mapRef.current;
      if (!map) return null;

      const size = map.getSize();
      if (size.x <= 0 || size.y <= 0) return null;

      const dpr = Math.min(2, Math.max(1.5, 1400 / size.x));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(size.x * dpr);
      canvas.height = Math.round(size.y * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(0, 0, size.x, size.y);

      const maxTileZoom = mapLayer === 'terrain' ? 17 : 19;
      const tileZoom = Math.min(Math.max(Math.round(map.getZoom()), 1), maxTileZoom);
      const nwLatLng = map.containerPointToLatLng([0, 0]);
      const seLatLng = map.containerPointToLatLng([size.x, size.y]);
      const nwWorld = map.project(nwLatLng, tileZoom);
      const seWorld = map.project(seLatLng, tileZoom);

      const worldSpanX = seWorld.x - nwWorld.x;
      const scale = worldSpanX > 0 ? size.x / worldSpanX : 1;

      const maxIndex = Math.pow(2, tileZoom);
      const minTx = Math.floor(nwWorld.x / 256);
      const maxTx = Math.floor(seWorld.x / 256);
      const minTy = Math.max(0, Math.floor(nwWorld.y / 256));
      const maxTy = Math.min(maxIndex - 1, Math.floor(seWorld.y / 256));

      const tileJobs: Array<{
        dx: number;
        dy: number;
        dw: number;
        dh: number;
        urls: string[];
      }> = [];

      for (let tx = minTx; tx <= maxTx; tx++) {
        const wrappedTx = ((tx % maxIndex) + maxIndex) % maxIndex;
        for (let ty = minTy; ty <= maxTy; ty++) {
          tileJobs.push({
            dx: (tx * 256 - nwWorld.x) * scale,
            dy: (ty * 256 - nwWorld.y) * scale,
            dw: 256 * scale,
            dh: 256 * scale,
            urls: getTileUrls(mapLayer, tileZoom, wrappedTx, ty),
          });
        }
      }

      const loadedTiles = await Promise.all(
        tileJobs.map(async (job) => {
          const imgs = await Promise.all(job.urls.map((u) => loadCorsImg(u)));
          return {job, imgs};
        })
      );

      for (const {job, imgs} of loadedTiles) {
        for (const img of imgs) {
          if (img) {
            ctx.drawImage(img, job.dx, job.dy, job.dw + 0.6, job.dh + 0.6);
          }
        }
      }

      // Draw Section Routes
      if (showSectionPaths) {
        for (const group of routeGroups) {
          if (group.points.length < 2) continue;
          const sig = `${group.sectionId}:${group.points
            .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
            .join('|')}`;
          const cached = routeCacheRef.current[sig];
          const path = cached?.path?.length ? cached.path : group.points;
          const pts = path.map((p) => map.latLngToContainerPoint([p.lat, p.lng]));

          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          if (!cached) {
            ctx.setLineDash([6, 6]);
          }

          // White halo
          ctx.beginPath();
          pts.forEach((pt, idx) => {
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.strokeStyle = 'rgba(255,255,255,0.88)';
          ctx.lineWidth = (group.isActive ? 6 : 4.5) + 3;
          ctx.stroke();

          // Colored route
          ctx.strokeStyle = group.color;
          ctx.lineWidth = group.isActive ? 6 : 4.5;
          ctx.stroke();
          ctx.restore();

          // Directional arrows
          const step = Math.max(1, Math.floor(path.length / 4));
          for (let i = 0; i < path.length - 1; i += step) {
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const mx = (p1.x + p2.x) / 2;
            const my = (p1.y + p2.y) / 2;
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) + Math.PI / 2;
            ctx.save();
            ctx.translate(mx, my);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(0, -6);
            ctx.lineTo(5, 5);
            ctx.lineTo(0, 2);
            ctx.lineTo(-5, 5);
            ctx.closePath();
            ctx.fillStyle = group.color;
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.3;
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // Draw Photo Pins
      const photoEntries = await Promise.all(
        gpsPhotos.map(async (photo) => {
          const pt = map.latLngToContainerPoint([photo.lat, photo.lng]);
          if (
            pt.x < -40 ||
            pt.x > size.x + 40 ||
            pt.y < -40 ||
            pt.y > size.y + 40
          ) {
            return null;
          }
          const img =
            (await loadCorsImg(photo.previewUrl, 1500)) ||
            (photo.fallbackPreviewUrl
              ? await loadCorsImg(photo.fallbackPreviewUrl, 1500)
              : null);
          return {photo, pt, img};
        })
      );

      for (const item of photoEntries) {
        if (!item) continue;
        const {photo, pt, img} = item;
        const color = photo.sectionId
          ? sectionColorLookup[photo.sectionId] || '#2563EB'
          : '#2563EB';
        const pinSize = 42;
        const left = pt.x - pinSize / 2;
        const top = pt.y - pinSize - 6;

        // Pointer triangle
        ctx.beginPath();
        ctx.moveTo(pt.x - 5, top + pinSize - 1);
        ctx.lineTo(pt.x + 5, top + pinSize - 1);
        ctx.lineTo(pt.x, pt.y);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        // White frame
        drawRoundRect(ctx, left, top, pinSize, pinSize, 7);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Photo thumb crop
        if (img) {
          ctx.save();
          drawRoundRect(ctx, left + 2.5, top + 2.5, pinSize - 5, pinSize - 5, 5);
          ctx.clip();
          const iw = img.naturalWidth || img.width;
          const ih = img.naturalHeight || img.height;
          const s = Math.max((pinSize - 5) / iw, (pinSize - 5) / ih);
          const sw = (pinSize - 5) / s;
          const sh = (pinSize - 5) / s;
          ctx.drawImage(
            img,
            (iw - sw) / 2,
            (ih - sh) / 2,
            sw,
            sh,
            left + 2.5,
            top + 2.5,
            pinSize - 5,
            pinSize - 5
          );
          ctx.restore();
        }

        // Order badge
        const orderIdx = timelineOrderLookup[photo.id];
        if (showSectionPaths && orderIdx !== undefined) {
          drawRoundRect(ctx, left + 3, top + 3, 15, 14, 3);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.font = 'bold 9px monospace';
          ctx.fillStyle = '#FFFFFF';
          ctx.textAlign = 'center';
          ctx.fillText(String(orderIdx + 1), left + 10.5, top + 13);
          ctx.textAlign = 'left';
        }

        // Checked badge
        if (photo.isChecked) {
          ctx.beginPath();
          ctx.arc(left + pinSize - 7, top + pinSize - 7, 6.5, 0, Math.PI * 2);
          ctx.fillStyle = '#059669';
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }

      // Draw Work Entry Pins
      ctx.font = '600 11px sans-serif';
      for (const entry of workEntries) {
        const pt = map.latLngToContainerPoint([entry.lat, entry.lng]);
        if (
          pt.x < -80 ||
          pt.x > size.x + 80 ||
          pt.y < -40 ||
          pt.y > size.y + 40
        ) {
          continue;
        }
        const color = entry.sectionId
          ? sectionColorLookup[entry.sectionId] || '#0F172A'
          : '#0F172A';
        const label =
          entry.title.length > 14 ? `${entry.title.slice(0, 14)}...` : entry.title;
        const textW = ctx.measureText(label).width;
        const pillW = Math.max(70, textW + 30);
        const pillH = 26;
        const left = pt.x - pillW / 2;
        const top = pt.y - pillH - 6;

        ctx.beginPath();
        ctx.moveTo(pt.x - 5, top + pillH - 1);
        ctx.lineTo(pt.x + 5, top + pillH - 1);
        ctx.lineTo(pt.x, pt.y);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        drawRoundRect(ctx, left, top, pillW, pillH, 6);
        ctx.fillStyle = '#0F172A';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(left + 12, top + pillH / 2, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = entry.status === 'completed' ? '#34D399' : '#FBBF24';
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(label, left + 20, top + 17);
      }

      // Attribution tag
      const attrText =
        mapLayer === 'satellite' || mapLayer === 'hybrid'
          ? '© Esri · PhotoAtlas'
          : mapLayer === 'terrain'
            ? '© OpenTopoMap · PhotoAtlas'
            : '© OpenStreetMap · PhotoAtlas';
      ctx.font = '500 10px sans-serif';
      const attrW = ctx.measureText(attrText).width + 14;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(size.x - attrW - 6, size.y - 22, attrW, 16);
      ctx.fillStyle = '#334155';
      ctx.fillText(attrText, size.x - attrW + 1, size.y - 10);

      try {
        return canvas.toDataURL('image/jpeg', 0.92);
      } catch {
        return null;
      }
    };

    return () => {
      mapCaptureRef.current = null;
    };
  }, [
    mapCaptureRef,
    mapLayer,
    showSectionPaths,
    routeGroups,
    gpsPhotos,
    workEntries,
    sectionColorLookup,
    timelineOrderLookup,
  ]);

  const isPickingMode = Boolean(manualPinPhoto) || isPickingWorkLocation;

  return (
    <div
      className={`relative w-full h-full bg-slate-100 ${
        isPickingMode ? 'cursor-crosshair' : ''
      }`}
    >
      {/* Isolated stacking context keeps Leaflet's internal z-400..1000 panes below React overlays */}
      <div className="w-full h-full isolate z-0">
        <div ref={mapContainerRef} className="w-full h-full" />
      </div>

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
              OpenStreetMap 기반 무료 지도 · JPG · HEIC · PNG · WebP 지원
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
