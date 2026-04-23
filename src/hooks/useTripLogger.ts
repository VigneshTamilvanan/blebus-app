import { useEffect, useRef } from 'react';
import { DetectionResult } from '../ble/detection';
import { insertBoarding, updateDeboarding } from '../db/database';
import { Coords } from './useLocation';

export function useTripLogger(
  result: DetectionResult,
  locationRef: React.MutableRefObject<Coords | null>,
) {
  const prevState  = useRef(result.state);
  const activeTripId = useRef<number | null>(null);

  useEffect(() => {
    const prev = prevState.current;
    const cur  = result.state;
    prevState.current = cur;

    if (prev !== 'confirmed' && cur === 'confirmed' && result.busId) {
      // Boarding event
      const loc = locationRef.current;
      insertBoarding(
        result.busId,
        Date.now(),
        loc?.lat ?? null,
        loc?.lng ?? null,
      ).then(id => {
        activeTripId.current = id;
        console.log('[Trip] Boarded', result.busId, 'tripId:', id);
      });
    }

    if (prev === 'confirmed' && cur === 'lost' && activeTripId.current !== null) {
      // Deboarding event
      const loc = locationRef.current;
      updateDeboarding(
        activeTripId.current,
        Date.now(),
        loc?.lat ?? null,
        loc?.lng ?? null,
      ).then(() => {
        console.log('[Trip] Deboarded, tripId:', activeTripId.current);
        activeTripId.current = null;
      });
    }
  }, [result.state]);
}
