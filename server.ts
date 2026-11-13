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
  app.set('trust proxy', true);
  app.use(express.json());

  const getKakaoJsKey = () =>
    process.env.KAKAO_MAP_JS_KEY ||
    process.env.VITE_KAKAO_MAP_JS_KEY ||
    process.env.KAKAO_JAVASCRIPT_KEY ||
    '';

  const getKakaoRestKey = () => process.env.KAKAO_REST_API_KEY || '';

  app.get('/api/kakao-config', (_req, res) => {
    res.json({
      jsKey: getKakaoJsKey(),
      hasRestKey: Boolean(getKakaoRestKey()),
    });
  });

  // Safe same-origin tile proxy strictly allowlisting Kakao Map CDN tiles for PDF capture
  app.get('/api/tile-proxy', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    if (!rawUrl) {
      res.status(400).end();
      return;
    }

    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      const allowedHost =
        host.endsWith('.daumcdn.net') ||
        host.endsWith('.kakaocdn.net') ||
        host === 'daumcdn.net' ||
        host === 'kakaocdn.net';

      if (
        !allowedHost ||
        (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      ) {
        res.status(403).end();
        return;
      }

      const upstream = await fetch(parsed.toString(), {
        headers: {
          'User-Agent': 'PhotoAtlas-FieldMapper/1.0',
        },
      });
      if (!upstream.ok) {
        res.status(upstream.status).end();
        return;
      }

      const contentType = upstream.headers.get('content-type') || 'image/png';
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buf);
    } catch {
      res.status(502).end();
    }
  });

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

    // 1. Try Kakao Local REST API first when KAKAO_REST_API_KEY is configured
    const kakaoRestKey = getKakaoRestKey();
    if (kakaoRestKey) {
      try {
        const kakaoUrl = `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${encodeURIComponent(
          String(lngRaw)
        )}&y=${encodeURIComponent(String(latRaw))}&input_coord=WGS84`;

        const kRes = await fetch(kakaoUrl, {
          headers: {
            Authorization: `KakaoAK ${kakaoRestKey}`,
          },
        });

        if (kRes.ok) {
          const kData = (await kRes.json()) as {
            documents?: Array<{
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
              } | null;
            }>;
          };

          const doc = kData.documents?.[0];
          const road = doc?.road_address;
          const lot = doc?.address;
          if (road?.address_name || lot?.address_name) {
            const formattedAddress =
              road?.address_name || lot?.address_name || '';
            const buildingSuffix = road?.building_name
              ? ` (${road.building_name})`
              : '';
            const district =
              road?.region_2depth_name ||
              lot?.region_2depth_name ||
              road?.region_1depth_name ||
              lot?.region_1depth_name;
            const town =
              road?.region_3depth_name || lot?.region_3depth_name;
            const roadShort = road?.road_name
              ? [
                  road.road_name,
                  [road.main_building_no, road.sub_building_no]
                    .filter(Boolean)
                    .join('-'),
                ]
                  .filter(Boolean)
                  .join(' ')
              : undefined;
            const shortAddress =
              [district, roadShort || town].filter(Boolean).join(' ') ||
              formattedAddress;

            const normalized: NormalizedLocation = {
              formattedAddress: `${formattedAddress}${buildingSuffix}`,
              shortAddress,
              roadAddress: road?.address_name || undefined,
              country: '대한민국',
              locality: district,
              neighborhood: town,
            };
            geocodeCache[cacheKey] = normalized;
            res.json(normalized);
            return;
          }
        }
      } catch (err) {
        console.warn('Kakao Local reverse geocode warning:', err);
      }
    }

    // 2. Fallback to Nominatim when outside Korea or KAKAO_REST_API_KEY is unset
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

    const trimmed = validPoints.slice(0, 180);
    const sig = trimmed
      .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
      .join('|');

    if (routeCache[sig]) {
      res.json(routeCache[sig]);
      return;
    }

    // Try Kakao Mobility Directions API when KAKAO_REST_API_KEY is configured
    const kakaoRestKey = getKakaoRestKey();
    if (kakaoRestKey && trimmed.length >= 2 && trimmed.length <= 32) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        try {
          let kResp: Response;
          if (trimmed.length === 2) {
            const origin = `${trimmed[0].lng},${trimmed[0].lat}`;
            const destination = `${trimmed[1].lng},${trimmed[1].lat}`;
            kResp = await fetch(
              `https://apis-navi.kakaomobility.com/v1/directions?origin=${encodeURIComponent(
                origin
              )}&destination=${encodeURIComponent(destination)}`,
              {
                headers: {
                  Authorization: `KakaoAK ${kakaoRestKey}`,
                },
                signal: controller.signal,
              }
            );
          } else {
            const origin = {x: trimmed[0].lng, y: trimmed[0].lat};
            const destination = {
              x: trimmed[trimmed.length - 1].lng,
              y: trimmed[trimmed.length - 1].lat,
            };
            const waypoints = trimmed
              .slice(1, -1)
              .map((p) => ({x: p.lng, y: p.lat}));
            kResp = await fetch(
              'https://apis-navi.kakaomobility.com/v1/waypoints/directions',
              {
                method: 'POST',
                headers: {
                  Authorization: `KakaoAK ${kakaoRestKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({origin, destination, waypoints}),
                signal: controller.signal,
              }
            );
          }

          if (kResp.ok) {
            const kData = (await kResp.json()) as {
              routes?: Array<{
                result_code?: number;
                summary?: {distance?: number};
                sections?: Array<{
                  roads?: Array<{vertexes?: number[]}>;
                }>;
              }>;
            };
            const route = kData.routes?.[0];
            if (route && route.result_code === 0 && route.sections) {
              const path: Array<{lat: number; lng: number}> = [];
              for (const sec of route.sections) {
                for (const road of sec.roads || []) {
                  const v = road.vertexes || [];
                  for (let i = 0; i + 1 < v.length; i += 2) {
                    path.push({lat: v[i + 1], lng: v[i]});
                  }
                }
              }
              if (path.length >= 2) {
                const result = {
                  path,
                  distanceMeters: Math.round(route.summary?.distance || 0),
                };
                routeCache[sig] = result;
                res.json(result);
                return;
              }
            }
          }
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        console.warn('Kakao Mobility directions fallback:', err);
      }
    }

    const fetchOsrmChunk = async (
      chunk: Array<{lat: number; lng: number}>
    ): Promise<{path: Array<{lat: number; lng: number}>; distanceMeters: number} | null> => {
      const coordsParam = chunk.map((p) => `${p.lng},${p.lat}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/driving/${coordsParam}?overview=full&geometries=geojson&steps=false`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'PhotoAtlas-FieldMapper/1.0',
          },
          signal: controller.signal,
        });
        if (!response.ok) return null;

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
          return {
            path: coords.map(([lng, lat]) => ({lat, lng})),
            distanceMeters: Math.round(route?.distance || 0),
          };
        }
        return null;
      } finally {
        clearTimeout(timeout);
      }
    };

    try {
      const CHUNK_SIZE = 40;
      if (trimmed.length <= CHUNK_SIZE) {
        const single = await fetchOsrmChunk(trimmed);
        if (single) {
          routeCache[sig] = single;
          res.json(single);
          return;
        }
        res.json({path: trimmed, distanceMeters: 0, fallback: true});
        return;
      }

      const combinedPath: Array<{lat: number; lng: number}> = [];
      let totalDistance = 0;

      for (let i = 0; i < trimmed.length - 1; i += CHUNK_SIZE - 1) {
        const slice = trimmed.slice(i, i + CHUNK_SIZE);
        if (slice.length < 2) break;
        const seg = await fetchOsrmChunk(slice);
        const segPoints = seg ? seg.path : slice;
        if (combinedPath.length === 0) {
          combinedPath.push(...segPoints);
        } else {
          combinedPath.push(...segPoints.slice(1));
        }
        if (seg) {
          totalDistance += seg.distanceMeters;
        }
      }

      if (combinedPath.length >= 2) {
        const result = {path: combinedPath, distanceMeters: totalDistance};
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
    app.use(
      express.static(distPath, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('manifest.json')) {
            res.setHeader(
              'Content-Type',
              'application/manifest+json; charset=utf-8'
            );
            res.setHeader('Cache-Control', 'no-cache');
          } else if (
            filePath.endsWith('sw.js') ||
            filePath.endsWith('registerSW.js')
          ) {
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Service-Worker-Allowed', '/');
          }
        },
      })
    );
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
