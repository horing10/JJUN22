import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import {fileURLToPath} from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

interface NormalizedLocation {
  formattedAddress: string;
  shortAddress: string;
  roadAddress?: string;
  granularity?: string;
  country?: string;
  locality?: string;
  neighborhood?: string;
  placeId?: string;
  plusCode?: string;
}

const geocodeCache: Record<string, NormalizedLocation> = {};
const routeCache: Record<
  string,
  {path: Array<{lat: number; lng: number}>; distanceMeters: number}
> = {};

// Polite sequential rate gate for OpenStreetMap Nominatim (max ~1 req/sec)
let lastNominatimCallMs = 0;
let nominatimQueue: Promise<void> = Promise.resolve();

function scheduleNominatim<T>(fn: () => Promise<T>): Promise<T> {
  const next = nominatimQueue.then(async () => {
    const elapsed = Date.now() - lastNominatimCallMs;
    if (elapsed < 1050) {
      await new Promise((r) => setTimeout(r, 1050 - elapsed));
    }
    lastNominatimCallMs = Date.now();
    return fn();
  });
  nominatimQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

interface NominatimAddress {
  country?: string;
  province?: string;
  state?: string;
  city?: string;
  town?: string;
  village?: string;
  borough?: string;
  county?: string;
  city_district?: string;
  district?: string;
  suburb?: string;
  quarter?: string;
  neighbourhood?: string;
  road?: string;
  pedestrian?: string;
  footway?: string;
  house_number?: string;
  building?: string;
  amenity?: string;
}

function formatNominatimResult(data: {
  place_id?: number;
  display_name?: string;
  type?: string;
  address?: NominatimAddress;
}): NormalizedLocation {
  const addr = data.address || {};
  const region = addr.city || addr.province || addr.state;
  const district =
    addr.borough || addr.city_district || addr.county || addr.district;
  const town =
    addr.town ||
    addr.village ||
    addr.suburb ||
    addr.quarter ||
    addr.neighbourhood;
  const roadName = addr.road || addr.pedestrian || addr.footway;
  const roadAddress = [roadName, addr.house_number].filter(Boolean).join(' ');

  // Deduplicate adjacent Korean hierarchy tokens
  const fullParts: string[] = [];
  for (const part of [region, district, town, roadAddress, addr.building]) {
    if (part && !fullParts.includes(part)) {
      fullParts.push(part);
    }
  }

  const formattedAddress =
    fullParts.length > 0
      ? fullParts.join(' ')
      : data.display_name || '위치 확인됨';

  const shortParts: string[] = [];
  for (const part of [district || region, roadAddress || town || addr.amenity]) {
    if (part && !shortParts.includes(part)) {
      shortParts.push(part);
    }
  }

  const shortAddress =
    shortParts.length > 0 ? shortParts.join(' ') : formattedAddress;

  return {
    formattedAddress,
    shortAddress,
    roadAddress: roadAddress || undefined,
    granularity: data.type,
    country: addr.country,
    locality: district || region,
    neighborhood: town,
    placeId: data.place_id ? String(data.place_id) : undefined,
  };
}

async function createServer() {
  const app = express();
  app.use(express.json());

  // Free Reverse Geocoding via OpenStreetMap Nominatim (no API key required)
  app.get('/api/reverse-geocode', async (req, res) => {
    const latRaw = Number(req.query.lat);
    const lngRaw = Number(req.query.lng);
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'ko';

    if (
      !Number.isFinite(latRaw) ||
      !Number.isFinite(lngRaw) ||
      latRaw < -90 ||
      latRaw > 90 ||
      lngRaw < -180 ||
      lngRaw > 180
    ) {
      res.status(400).json({error: 'Invalid coordinates'});
      return;
    }

    const cacheKey = `${latRaw.toFixed(5)},${lngRaw.toFixed(5)},${lang}`;
    if (geocodeCache[cacheKey]) {
      res.json(geocodeCache[cacheKey]);
      return;
    }

    try {
      const result = await scheduleNominatim(async () => {
        const url = new URL('https://nominatim.openstreetmap.org/reverse');
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('lat', String(latRaw));
        url.searchParams.set('lon', String(lngRaw));
        url.searchParams.set('zoom', '18');
        url.searchParams.set('addressdetails', '1');
        url.searchParams.set('accept-language', lang);

        const response = await fetch(url.toString(), {
          headers: {
            'User-Agent': 'PhotoAtlas-FieldMapper/1.0',
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Nominatim status ${response.status}`);
        }

        const data = (await response.json()) as {
          place_id?: number;
          display_name?: string;
          type?: string;
          address?: NominatimAddress;
          error?: string;
        };

        if (data.error) {
          return {
            formattedAddress: '',
            shortAddress: '',
          };
        }

        return formatNominatimResult(data);
      });

      if (result.formattedAddress) {
        geocodeCache[cacheKey] = result;
      }
      res.json(result);
    } catch (error) {
      console.warn('Nominatim reverse geocode warning:', error);
      res.json({
        formattedAddress: '',
        shortAddress: '',
      });
    }
  });

  // Free Road Routing via Open Source Routing Machine (OSRM, no API key required)
  app.post('/api/route', async (req, res) => {
    const body = req.body as {
      points?: Array<{lat: number; lng: number}>;
    };
    const points = Array.isArray(body?.points) ? body.points : [];

    const validPoints = points.filter(
      (p) =>
        p &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        p.lat >= -90 &&
        p.lat <= 90 &&
        p.lng >= -180 &&
        p.lng <= 180
    );

    if (validPoints.length < 2) {
      res.json({path: validPoints, distanceMeters: 0, fallback: true});
      return;
    }

    const trimmed = validPoints.slice(0, 50);
    const sig = trimmed
      .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
      .join('|');

    if (routeCache[sig]) {
      res.json(routeCache[sig]);
      return;
    }

    try {
      const coordsParam = trimmed.map((p) => `${p.lng},${p.lat}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/driving/${coordsParam}?overview=full&geometries=geojson&steps=false`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'PhotoAtlas-FieldMapper/1.0',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        res.json({path: trimmed, distanceMeters: 0, fallback: true});
        return;
      }

      const data = (await response.json()) as {
        code?: string;
        routes?: Array<{
          distance?: number;
          geometry?: {
            coordinates?: Array<[number, number]>;
          };
        }>;
      };

      const route = data.routes?.[0];
      const coords = route?.geometry?.coordinates;
      if (data.code === 'Ok' && Array.isArray(coords) && coords.length >= 2) {
        const path = coords.map(([lng, lat]) => ({lat, lng}));
        const distanceMeters = Math.round(route?.distance || 0);
        const result = {path, distanceMeters};
        routeCache[sig] = result;
        res.json(result);
        return;
      }

      res.json({path: trimmed, distanceMeters: 0, fallback: true});
    } catch {
      res.json({path: trimmed, distanceMeters: 0, fallback: true});
    }
  });

  if (!IS_PRODUCTION) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
