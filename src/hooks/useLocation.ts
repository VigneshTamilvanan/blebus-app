import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';

export interface Coords { lat: number; lng: number; }

export function useLocation() {
  const coords = useRef<Coords | null>(null);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
        (loc) => {
          coords.current = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        },
      );
    })();

    return () => { sub?.remove(); };
  }, []);

  return coords; // ref — always current position without re-renders
}
