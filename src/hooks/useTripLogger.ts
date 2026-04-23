import { useEffect, useRef, useState } from 'react';
import { DetectionResult } from '../ble/detection';
import { insertBoarding, insertBreadcrumb, updateDeboarding } from '../db/database';
import { Coords } from './useLocation';

const BREADCRUMB_INTERVAL_MS = 30_000;

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

    if (prev !== 'confirmed' && cur === 'confirmed' && result.busId) {
      const loc = locationRef.current;
      insertBoarding(result.busId, Date.now(), loc?.lat ?? null, loc?.lng ?? null)
        .then(id => {
          activeTripId.current = id;
          console.log('[Trip] Boarded', result.busId, 'tripId:', id);

          // Record GPS breadcrumbs every 30 s while on the bus
          breadcrumbTimer.current = setInterval(() => {
            const l = locationRef.current;
            if (l && activeTripId.current !== null) {
              insertBreadcrumb(activeTripId.current, l.lat, l.lng).catch(() => {});
            }
          }, BREADCRUMB_INTERVAL_MS);
        });
    }

    if (prev === 'confirmed' && cur === 'lost' && activeTripId.current !== null) {
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
  }, [result.state]);

  // Clean up timer on unmount
  useEffect(() => () => {
    if (breadcrumbTimer.current) clearInterval(breadcrumbTimer.current);
  }, []);

  return { lastCompletedTripId };
}
