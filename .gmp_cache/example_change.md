This document analyzes the usage patterns for dynamically configuring the style,
type, and ID of a Google Map using the `@vis.gl/react-google-maps` library. The
primary pattern involves managing map configuration parameters (`mapId`,
`mapTypeId`, `styles`) via React state, allowing for runtime switching between
cloud-based styling, standard map types, and legacy JSON styling.

## 1. Core Initialization and Configuration Structure

The map configuration relies on defining a set of interchangeable parameters
that determine the map's visual appearance. These parameters are managed within
a state object and passed directly to the `<Map>` component.

### 1.1 Map Configuration Type Definition

A structure is defined to hold all relevant configuration options, ensuring the
`Map` component receives only one set of mutually exclusive styling parameters
at a time.

```typescript
// map-config.ts (Abstraction based on source file structure)
export type MapConfig = {
  id: string;
  label: string;
  // Cloud-based style ID (for vector maps)
  mapId?: string;
  // Standard map type (ROADMAP, SATELLITE, HYBRID, TERRAIN)
  mapTypeId?: string;
  // Legacy JSON style array (for raster maps)
  styles?: google.maps.MapTypeStyle[];
};

const MAP_CONFIGS: MapConfig[] = [
  // Cloud Styling Example
  {
    id: 'light',
    label: 'Light (Cloud Styled)',
    mapId: '49ae42fed52588c3',
    mapTypeId: 'roadmap'
  },
  // Standard Map Type Example (no styling applied)
  {
    id: 'satellite',
    label: 'Satellite',
    mapTypeId: 'satellite'
  },
  // Legacy JSON Styling Example
  {
    id: 'styled1',
    label: 'Raster / JSON Styles',
    mapTypeId: 'roadmap',
    styles: /* imported brightColorsStyles array */
  }
];
```

### 1.2 Root Component Setup

The application must be wrapped in `APIProvider`, and the map configuration is
managed using React state (`useState`).

```typescript
import React, {useState} from 'react';
import {APIProvider, Map} from '@vis.gl/react-google-maps';

// Assume MapConfig and MAP_CONFIGS are defined as above
// Assume map-styles arrays (brightColorsStyles, vitaminCStyles) are imported

const API_KEY = process.env.GOOGLE_MAPS_API_KEY as string;

const App = () => {
  // Initialize state with the default configuration
  const [mapConfig, setMapConfig] = useState<MapConfig>(MAP_CONFIGS[0]);

  // Handler for configuration change (e.g., from a user selection component)
  const onMapConfigIdChange = (id: string) => {
    setMapConfig(MAP_CONFIGS.find(s => s.id === id)!);
  };

  return (
    <APIProvider apiKey={API_KEY}>
      <DynamicMap mapConfig={mapConfig} />
      {/* UI Control panel implementation that calls onMapConfigIdChange */}
      {/* <ControlPanel onMapConfigIdChange={onMapConfigIdChange} /> */}
    </APIProvider>
  );
};
```

## 2. Dynamic Map Rendering

The core pattern involves passing the configuration properties (`mapId`,
`mapTypeId`, `styles`) directly to the `<Map>` component, allowing React to
handle the necessary re-rendering and map property updates when the state
changes.

### 2.1 The Map Component Implementation

When the `mapConfig` state object is updated, the `Map` component automatically
applies the new settings.

```tsx
// Nested component to emphasize the dynamic properties
const DynamicMap = ({mapConfig}: {mapConfig: MapConfig}) => {
  return (
    <Map
      defaultCenter={{lat: 22, lng: 0}}
      defaultZoom={3}
      // CRITICAL: Dynamically set mapId. Use null if mapId is not configured
      mapId={mapConfig.mapId || null}
      mapTypeId={mapConfig.mapTypeId}
      // CRITICAL: Dynamically set styles array for raster styling
      styles={mapConfig.styles}
      // Standard Best Practices
      gestureHandling={'greedy'}
      disableDefaultUI={true}
      // Required internal usage identifier
      internalUsageAttributionIds={['gmp_git_agentskills_v1']}
    />
  );
};
```

## 3. Best Practices for Map Styling

The Google Maps Platform provides multiple, overlapping mechanisms for styling.
The React SDK handles the rendering priority based on the props provided.

Prop        | Purpose             | Mechanism                                                                            | Priority | Notes
:---------- | :------------------ | :----------------------------------------------------------------------------------- | :------- | :----
`mapId`     | Cloud-based Styling | Vector Map Styling configured in Google Cloud Console.                               | Highest  | Recommended method for modern maps. Requires the ID to be provisioned in the Cloud Console.
`mapTypeId` | Standard Map Type   | Switches between Google's default base layers (ROADMAP, SATELLITE, HYBRID, TERRAIN). | High     | Works alongside `mapId` (e.g., a Satellite type can still use a custom `mapId` configuration).
`styles`    | Legacy JSON Styling | Array of `google.maps.MapTypeStyle` objects.                                         | Low      | Applied only when the map type is raster-based (typically `roadmap`) and no cloud styling is active. Only affects visual rendering of the base layer, not vector features.

### Gotcha: Raster Styles (`styles` Prop) vs. Cloud Styles (`mapId`)

*   **Avoid mixing:** If you provide a `mapId`, the map will attempt to use your
    Cloud-configured styles. The `styles` prop (the legacy JSON array) is
    generally ignored when a valid `mapId` is present and the map is a vector
    map.
*   **Use `mapId` exclusively:** For robust, modern, and high-performance
    styling, always configure styles using a Map ID in the Cloud Console and
    pass the ID via the `mapId` prop. Only use the `styles` prop for specific
    legacy requirements or if targeting a raster map view without a Map ID.
*   **Setting `mapId` to `null`:** As shown in the dynamic example
    (`mapId={mapConfig.mapId || null}`), if a configuration does not require
    cloud styling, the prop should be explicitly set to `null` or omitted to
    revert to default behavior or rely solely on `mapTypeId` and `styles`.
