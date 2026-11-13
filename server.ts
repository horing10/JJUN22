import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import {fileURLToPath} from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function getMapsApiKey(): string {
  return (
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    ''
  );
}

interface AddressComponentV4 {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface AddressComponentLegacy {
  long_name?: string;
  short_name?: string;
  types?: string[];
}

function extractComponent(
  components: Array<AddressComponentV4 | AddressComponentLegacy> | undefined,
  targetTypes: string[]
): string | undefined {
  if (!components) return undefined;
  for (const target of targetTypes) {
    const match = components.find((c) => c.types?.includes(target));
    if (match) {
      if ('longText' in match) {
        return match.longText;
      }
      return (match as AddressComponentLegacy).long_name;
    }
  }
  return undefined;
}

function pickBestResult<T extends {types?: string[]; granularity?: string}>(
  results: T[]
): T | undefined {
  if (!results.length) return undefined;
  const preferredTypes = [
    'street_address',
    'premise',
    'subpremise',
    'establishment',
    'point_of_interest',
    'route',
    'intersection',
  ];
  for (const t of preferredTypes) {
    const found = results.find((r) => r.types?.includes(t));
    if (found) return found;
  }
  const rooftop = results.find((r) => r.granularity === 'ROOFTOP');
  return rooftop || results[0];
}

async function createServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/maps-config', (_req, res) => {
    const apiKey = getMapsApiKey();
    res.json({apiKey});
  });

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

    const apiKey = getMapsApiKey();
    if (!apiKey) {
      res.status(503).json({error: 'Google Maps API key not configured'});
      return;
    }

    try {
      // Primary: Geocoding API v4
      const v4Url = new URL(
        'https://geocode.googleapis.com/v4/geocode/location'
      );
      v4Url.searchParams.set('location.latitude', String(latRaw));
      v4Url.searchParams.set('location.longitude', String(lngRaw));
      v4Url.searchParams.set('languageCode', lang);

      const v4Response = await fetch(v4Url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'results.placeId,results.formattedAddress,results.addressComponents,results.types,results.granularity,plusCode',
          'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
        },
      });

      if (v4Response.status === 429) {
        res.status(429).json({
          error: 'Google Maps quota exceeded',
          quotaExceeded: true,
        });
        return;
      }

      if (v4Response.ok) {
        const data = (await v4Response.json()) as {
          error?: {status?: string};
          results?: Array<{
            placeId?: string;
            formattedAddress?: string;
            addressComponents?: AddressComponentV4[];
            types?: string[];
            granularity?: string;
          }>;
          plusCode?: {compoundCode?: string; globalCode?: string};
        };

        if (data.error?.status === 'RESOURCE_EXHAUSTED') {
          res.status(429).json({
            error: 'Google Maps quota exceeded',
            quotaExceeded: true,
          });
          return;
        }

        const primary = pickBestResult(data.results || []);
        if (primary) {
          const components = primary.addressComponents;
          const country = extractComponent(components, ['country']);
          const locality = extractComponent(components, [
            'locality',
            'administrative_area_level_1',
            'administrative_area_level_2',
          ]);
          const neighborhood = extractComponent(components, [
            'sublocality_level_2',
            'sublocality_level_1',
            'sublocality',
            'neighborhood',
            'administrative_area_level_3',
          ]);
          const route = extractComponent(components, ['route']);
          const streetNumber = extractComponent(components, ['street_number']);
          const roadAddress = [route, streetNumber].filter(Boolean).join(' ');
          const shortAddress =
            [locality, roadAddress || neighborhood].filter(Boolean).join(' ') ||
            primary.formattedAddress ||
            '위치 확인됨';

          res.json({
            formattedAddress: primary.formattedAddress || '',
            shortAddress,
            roadAddress: roadAddress || undefined,
            granularity: primary.granularity,
            country,
            locality,
            neighborhood,
            placeId: primary.placeId,
            plusCode:
              data.plusCode?.compoundCode || data.plusCode?.globalCode,
          });
          return;
        }
      }

      // Fallback: Standard Geocoding REST API (still server-side to prevent CORS)
      const legacyUrl = new URL(
        'https://maps.googleapis.com/maps/api/geocode/json'
      );
      legacyUrl.searchParams.set('latlng', `${latRaw},${lngRaw}`);
      legacyUrl.searchParams.set('language', lang);
      legacyUrl.searchParams.set('key', apiKey);

      const legacyResponse = await fetch(legacyUrl.toString());
      if (legacyResponse.status === 429) {
        res.status(429).json({
          error: 'Google Maps quota exceeded',
          quotaExceeded: true,
        });
        return;
      }

      const legacyData = (await legacyResponse.json()) as {
        status?: string;
        results?: Array<{
          place_id?: string;
          formatted_address?: string;
          types?: string[];
          geometry?: {location_type?: string};
          address_components?: AddressComponentLegacy[];
        }>;
        plus_code?: {compound_code?: string; global_code?: string};
      };

      if (legacyData.status === 'OVER_QUERY_LIMIT') {
        res.status(429).json({
          error: 'Google Maps quota exceeded',
          quotaExceeded: true,
        });
        return;
      }

      const first = pickBestResult(legacyData.results || []);
      if (first) {
        const components = first.address_components;
        const country = extractComponent(components, ['country']);
        const locality = extractComponent(components, [
          'locality',
          'administrative_area_level_1',
          'administrative_area_level_2',
        ]);
        const neighborhood = extractComponent(components, [
          'sublocality_level_2',
          'sublocality_level_1',
          'sublocality',
          'neighborhood',
          'administrative_area_level_3',
        ]);
        const route = extractComponent(components, ['route']);
        const streetNumber = extractComponent(components, ['street_number']);
        const roadAddress = [route, streetNumber].filter(Boolean).join(' ');
        const shortAddress =
          [locality, roadAddress || neighborhood].filter(Boolean).join(' ') ||
          first.formatted_address ||
          '위치 확인됨';

        res.json({
          formattedAddress: first.formatted_address || '',
          shortAddress,
          roadAddress: roadAddress || undefined,
          granularity: first.geometry?.location_type,
          country,
          locality,
          neighborhood,
          placeId: first.place_id,
          plusCode:
            legacyData.plus_code?.compound_code ||
            legacyData.plus_code?.global_code,
        });
        return;
      }

      res.json({
        formattedAddress: '',
        shortAddress: '',
      });
    } catch (error) {
      console.error('Reverse geocode proxy error:', error);
      res.status(502).json({error: 'Reverse geocoding failed'});
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
