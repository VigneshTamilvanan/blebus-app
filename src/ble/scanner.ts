import { BleManager, Device, State } from 'react-native-ble-plx';
import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';
import { ScanResult } from './detection';

const COMPANY_ID     = 0xffff;
const NOISE_FLOOR    = -85;
const ROLLING_WINDOW = 5;
const NAME_PREFIX    = 'NY-BUS-';
const STALE_MS       = 2500;

const manager = new BleManager();

const rssiBuffers: Record<string, number[]> = {};
const lastSeen:    Record<string, number>   = {};

function rollingAvg(busId: string, rssi: number): number {
  if (!rssiBuffers[busId]) rssiBuffers[busId] = [];
  const buf = rssiBuffers[busId];
  buf.push(rssi);
  if (buf.length > ROLLING_WINDOW) buf.shift();
  return buf.reduce((a, b) => a + b, 0) / buf.length;
}

function parseBusId(device: Device, customNames: string[]): { busId: string; isBus: boolean } | null {
  // Production: manufacturer data with our company ID
  if (device.manufacturerData) {
    try {
      const binary = atob(device.manufacturerData);
      if (binary.length > 2) {
        const companyId = binary.charCodeAt(0) | (binary.charCodeAt(1) << 8);
        if (companyId === COMPANY_ID) return { busId: binary.slice(2), isBus: true };
      }
    } catch {}
  }
  // Production: NY-BUS- name prefix
  if (device.name?.startsWith(NAME_PREFIX)) return { busId: device.name, isBus: true };
  // Test mode: custom device names — flagged as non-bus so engine deprioritises them
  if (device.name && customNames.includes(device.name)) return { busId: device.name, isBus: false };
  return null;
}

async function requestAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const apiLevel = Platform.Version as number;
  if (apiLevel >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    return Object.values(result).every(v => v === PermissionsAndroid.RESULTS.GRANTED);
  } else {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
}

function promptEnableBluetooth(): void {
  if (Platform.OS === 'android') {
    // ACTION_REQUEST_ENABLE shows the system "Turn on Bluetooth?" dialog.
    // manager.enable() is deprecated/no-op on Android 12+, so we use the intent directly.
    Linking.sendIntent('android.bluetooth.adapter.action.REQUEST_ENABLE').catch(() => {
      Alert.alert(
        'Bluetooth is off',
        'Please enable Bluetooth to detect nearby buses.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
    });
  } else {
    Alert.alert(
      'Bluetooth is off',
      'Please enable Bluetooth in Settings to detect nearby buses.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openURL('App-Prefs:Bluetooth') },
      ],
    );
  }
}

export function startScan(
  onResults: (results: ScanResult[]) => void,
  onError: (err: Error) => void,
  customNames: string[] = [],
): () => void {
  const latest: Record<string, ScanResult> = {};
  let stopped = false;

  const interval = setInterval(() => {
    const now = Date.now();
    for (const id of Object.keys(latest)) {
      if (now - (lastSeen[id] ?? 0) > STALE_MS) {
        delete latest[id];
        delete lastSeen[id];
        delete rssiBuffers[id];
      }
    }
    onResults(Object.values(latest));
  }, 1000);

  requestAndroidPermissions().then((granted) => {
    console.log('[BLE] Permissions granted:', granted);
    if (!granted) {
      onError(new Error('Bluetooth/location permissions denied'));
      return;
    }
    if (stopped) return;

    manager.onStateChange((state) => {
      console.log('[BLE] Bluetooth state:', state);
      if (stopped) return;

      if (state === State.PoweredOff) {
        promptEnableBluetooth();
      }

      if (state === State.PoweredOn) {
        console.log('[BLE] Starting device scan...');
        manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
          if (error) { console.error('[BLE] Scan error:', error.message); onError(error); return; }
          if (!device || device.rssi === null || device.rssi < NOISE_FLOOR) return;
          if (device.name) console.log('[BLE] Raw device:', device.name, device.rssi, 'dBm');
          const parsed = parseBusId(device, customNames);
          if (parsed) console.log('[BLE] Found beacon:', parsed.busId, 'isBus:', parsed.isBus, 'RSSI:', device.rssi);
          if (!parsed) return;
          const { busId, isBus } = parsed;
          const avg = rollingAvg(busId, device.rssi);
          lastSeen[busId] = Date.now();
          latest[busId]   = { busId, isBus, rawRssi: device.rssi, avgRssi: avg };
        });
      }
    }, true);
  });

  return () => {
    stopped = true;
    clearInterval(interval);
    manager.stopDeviceScan();
  };
}
