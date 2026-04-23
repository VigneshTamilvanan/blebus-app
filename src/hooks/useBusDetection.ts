import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, DeviceEventEmitter, Platform } from 'react-native';
import BackgroundActions from 'react-native-background-actions';
import { DetectionResult, ScanResult } from '../ble/detection';
import { getCustomNames } from '../store/filterStore';
import { BLE_DETECTION_EVENT, BLE_TASK_OPTIONS, IDLE, bleTaskFn } from '../background/bleTask';

async function startService(onError: (msg: string) => void): Promise<void> {
  if (BackgroundActions.isRunning()) return;
  const customNames = await getCustomNames();
  console.log('[BLE] Starting background service, custom names:', customNames);
  try {
    await BackgroundActions.start(bleTaskFn, {
      ...BLE_TASK_OPTIONS,
      parameters: { customNames },
    });
  } catch (e: any) {
    onError(e.message);
  }
}

export function useBusDetection() {
  const [result, setResult]     = useState<DetectionResult>(IDLE);
  const [rawScans, setRawScans] = useState<ScanResult[]>([]);
  const [error, setError]       = useState<string | null>(null);
  const appState                = useRef<AppStateStatus>(AppState.currentState);

  const restartScan = async () => {
    if (BackgroundActions.isRunning()) await BackgroundActions.stop();
    setResult(IDLE);
    setRawScans([]);
    await startService(setError);
  };

  useEffect(() => {
    startService(setError);

    const sub = DeviceEventEmitter.addListener(
      BLE_DETECTION_EVENT,
      ({ result: r, rawScans: s }: { result: DetectionResult; rawScans: ScanResult[] }) => {
        setResult(r);
        setRawScans(s);
      },
    );

    // On Android (especially MIUI/Samsung) the OS may kill the foreground service
    // while the app is backgrounded. Re-check on every foreground transition and
    // restart the service if it was killed.
    const appStateSub = Platform.OS === 'android'
      ? AppState.addEventListener('change', (next: AppStateStatus) => {
          const prev = appState.current;
          appState.current = next;
          if (prev.match(/inactive|background/) && next === 'active') {
            if (!BackgroundActions.isRunning()) {
              console.log('[BLE] Service was killed while backgrounded — restarting');
              startService(setError);
            }
          }
        })
      : null;

    return () => {
      sub.remove();
      appStateSub?.remove();
      BackgroundActions.stop();
    };
  }, []);

  return { result, rawScans, error, restartScan };
}
