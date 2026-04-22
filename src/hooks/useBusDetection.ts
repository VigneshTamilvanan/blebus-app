import { useEffect, useRef, useState } from 'react';
import { BusDetectionEngine, DetectionResult } from '../ble/detection';
import { ScanResult, startScan } from '../ble/scanner';

const IDLE: DetectionResult = {
  busId: null, state: 'scanning', confidence: 0,
  rawRssi: 0, avgRssi: 0, distanceM: 0, distanceScore: 0, trend: 'stable',
};

export function useBusDetection() {
  const [result, setResult]       = useState<DetectionResult>(IDLE);
  const [rawScans, setRawScans]   = useState<ScanResult[]>([]);
  const [error, setError]         = useState<string | null>(null);
  const engineRef                 = useRef(new BusDetectionEngine());

  useEffect(() => {
    console.log('[BLE] Starting scan...');
    const stop = startScan(
      (scanResults) => {
        setRawScans(scanResults);
        if (scanResults.length > 0) {
          console.log('[BLE] Scan results:', JSON.stringify(scanResults));
        }
        const detection = engineRef.current.update(scanResults);
        if (detection.busId) {
          console.log('[BLE] Detection:', JSON.stringify(detection));
        }
        setResult(detection);
      },
      (err) => {
        console.error('[BLE] Error:', err.message);
        setError(err.message);
      },
    );
    return stop;
  }, []);

  return { result, rawScans, error };
}
