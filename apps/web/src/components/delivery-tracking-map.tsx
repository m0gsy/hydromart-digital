'use client';

import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

type Point = [number, number];

const COURIER_ICON = L.divIcon({
  className: 'hm-courier-pin',
  html: '<div style="width:24px;height:24px;border-radius:50%;background:#0c97ac;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const DESTINATION_ICON = L.divIcon({
  className: 'hm-destination-pin',
  html: '<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;background:#f59e0b;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);transform:rotate(-45deg)"></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

function FitPoints({ points }: { points: Point[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 16 });
    } else {
      map.setView(points[0]!, 16);
    }
  }, [map, points]);
  return null;
}

export default function DeliveryTrackingMap({
  courier,
  destination,
  courierLabel,
  destinationLabel,
}: {
  courier: Point;
  destination: Point | null;
  courierLabel: string;
  destinationLabel: string;
}) {
  const points = useMemo(() => (destination ? [courier, destination] : [courier]), [courier, destination]);

  return (
    <MapContainer
      center={courier}
      zoom={16}
      scrollWheelZoom={false}
      style={{ height: 220, width: '100%', borderRadius: 16, zIndex: 0 }}
      aria-label={courierLabel}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitPoints points={points} />
      <Marker position={courier} icon={COURIER_ICON}>
        <Popup>{courierLabel}</Popup>
      </Marker>
      {destination && (
        <Marker position={destination} icon={DESTINATION_ICON}>
          <Popup>{destinationLabel}</Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
