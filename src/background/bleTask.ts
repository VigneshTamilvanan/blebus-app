import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import BackgroundActions from 'react-native-background-actions';
import { BusDetectionEngine, DetectionResult, ScanResult } from '../ble/detection';
import { startScan } from '../ble/scanner';
import { dismissCandidate, notifyBoarded, notifyCandidate, notifyDeboarded, setupNotifications } from './notifications';

export const BLE_DETECTION_EVENT = 'ble_detection_update';

export const IDLE: DetectionResult = {
  busId: null, state: 'scanning', confidence: 0,
  rawRssi: 0, avgRssi: 0, distanceM: 0, distanceScore: 0, trend: 'stable', boardedAtMs: null, candidates: [], switchCandidate: null,
};

export const BLE_TASK_OPTIONS = {
  taskName: 'BLEScanner',
  taskTitle: 'Bus Detection Active',
  taskDesc: 'Scanning for nearby buses',
  taskIcon: { name: 'ic_launcher', type: 'mipmap' },
  color: '#FFD000',
  foregroundServiceType: ['connectedDevice' as const],
  parameters: { customNames: [] as string[] },
};

export async function bleTaskFn(taskDataArguments?: { customNames: string[] }): Promise<void> {
  // Ensure the notification channel exists before firing any notifications.
  // setupNotifications() in App.tsx only runs when the UI is mounted, which
  // doesn't happen in background — so we call it here too.
  await setupNotifications();

  if (Platform.OS === 'android') {
    NativeModules.WakeLock?.acquire();
  }

  const customNames = taskDataArguments?.customNames ?? [];
  const engine      = new BusDetectionEngine();
  let lastState     = 'scanning';

  const stop = startScan(
    (scanResults: ScanResult[]) => {
      const detection = engine.update(scanResults);

      // Emit to UI — works when app process is alive (foreground or bg service)
      DeviceEventEmitter.emit(BLE_DETECTION_EVENT, { result: detection, rawScans: scanResults });

      // Log every state change so we can trace the detection pipeline
      if (detection.state !== lastState) {
        console.log('[BLE] State:', lastState, '→', detection.state, '|', detection.busId, '| avg:', detection.avgRssi.toFixed(0), 'conf:', detection.confidence.toFixed(2));
      }

      // Notifications on state transitions
      if (lastState === 'scanning' && detection.state === 'candidate' && detection.busId) {
        // Bus just appeared — alert user so they can open the app
        notifyCandidate(detection.busId).catch(() => {});
      } else if (lastState === 'candidate' && detection.state === 'scanning') {
        // Candidate was reset (passing bus or signal lost before confirming)
        dismissCandidate().catch(() => {});
      } else if (lastState !== 'confirmed' && detection.state === 'confirmed' && detection.busId) {
        // Boarding confirmed — dismisses candidate notification automatically
        notifyBoarded(detection.busId).catch(() => {});
      } else if (lastState === 'confirmed' && detection.state === 'lost' && detection.busId) {
        notifyDeboarded(detection.busId).catch(() => {});
      }

      lastState = detection.state;
    },
    (err) => console.error('[BLE Background] Error:', err.message),
    customNames,
  );

  // Keep the promise alive while the foreground service is running.
  // On Android the foreground service keeps the process alive even when the
  // app is backgrounded; on iOS the system may suspend after a while.
  await new Promise<void>(resolve => {
    const keepAlive = setInterval(() => {
      if (!BackgroundActions.isRunning()) {
        clearInterval(keepAlive);
        resolve();
      }
    }, 5000);
  });

  stop();
  if (Platform.OS === 'android') {
    NativeModules.WakeLock?.release();
  }
}
