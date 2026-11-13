declare namespace kakao.maps {
  class LatLng {
    constructor(lat: number, lng: number);
    getLat(): number;
    getLng(): number;
  }

  class Point {
    constructor(x: number, y: number);
    x: number;
    y: number;
  }

  class LatLngBounds {
    constructor(sw?: LatLng, ne?: LatLng);
    extend(latlng: LatLng): void;
  }

  enum MapTypeId {
    ROADMAP = 1,
    SKYVIEW = 2,
    HYBRID = 3,
    TERRAIN = 5,
  }

  enum ControlPosition {
    TOP = 0,
    TOPLEFT = 1,
    TOPRIGHT = 2,
    LEFT = 3,
    RIGHT = 4,
    BOTTOMLEFT = 5,
    BOTTOM = 6,
    BOTTOMRIGHT = 7,
  }

  class ZoomControl {}

  interface MapOptions {
    center: LatLng;
    level?: number;
    mapTypeId?: MapTypeId;
  }

  interface MapProjection {
    containerPointFromCoords(latlng: LatLng): Point;
    coordsFromContainerPoint(point: Point): LatLng;
  }

  class Map {
    constructor(container: HTMLElement, options: MapOptions);
    setCenter(latlng: LatLng): void;
    panTo(latlng: LatLng): void;
    getCenter(): LatLng;
    setLevel(level: number, options?: {animate?: boolean}): void;
    getLevel(): number;
    setMapTypeId(mapTypeId: MapTypeId): void;
    addOverlayMapTypeId(mapTypeId: MapTypeId): void;
    removeOverlayMapTypeId(mapTypeId: MapTypeId): void;
    addControl(control: unknown, position: ControlPosition): void;
    setBounds(
      bounds: LatLngBounds,
      paddingTop?: number,
      paddingRight?: number,
      paddingBottom?: number,
      paddingLeft?: number
    ): void;
    relayout(): void;
    getProjection(): MapProjection;
  }

  interface PolylineOptions {
    map?: Map | null;
    path: LatLng[];
    strokeWeight?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeStyle?: 'solid' | 'shortdash' | 'shortdot' | 'dash' | 'dot';
  }

  class Polyline {
    constructor(options: PolylineOptions);
    setMap(map: Map | null): void;
  }

  interface CustomOverlayOptions {
    map?: Map | null;
    position: LatLng;
    content: string | HTMLElement;
    xAnchor?: number;
    yAnchor?: number;
    zIndex?: number;
    clickable?: boolean;
  }

  class CustomOverlay {
    constructor(options: CustomOverlayOptions);
    setMap(map: Map | null): void;
    setZIndex(zIndex: number): void;
  }

  interface MouseEvent {
    latLng: LatLng;
  }

  namespace event {
    function addListener(
      target: unknown,
      type: string,
      handler: (event: MouseEvent) => void
    ): void;
    function removeListener(
      target: unknown,
      type: string,
      handler: (event: MouseEvent) => void
    ): void;
  }

  namespace services {
    enum Status {
      OK = 'OK',
      ZERO_RESULT = 'ZERO_RESULT',
      ERROR = 'ERROR',
    }

    interface Coord2AddressResult {
      road_address?: {
        address_name?: string;
        region_1depth_name?: string;
        region_2depth_name?: string;
        region_3depth_name?: string;
        road_name?: string;
        main_building_no?: string;
        sub_building_no?: string;
        building_name?: string;
      } | null;
      address?: {
        address_name?: string;
        region_1depth_name?: string;
        region_2depth_name?: string;
        region_3depth_name?: string;
        main_address_no?: string;
        sub_address_no?: string;
      } | null;
    }

    class Geocoder {
      coord2Address(
        lng: number,
        lat: number,
        callback: (result: Coord2AddressResult[], status: Status) => void
      ): void;
    }
  }

  function load(callback: () => void): void;
}

interface Window {
  kakao?: {
    maps?: typeof kakao.maps;
  };
}
