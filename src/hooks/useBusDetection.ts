import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus, DeviceEventEmitter, Linking, NativeModules, Platform } from 'react-native';
import BackgroundActions from 'react-native-background-actions';
import * as ExpoLocation from 'expo-location';
import { DetectionResult, ScanResult } from '../ble/detection';
import { getCustomNames } from '../store/filterStore';
import { BLE_DETECTION_EVENT, BLE_TASK_OPTIONS, IDLE, bleTaskFn } from '../background/bleTask';
import { monitorBluetooth } from '../ble/scanner';

async function startService(onError: (msg: string) => void): Promise<void> {
  const customNames = await getCustomNames();
  console.log('[BLE] Starting service, custom names:', customNames);
  try {
    if (Platform.OS === 'android') {
      // Native Kotlin service — BLE scanning runs on a HandlerThread, not the JS thread.
      // Immune to MIUI/OEM JS-thread throttling.
      NativeModules.BLEDetection.start(customNames);
    } else {
      if (BackgroundActions.isRunning()) return;
      await BackgroundActions.start(bleTaskFn, {
        ...BLE_TASK_OPTIONS,
        parameters: { customNames },
      });
    }
  } catch (e: any) {
    onError(e?.message ?? 'Failed to start BLE service');
  }
}

async function stopService(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      NativeModules.BLEDetection.stop();
    } else {
      await BackgroundActions.stop();
    }
  } catch (_) {}
}

async function checkLocationServices(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  // First ensure we have the permission — this shows the system permission dialog if needed.
  const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert(
      'Location permission needed',
      'Please grant Location permission so the app can detect nearby buses.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ],
    );
    return false;
  }

  // Then check if the device's Location Services toggle is on.
  const on = await ExpoLocation.hasServicesEnabledAsync();
  if (!on) {
    Alert.alert(
      'Location is off',
      'Please enable Location Services so the app can detect nearby buses.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => Linking.openSettings()) },
      ],
    );
  }
  return on;
}

export function useBusDetection() {
  const [result, setResult]       = useState<DetectionResult>(IDLE);
  const [rawScans, setRawScans]   = useState<ScanResult[]>([]);
  const [error, setError]         = useState<string | null>(null);
  const [btOn, setBtOn]           = useState(true);
  const [locationOn, setLocationOn] = useState(true);
  const appState                  = useRef<AppStateStatus>(AppState.currentState);

  const restartScan = async () => {
    await stopService();
    setResult(IDLE);
    setRawScans([]);
    await startService(setError);
  };

  useEffect(() => {
    startService(setError);

    // Check location services on mount (also requests permission → system dialog)
    checkLocationServices().then(on => setLocationOn(on));

    // Poll location services every 3s to catch runtime toggles without a full foreground event
    const locationPoll = setInterval(() => {
      ExpoLocation.hasServicesEnabledAsync().then(on => setLocationOn(on));
    }, 3000);

    const sub = DeviceEventEmitter.addListener(
      BLE_DETECTION_EVENT,
      ({ result: r, rawScans: s }: { result: DetectionResult; rawScans: ScanResult[] }) => {
        setResult(r);
        setRawScans(s);
      },
    );

    // On Android: re-ensure the native service is running each time the app foregrounds.
    // Also re-check location services each foreground (user may have toggled it).
    const appStateSub = Platform.OS === 'android'
      ? AppState.addEventListener('change', (next: AppStateStatus) => {
          const prev = appState.current;
          appState.current = next;
          if (prev.match(/inactive|background/) && next === 'active') {
            startService(setError);
            ExpoLocation.hasServicesEnabledAsync().then(on => setLocationOn(on));
          }
        })
      : null;

    // On Android the native service bypasses scanner.ts, so manager.onStateChange
    // never runs. Monitor BT state here for the prompt and for UI status.
    const stopBtWatch = Platform.OS === 'android'
      ? monitorBluetooth(on => setBtOn(on))
      : null;

    return () => {
      sub.remove();
      appStateSub?.remove();
      stopBtWatch?.();
      clearInterval(locationPoll);
      stopService();
    };
  }, []);

  return { result, rawScans, error, btOn, locationOn, restartScan };
}
