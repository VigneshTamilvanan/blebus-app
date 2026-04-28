import { useEffect, useRef, useState } from 'react';
import { DetectionResult } from '../ble/detection';
import { findTripByBoardedAt, insertBoarding, insertBreadcrumb, updateDeboarding } from '../db/database';
import { Coords } from './useLocation';

const BREADCRUMB_INTERVAL_MS = 30_000;

function startBreadcrumbTimer(
  tripIdRef: React.MutableRefObject<number | null>,
  nativeLocRef: React.MutableRefObject<{ lat: number | null; lng: number | null }>,
  jsLocRef: React.MutableRefObject<Coords | null>,
  timerRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
) {
  if (timerRef.current) return;
  timerRef.current = setInterval(() => {
    if (tripIdRef.current === null) return;
    // Prefer native GPS (works while screen locked), fall back to JS location.
    const l = nativeLocRef.current.lat !== null
      ? nativeLocRef.current
      : jsLocRef.current;
    if (l?.lat != null && l?.lng != null) {
      insertBreadcrumb(tripIdRef.current, l.lat, l.lng).catch(() => {});
    }
  }, BREADCRUMB_INTERVAL_MS);
}

export function useTripLogger(
  result: DetectionResult,
  locationRef: React.MutableRefObject<Coords | null>,
) {
  const prevState        = useRef(result.state);
  const activeTripId     = useRef<number | null>(null);
  const breadcrumbTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastCompletedTripId, setLastCompletedTripId] = useState<number | null>(null);
  // Tracks the latest native GPS coordinates (from FusedLocationProviderClient via detection event).
  // Updated on every event so the breadcrumb timer and boarding/deboarding events use it.
  const nativeLocRef = useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });

  // Keep nativeLocRef current on every detection tick.
  useEffect(() => {
    if (result.lat !== null && result.lng !== null) {
      nativeLocRef.current = { lat: result.lat, lng: result.lng };
    }
  });

  useEffect(() => {
    const prev = prevState.current;
    const cur  = result.state;
    prevState.current = cur;

    // ── Boarding ──────────────────────────────────────────────────────────────
    if (prev !== 'confirmed' && cur === 'confirmed' && result.busId) {
      const boardedAt = result.boardedAtMs ?? Date.now();
      // Native GPS first, JS locationRef as fallback.
      const loc = nativeLocRef.current.lat !== null ? nativeLocRef.current : locationRef.current;

      findTripByBoardedAt(boardedAt).then(existingId => {
        if (existingId !== null) {
          activeTripId.current = existingId;
          console.log('[Trip] Restored trip', result.busId, 'tripId:', existingId);
        } else {
          insertBoarding(result.busId!, boardedAt, loc?.lat ?? null, loc?.lng ?? null)
            .then(id => {
              activeTripId.current = id;
              console.log('[Trip] Boarded', result.busId, 'tripId:', id);
            });
        }
        startBreadcrumbTimer(activeTripId, nativeLocRef, locationRef, breadcrumbTimer);
      });
    }

    // ── Deboarding ────────────────────────────────────────────────────────────
    if (cur === 'lost' && activeTripId.current !== null) {
      if (breadcrumbTimer.current) {
        clearInterval(breadcrumbTimer.current);
        breadcrumbTimer.current = null;
      }
      const tripId = activeTripId.current;
      // When phone was asleep during deboarding, use the last moment the beacon was
      // actually visible (lastBeaconSeenMs + lastBeaconSeenLat/Lng from native service).
      // This is far more accurate than Date.now() / current GPS when user opens the app.
      const deboardTime = result.lastBeaconSeenMs ?? Date.now();
      const deboardLat  = result.lastBeaconSeenLat ?? nativeLocRef.current.lat ?? locationRef.current?.lat ?? null;
      const deboardLng  = result.lastBeaconSeenLng ?? nativeLocRef.current.lng ?? locationRef.current?.lng ?? null;
      updateDeboarding(tripId, deboardTime, deboardLat, deboardLng)
        .then(() => {
          console.log('[Trip] Deboarded, tripId:', tripId, 'time:', new Date(deboardTime).toISOString());
          setLastCompletedTripId(tripId);
          activeTripId.current = null;
        });
    }
  }, [result.state, result.boardedAtMs, result.lastBeaconSeenMs]);

  // Clean up timer on unmount
  useEffect(() => () => {
    if (breadcrumbTimer.current) clearInterval(breadcrumbTimer.current);
  }, []);

  return { lastCompletedTripId };
}
