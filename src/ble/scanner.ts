import { BleManager, Device, State } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';
import { ScanResult } from './detection';

const COMPANY_ID     = 0xffff;
const NOISE_FLOOR    = -85;
const ROLLING_WINDOW = 5;
const NAME_PREFIX    = 'NY-BUS-';
const STALE_MS       = 2500; // remove beacon from latest if not seen for 2.5s

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

function parseBusId(device: Device): string | null {
  if (device.manufacturerData) {
    try {
      const binary = atob(device.manufacturerData);
      if (binary.length > 2) {
        const companyId = binary.charCodeAt(0) | (binary.charCodeAt(1) << 8);
        if (companyId === COMPANY_ID) return binary.slice(2);
      }
    } catch {}
  }
  if (device.name?.startsWith(NAME_PREFIX)) return device.name;
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

export function startScan(
  onResults: (results: ScanResult[]) => void,
  onError: (err: Error) => void,
): () => void {
  const latest: Record<string, ScanResult> = {};
  let stopped = false;

  const interval = setInterval(() => {
    // Expire beacons not seen within STALE_MS — critical for deboarding
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
      if (state === State.PoweredOn) {
        console.log('[BLE] Starting device scan...');
        manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
          if (error) { console.error('[BLE] Scan error:', error.message); onError(error); return; }
          if (!device || device.rssi === null || device.rssi < NOISE_FLOOR) return;
          const busId = parseBusId(device);
          if (busId) console.log('[BLE] Found beacon:', busId, 'RSSI:', device.rssi);
          if (!busId) return;
          const avg = rollingAvg(busId, device.rssi);
          lastSeen[busId] = Date.now();
          latest[busId]   = { busId, rawRssi: device.rssi, avgRssi: avg };
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
