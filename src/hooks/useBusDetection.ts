import { useEffect, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
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

    return () => {
      sub.remove();
      // Stop the service when the root component unmounts (app fully closed by RN runtime).
      // On Android this also cancels the foreground service notification.
      BackgroundActions.stop();
    };
  }, []);

  return { result, rawScans, error, restartScan };
}
