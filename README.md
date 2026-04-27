# blebus-app

Android/iOS app that detects BLE beacons on buses and tracks boarding and deboarding in real time — including when the app is in the background with the screen off.

## How it works

Each bus carries an ESP32 beacon advertising a unique `bus_id` via BLE Manufacturer Specific Data. The app continuously scans for these beacons and runs a state machine to determine whether you have boarded or deboarded.

```
scanning → candidate → confirmed (boarded) → pendingDeboard → lost (deboarded)
```

**Boarding confirmation** requires:
- Signal above noise floor (`-105 dBm avg`) for 6 continuous seconds
- Low RSSI variance ≤ 15 dBm² — rejects passing buses with fluctuating signal
- Signal not receding for > 4 s — if a bus drives past during dwell, candidate resets

**Deboarding** triggers after signal drops below `-109 dBm`, starting a 5 s exit countdown. The state first moves to `pendingDeboard` (shows a confirmation banner for up to 30 s before auto-deboarding).

**Bus switch**: while boarded, if a rival bus sustains a 5 dBm advantage for 5 s and the current signal is weak (< `-98 dBm`), a banner asks the user to confirm or dismiss the switch.

## Features

| Feature | Detail |
|---|---|
| Rolling RSSI average | 5-sample window smooths BLE noise |
| Signal trend | Approaching / stable / receding via OLS linear regression |
| Distance estimate | Log-distance path loss model, TX power calibrated at 1 m |
| Passing-bus guard | Candidate resets if signal recedes for ≥ 4 s before confirming |
| Variance gate | High RSSI variance (moving beacon) defers boarding confirmation |
| isBus priority | If real bus beacon in range, custom/test devices are ignored |
| Bus-switch confirmation | If a stronger rival bus appears while boarded, shows a banner — user confirms or dismisses (auto-dismissed after 30 s cooldown) |
| Boarding timer | Elapsed time shown on home screen while boarded |
| Background scanning | Android native Kotlin service + iOS `bluetooth-central` mode |
| Local notifications | Candidate / boarded / deboarded push notifications |
| Trip history | SQLite log of boarding/deboarding time, duration, GPS coordinates |
| Trip map | Leaflet/OSM map with boarding (green) / deboarding (red) markers + polyline |
| Test mode | Enter any BLE device name in Settings to test without an ESP32 |

## Architecture

### Android (background detection)

On Android, BLE scanning and detection run entirely in a native Kotlin foreground service (`BLEDetectionService`) on a dedicated `HandlerThread`. This is immune to OEM (MIUI/Samsung) JS-thread throttling that previously caused missed deboarding events when the screen was off.

```
BLEDetectionService (Kotlin, HandlerThread)
    ├── BluetoothLeScanner.startScan() — BLE scan callbacks (Android Binder thread)
    ├── Detection state machine — candidate/confirmed/lost, 1 s tick
    ├── NotificationManager — boarding/deboarding notifications (no JS needed)
    └── BLEModule.onDetection → DeviceEventEmitter → useBusDetection hook → UI
```

### iOS

```
BackgroundActions (foreground service)
    └── startScan() — react-native-ble-plx
            └── BusDetectionEngine (TypeScript) — state machine
                    └── DeviceEventEmitter → useBusDetection → UI + notifications
```

## Stack

| Layer | Library |
|---|---|
| Framework | React Native + Expo SDK 54 (bare workflow) |
| BLE scanning | `react-native-ble-plx` |
| Android native service | Kotlin `BLEDetectionService` + `BLEModule` (RN bridge) |
| iOS background service | `react-native-background-actions` |
| Local notifications | `expo-notifications` (JS) / `NotificationManager` (Android native) |
| Trip storage | `expo-sqlite` |
| GPS location | `expo-location` |
| Maps | react-native-webview + Leaflet.js + OpenStreetMap tiles (no API key) |
| Settings persistence | `@react-native-async-storage/async-storage` |

## Building

### Prerequisites
- Java 17 (`/usr/libexec/java_home -v 17`) — Java 25 breaks Gradle plugin version parsing
- Android SDK with NDK 27.1.12297006
- Node 18+

```bash
npm install

# Bundle JS
npx expo export:embed --platform android \
  --entry-file index.ts \
  --bundle-output android/app/src/main/assets/index.android.bundle

# Build release APK (always release — debug has Metro reconnect loop)
JAVA_HOME=$(/usr/libexec/java_home -v 17) \
  ./android/gradlew -p android assembleRelease

# Install on device
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

> `android/local.properties` must point to your SDK: `sdk.dir=/Users/<you>/Library/Android/sdk`

## Beacon format

All bus hardware advertises `ADV_TYPE_NONCONN_IND` packets with Manufacturer Specific Data:

```
[length][0xFF][company_lo][company_hi][bus_id UTF-8 bytes]
```

Company ID: `0xFFFF`. Bus IDs follow the pattern `NY-BUS-<number>` or `NY-<unit>`, flashed per-device via NVS.

Two hardware classes use this identical format:

| Class | Hardware | GPS / MQTT |
|-------|----------|-----------|
| BLE Beacon | ESP32-C3 SuperMini | ✗ — BLE only |
| NY-Series Tracker-Beacon | Custom PCB — ESP32-D0WD-V3 + A7672 LTE + GPS | ✓ |

TX power (Beacon): +9 dBm via `esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, ESP_PWR_LVL_P9)`.  
TX power (NY-Series): 0 dBm default (NimBLE).

## Detection thresholds

| Parameter | Value | Purpose |
|---|---|---|
| `NOISE_FLOOR` | -115 dBm | Scanner drops raw readings below this |
| `STRONG_THRESHOLD` | -105 dBm | Minimum avg RSSI to start candidate tracking |
| `MAX_VARIANCE` | 15 dBm² | Rejects volatile / moving beacons |
| `STABILITY_MS` | 6000 ms | Dwell time required before boarding confirms |
| `PASSING_BUS_MS` | 4000 ms | Resets candidate if signal receding for this long |
| `EXIT_RSSI` | -109 dBm | Signal floor that starts exit countdown |
| `EXIT_MS` | 5000 ms | Countdown before declaring deboarded |
| `PENDING_DEBOARD_MS` | 30 000 ms | Auto-deboard if user does not respond to confirmation |
| `STALE_MS` | 6000 ms | Scanner drops entry if no packet received |
| `TX_POWER_1M` | -90 dBm | Calibrated RSSI at 1 m (ESP32-D0WD-V3, measured) |
| `PATH_LOSS_N` | 2.5 | Path loss exponent for distance model |
| `SWITCH_WEAK_THRESHOLD` | -98 dBm | Confirmed signal must be below this to consider bus switch |
| `SWITCH_RIVAL_MARGIN` | 5 dBm | Rival must exceed current bus signal by at least this |
| `SWITCH_RIVAL_MS` | 5000 ms | Rival must sustain advantage for this long before prompting |

## Android permissions

| Permission | Reason |
|---|---|
| `BLUETOOTH_SCAN` | BLE scanning |
| `BLUETOOTH_CONNECT` | BLE state management |
| `ACCESS_FINE_LOCATION` | Required for BLE scan on Android 6–11 |
| `ACCESS_BACKGROUND_LOCATION` | BLE scan while backgrounded |
| `FOREGROUND_SERVICE` | Keep scanner alive in background |
| `FOREGROUND_SERVICE_CONNECTED_DEVICE` | Foreground service type for BLE (Android 14+) |
| `POST_NOTIFICATIONS` | Local notifications (Android 13+) |
| `WAKE_LOCK` | Prevent CPU sleep while scanning |

## Testing without an ESP32

1. Open **Settings** in the app
2. Enter the exact BLE device name (as shown in your phone's Bluetooth scan)
3. Tap **Add** — the scanner restarts with the new filter

Devices that work: printers, smartwatches, BLE peripherals. Android phones and MacBooks do not advertise names in BLE GAP packets by default.
