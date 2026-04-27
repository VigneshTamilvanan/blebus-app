import { useEffect, useRef, useState } from 'react';
import { DetectionResult } from '../ble/detection';
import { findTripByBoardedAt, insertBoarding, insertBreadcrumb, updateDeboarding } from '../db/database';
import { Coords } from './useLocation';

const BREADCRUMB_INTERVAL_MS = 30_000;

function startBreadcrumbTimer(
  tripIdRef: React.MutableRefObject<number | null>,
  locationRef: React.MutableRefObject<Coords | null>,
  timerRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
) {
  if (timerRef.current) return; // already running
  timerRef.current = setInterval(() => {
    const l = locationRef.current;
    if (l && tripIdRef.current !== null) {
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

  useEffect(() => {
    const prev = prevState.current;
    const cur  = result.state;
    prevState.current = cur;

    // ── Boarding ──────────────────────────────────────────────────────────────
    if (prev !== 'confirmed' && cur === 'confirmed' && result.busId) {
      const boardedAt = result.boardedAtMs ?? Date.now();

      // If the native service restored boarding state (app reopen), look up the
      // existing trip row instead of inserting a duplicate.
      findTripByBoardedAt(boardedAt).then(existingId => {
        if (existingId !== null) {
          activeTripId.current = existingId;
          console.log('[Trip] Restored trip', result.busId, 'tripId:', existingId);
        } else {
          const loc = locationRef.current;
          insertBoarding(result.busId!, boardedAt, loc?.lat ?? null, loc?.lng ?? null)
            .then(id => {
              activeTripId.current = id;
              console.log('[Trip] Boarded', result.busId, 'tripId:', id);
            });
        }
        startBreadcrumbTimer(activeTripId, locationRef, breadcrumbTimer);
      });
    }

    // ── Deboarding ────────────────────────────────────────────────────────────
    // State machine: confirmed → pendingDeboard → lost
    // prev is 'pendingDeboard' (not 'confirmed') when cur becomes 'lost'.
    if (cur === 'lost' && activeTripId.current !== null) {
      if (breadcrumbTimer.current) {
        clearInterval(breadcrumbTimer.current);
        breadcrumbTimer.current = null;
      }
      const loc    = locationRef.current;
      const tripId = activeTripId.current;
      updateDeboarding(tripId, Date.now(), loc?.lat ?? null, loc?.lng ?? null)
        .then(() => {
          console.log('[Trip] Deboarded, tripId:', tripId);
          setLastCompletedTripId(tripId);
          activeTripId.current = null;
        });
    }
  }, [result.state, result.boardedAtMs]);

  // Clean up timer on unmount
  useEffect(() => () => {
    if (breadcrumbTimer.current) clearInterval(breadcrumbTimer.current);
  }, []);

  return { lastCompletedTripId };
}
