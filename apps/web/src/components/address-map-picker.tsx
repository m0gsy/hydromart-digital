'use client';

import { useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Address pin picker (gap 13c) — OSM tiles (no API key), click or drag the pin to
// set lat/lng. Leaflet touches `window`, so the consumer MUST import this via
// next/dynamic({ ssr: false }). A CSS divIcon avoids the classic bundler-breaks-the-
// default-marker-png problem entirely. ponytail: no reverse-geocode — the text
// address fields stay authoritative; the pin only supplies coordinates for routing.

// Default center: Bandung (matches the manual-entry placeholder in the address form).
const DEFAULT_CENTER: [number, number] = [-6.9147, 107.6098];

const PIN_ICON = L.divIcon({
  className: 'hm-pin',
  html: '<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;background:#0c97ac;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);transform:rotate(-45deg)"></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

function ClickCapture({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function AddressMapPicker({
  lat,
  lng,
  onChange,
}: {
  lat: string;
  lng: string;
  onChange: (lat: number, lng: number) => void;
}) {
  const parsed = useMemo<[number, number] | null>(() => {
    const la = Number(lat);
    const ln = Number(lng);
    if (lat.trim() === '' || lng.trim() === '' || Number.isNaN(la) || Number.isNaN(ln)) return null;
    return [la, ln];
  }, [lat, lng]);

  const center = parsed ?? DEFAULT_CENTER;

  return (
    <MapContainer
      center={center}
      zoom={parsed ? 16 : 12}
      scrollWheelZoom={false}
      style={{ height: 220, width: '100%', borderRadius: 16, zIndex: 0 }}
      aria-label="Peta pilih lokasi"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickCapture onChange={onChange} />
      {parsed && (
        <Marker
          position={parsed}
          icon={PIN_ICON}
          draggable
          eventHandlers={{
            dragend(e) {
              const p = e.target.getLatLng();
              onChange(p.lat, p.lng);
            },
          }}
        />
      )}
    </MapContainer>
  );
}
