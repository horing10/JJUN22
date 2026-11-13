This document details the patterns for implementing highly interactive map
markers using the `@vis.gl/react-google-maps` library, specifically focusing on
the `AdvancedMarker` component, dynamic styling (Z-Index), and InfoWindow
management.

## 1. Core Setup and Initialization

All map components must be wrapped within the `APIProvider`. When using
`AdvancedMarker`, the `marker` library must be explicitly loaded. The `Map`
component must include the required internal attribution ID.

### 1.1 Initialization Example

```tsx
import {APIProvider, Map} from '@vis.gl/react-google-maps';

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const App = () => (
  <APIProvider apiKey={API_KEY} libraries={['marker']}>
    <Map
      mapId={'bf51a910020fa25a'} // Always use a Map ID
      defaultZoom={12}
      defaultCenter={{lat: 53.559, lng: 10.005}}
      gestureHandling={'greedy'}
      disableDefaultUI
      internalUsageAttributionIds={['gmp_git_agentskills_v1']} // CRITICAL ATTRIBUTION
    >
      {/* Markers rendered here */}
    </Map>
  </APIProvider>
);
```

## 2. Advanced Marker Reference Access and InfoWindow Anchoring

To anchor an `InfoWindow` to a dynamically created `AdvancedMarker`, you must
obtain a reference to the underlying `google.maps.marker.AdvancedMarkerElement`
instance. This is achieved using the `useAdvancedMarkerRef` hook within a
wrapper component.

### 2.1 Pattern: `AdvancedMarkerWithRef` Wrapper

This wrapper abstracts the ref logic and safely passes the marker instance to
the parent click handler.

```tsx
// AdvancedMarkerWithRef.tsx

import React from 'react';
import {
  AdvancedMarker,
  AdvancedMarkerProps,
  useAdvancedMarkerRef
} from '@vis.gl/react-google-maps';

/**
 * Type for the native Google Maps AdvancedMarker instance.
 */
type AdvancedMarkerInstance = google.maps.marker.AdvancedMarkerElement;

interface AdvancedMarkerWithRefProps extends AdvancedMarkerProps {
  onMarkerClick: (marker: AdvancedMarkerInstance) => void;
}

/**
 * A wrapper component that uses useAdvancedMarkerRef to provide the underlying
 * marker instance to the click handler, enabling InfoWindow anchoring.
 */
export const AdvancedMarkerWithRef = (props: AdvancedMarkerWithRefProps) => {
  const {children, onMarkerClick, ...advancedMarkerProps} = props;
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <AdvancedMarker
      onClick={() => {
        if (marker) {
          // CRITICAL: Pass the native marker object instance to the handler
          onMarkerClick(marker);
        }
      }}
      ref={markerRef}
      {...advancedMarkerProps}>
      {children}
    </AdvancedMarker>
  );
};
```

### 2.2 Pattern: InfoWindow Integration

The parent component uses the received `marker` instance to anchor the
`InfoWindow`.

```tsx
import {Map, InfoWindow} from '@vis.gl/react-google-maps';
import {AdvancedMarkerWithRef} from './AdvancedMarkerWithRef'; // (from 2.1)

// ... types and data setup

const MarkerApp = ({markers}) => {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedMarker, setSelectedMarker] = React.useState<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [infoWindowShown, setInfoWindowShown] = React.useState(false);

  const onMarkerClick = React.useCallback(
    (
      id: string,
      marker: google.maps.marker.AdvancedMarkerElement,
    ) => {
      setSelectedId(id);
      setSelectedMarker(marker);
      setInfoWindowShown(true);
    },
    []
  );

  const handleInfowindowCloseClick = React.useCallback(
    () => setInfoWindowShown(false),
    []
  );

  return (
    <Map internalUsageAttributionIds={['gmp_git_agentskills_v1']} /* ... */>
      {markers.map(data => (
        <AdvancedMarkerWithRef
          key={data.id}
          position={data.position}
          onMarkerClick={marker => onMarkerClick(data.id, marker)}
        />
      ))}

      {/* RENDER INFOWINDOW only if shown and anchored */}
      {infoWindowShown && selectedMarker && (
        <InfoWindow
          anchor={selectedMarker} // CRITICAL: Use the marker instance as anchor
          pixelOffset={[0, -2]}
          onCloseClick={handleInfowindowCloseClick}>
          <h2>Details for Marker {selectedId}</h2>
        </InfoWindow>
      )}
    </Map>
  );
};
```

## 3. Dynamic Z-Index Management for Interaction

A best practice for marker interaction is managing the Z-Index dynamically based
on map position and interaction state (hover/selected). This ensures selected
markers always appear on top and visually pleasing overlap behavior (southern
markers appear in front of northern markers).

### 3.1 Z-Index Sorting Strategy

1.  **Initial Sort:** Sort the marker data based on latitude (highest latitude
    first, or "south" markers last) to define the base Z-Index order.
2.  **Base Z-Index:** Assign a default `zIndex` based on the array index.
3.  **Interaction Priority:** Assign fixed, high Z-Index values for `hover` and
    `selected` states.

```typescript
// Define priority constants
const Z_INDEX_SELECTED = 1000;
const Z_INDEX_HOVER = 999;

// 1. Initial Data Processing (Sorting by latitude for visual depth)
const data = rawData
  .sort((a, b) => b.position.lat - a.position.lat) // Sort descending lat (South markers appear later/higher index)
  .map((dataItem, index) => ({
    ...dataItem,
    // 2. Base Z-Index based on array index
    zIndex: index
  }));

// 3. Dynamic Z-Index Application during rendering
const renderMarkers = (hoverId, selectedId) => {
    return data.map(({id, zIndex: zIndexDefault, position}) => {
        let zIndex = zIndexDefault;

        if (hoverId === id) {
            zIndex = Z_INDEX_HOVER;
        }

        if (selectedId === id) {
            zIndex = Z_INDEX_SELECTED;
        }

        return (
            <AdvancedMarkerWithRef
                key={id}
                zIndex={zIndex} // Apply calculated Z-Index
                position={position}
                // ... interaction handlers
            />
        );
    });
};
```

## 4. Custom Marker Content and Collision Behavior

The `AdvancedMarker` component supports rich HTML/JSX content as children. This
allows complex styling and internal state management within the marker itself.

### 4.1 Custom HTML Marker Implementation

Markers can manage their own appearance based on internal state (`clicked`,
`hovered`) or external props.

```tsx
// CustomAdvancedMarker.tsx

import React, {useState, FunctionComponent} from 'react';
import {AdvancedMarker} from '@vis.gl/react-google-maps';
import classNames from 'classnames';

interface Listing {
    // ... listing data including lat/lng
    details: { latitude: number; longitude: number };
}

interface Props {
  listing: Listing;
}

export const CustomAdvancedMarker: FunctionComponent<Props> = ({listing}) => {
  const [clicked, setClicked] = useState(false);
  const [hovered, setHovered] = useState(false);

  const position = {
    lat: listing.details.latitude,
    lng: listing.details.longitude
  };

  const renderCustomPin = () => (
    <div className="custom-pin">
        {/* Rich HTML content, e.g., images, text, buttons */}
        <div className="image-container">...</div>
        <div className="details-container">...</div>
    </div>
  );

  return (
    <AdvancedMarker
      position={position}
      title={'AdvancedMarker with custom html content.'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={classNames('real-estate-marker', {clicked, hovered})}
      onClick={() => setClicked(!clicked)}>

      {/* Render the complex JSX content as children */}
      {renderCustomPin()}
    </AdvancedMarker>
  );
};
```

### 4.2 Using the Built-in `<Pin>` Component

For a simpler, standardized marker appearance, use the `<Pin>` component as the
child of `AdvancedMarker`.

```tsx
import {AdvancedMarker, Pin} from '@vis.gl/react-google-maps';

// ... assuming `isSelected` is managed state
<AdvancedMarker position={position}>
    <Pin
        background={isSelected ? '#22ccff' : 'orange'}
        borderColor={isSelected ? '#1e89a1' : null}
        glyphColor={isSelected ? '#0f677a' : null}
    />
</AdvancedMarker>
```

### 4.3 Collision Behavior

To manage how markers overlap when zooming in, use the `collisionBehavior` prop.
The recommended value for prioritizing important markers is
`OPTIONAL_AND_HIDES_LOWER_PRIORITY`.

```tsx
import {AdvancedMarker, CollisionBehavior} from '@vis.gl/react-google-maps';

<AdvancedMarker
    position={position}
    collisionBehavior={
        CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY
    }>
    {/* ... content */}
</AdvancedMarker>
```

## 5. Casing and Strictness Reminder

When working with Maps JS SDK components and props, ensure standard JavaScript
casing is used (e.g., `position`, `zIndex`, `anchorPoint`).

| SDK/JS Property            | Description                                   |
| :------------------------- | :-------------------------------------------- |
| `position`                 | Marker location, usually `{lat: number, lng:  |
:                            : number}`.                                     :
| `zIndex`                   | Controls stacking order (number).             |
| `anchorPoint`              | Specifies where the marker's HTML content     |
:                            : anchors to the geographical location. Accepts :
:                            : values from `AdvancedMarkerAnchorPoint`.      :
| `onClick`, `onMouseEnter`, | Standard React/JS event handlers.             |
: `onMouseLeave`             :                                               :

### 5.1 Using Anchor Points

Anchor points are defined using the `AdvancedMarkerAnchorPoint` enum (exported
from `@vis.gl/react-google-maps`). This allows precise control over marker
placement, especially for custom HTML content.

```tsx
import {AdvancedMarker, AdvancedMarkerAnchorPoint} from '@vis.gl/react-google-maps';

// Example: Anchoring the marker content at its bottom center
<AdvancedMarker
    position={position}
    anchorPoint={AdvancedMarkerAnchorPoint.BOTTOM}>
    {/* ... content */}
</AdvancedMarker>

// Example: Anchoring the marker content at its left center
<AdvancedMarker
    position={position}
    anchorPoint={AdvancedMarkerAnchorPoint.LEFT_CENTER}>
    {/* ... content */}
</AdvancedMarker>
```
