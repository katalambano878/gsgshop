'use client';

import { useEffect, useState } from 'react';

type Point = { label: string; lat: number; lng: number };

/**
 * The pickup hub and the outside-Accra transport station, read from the live
 * delivery settings (the same values checkout uses).
 */
export function useDeliveryPoints() {
  const [hub, setHub] = useState<Point | null>(null);
  const [station, setStation] = useState<Point | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/delivery/settings')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return;
        const s = data?.settings || {};
        const ok = (p: any): p is Point => p && typeof p.label === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng);
        if (ok(s.hub)) setHub(s.hub);
        if (ok(s.transportStation)) setStation(s.transportStation);
        if (!ok(s.hub)) setFailed(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  return { hub, station, failed };
}

export function mapsUrl(p: Point): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
}

/** One line naming the pickup point, with a map link. */
export default function PickupPoint({ className = '' }: { className?: string }) {
  const { hub, failed } = useDeliveryPoints();
  if (!hub) {
    return (
      <span className={className}>
        {failed ? 'Ask us on WhatsApp for the current pickup point.' : 'Loading pickup point…'}
      </span>
    );
  }
  return (
    <span className={className}>
      {hub.label}{' '}
      (<a href={mapsUrl(hub)} target="_blank" rel="noopener noreferrer" className="underline font-semibold">map</a>)
    </span>
  );
}
