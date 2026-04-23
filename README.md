# blebus-app

Android/iOS app that detects BLE beacons on buses and tracks boarding and deboarding in real time — including when the app is running in the background.

## How it works

Each bus carries an ESP32 beacon advertising a unique `bus_id` via BLE Manufacturer Specific Data. The app continuously scans for these beacons and runs a state machine to determine whether you have boarded or deboarded.

```
scanning → candidate → confirmed (boarded) → lost (deboarded)
```

**Boarding confirmation** requires:
- Signal above noise floor (`-87 dBm`) for 6 continuous seconds
- Low RSSI variance ≤ 10 dBm² — rejects passing buses with fluctuating signal
- Dominant lead over any competing beacon (5 dB margin)
- Signal not receding — if a bus drives past during the dwell window, candidate resets

**Deboarding** triggers after the beacon disappears from scan results for 2.5 s (stale expiry) followed by a 5 s exit countdown.

## Features

| Feature | Detail |
|---|---|
| Rolling RSSI average | 5-sample window smooths BLE noise |
| Signal trend | Approaching / stable / receding via OLS linear regression |
| Distance estimate | Log-distance path loss model, TX power calibrated for ESP32 |
| Passing-bus guard | Candidate resets if signal recedes for ≥ 2.5 s before confirming |
| Variance gate | High RSSI variance (moving beacon) defers boarding confirmation |
| Background scanning | Android foreground service + iOS `bluetooth-central` mode |
| Local notifications | Push notification on boarding and deboarding |
| Trip history | SQLite log of boarding/deboarding time, duration, GPS coordinates |
| Test mode | Enter any BLE device name in Settings to test without an ESP32 |
| Custom filter | Settings screen stores custom device names in AsyncStorage |
| Dynamic UI | Background colour ramps amber → green based on proximity |
| Animations | Radar rings while scanning, pulse rings on boarding |

## Architecture

```
BackgroundActions (foreground service)
    └── startScan() — react-native-ble-plx
            └── BusDetectionEngine — state machine + trend analysis
                    ├── DeviceEventEmitter → useBusDetection hook → UI
                    ├── Local notification (expo-notifications)
                    └── (trip logging via useTripLogger when foregrounded)
```

**Background behaviour:**
- Android: `react-native-background-actions` starts a foreground service. A persistent notification ("Bus Detection Active") keeps the process alive even when the app is in the background. Boarding/deboarding events post local notifications.
- iOS: `bluetooth-central` background mode declared in `Info.plist`. Core Bluetooth wakes the app on beacon discovery. Scan rate is throttled by the OS but sufficient for boarding detection.

## Stack

| Layer | Library |
|---|---|
| Framework | React Native + Expo SDK 54 (bare workflow) |
| BLE scanning | `react-native-ble-plx` |
| Background service | `react-native-background-actions` |
| Local notifications | `expo-notifications` |
| Trip storage | `expo-sqlite` |
| GPS location | `expo-location` |
| Settings persistence | `@react-native-async-storage/async-storage` |

## Screens

### Detect (Home)
Live detection state with animated radar/pulse rings, distance score, signal trend badge (↑ approaching / → stable / ↓ receding), and raw RSSI readout.

### History
FlatList of all trips from SQLite: bus ID, boarding time, deboarding time, travel duration, GPS coordinates at boarding and deboarding. Pull-to-refresh. Clear-all button.

### Settings
- Info card explaining the default beacon filter (`BUS-` prefix and manufacturer data format)
- Text input to add custom BLE device names for testing without an ESP32
- Changes automatically restart the background scanner with updated filters

## Building

### Prerequisites
- Java 17 (`/usr/libexec/java_home -v 17`)
- Android SDK with NDK 27.1.12297006
- Node 18+

```bash
# Install dependencies
npm install

# Bundle JS
npx expo export:embed --platform android \
  --entry-file index.ts \
  --bundle-output android/app/src/main/assets/index.android.bundle

# Build APK (use Java 17 explicitly)
JAVA_HOME=$(/usr/libexec/java_home -v 17) \
  ./android/gradlew -p android assembleDebug

# Install on device
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

> The `local.properties` file must point to your Android SDK:
> ```
> sdk.dir=/Users/<you>/Library/Android/sdk
> ```

## Beacon format

The ESP32 firmware advertises `ADV_TYPE_NONCONN_IND` packets with Manufacturer Specific Data:

```
[length][0xFF][company_lo][company_hi][bus_id UTF-8 bytes]
```

Company ID: `0xFFFF`. Bus IDs follow the pattern `BUS-<number>`, flashed per-device via NVS.
TX power is set to +9 dBm with `esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, ESP_PWR_LVL_P9)`.

## Detection thresholds

| Parameter | Value | Purpose |
|---|---|---|
| `STRONG_THRESHOLD` | -87 dBm | Minimum avg RSSI to start candidate tracking |
| `NOISE_FLOOR` | -85 dBm | Scanner drops raw readings below this |
| `STABILITY_SECONDS` | 6 s | Dwell time required before boarding confirms |
| `MAX_VARIANCE_TO_CONFIRM` | 10 dBm² | Rejects volatile / moving beacons |
| `PASSING_BUS_RECEDE_SECS` | 2.5 s | Resets candidate if signal is receding |
| `EXIT_RSSI_THRESHOLD` | -93 dBm | Signal floor that starts exit countdown |
| `EXIT_SECONDS` | 5 s | Countdown before declaring deboarded |
| `STALE_MS` | 2500 ms | Scanner drops entry if no packet received |
| `ROLLING_WINDOW` | 5 samples | RSSI averaging window |
| `TREND_WINDOW` | 6 samples | OLS slope window for trend calculation |
| `TX_POWER_1M` | -67 dBm | Calibrated RSSI at 1 m (ESP32 +9 dBm TX) |
| `PATH_LOSS_N` | 2.5 | Path loss exponent for distance model |

## Android permissions

| Permission | Reason |
|---|---|
| `BLUETOOTH_SCAN` | BLE scanning |
| `BLUETOOTH_CONNECT` | BLE state management |
| `ACCESS_FINE_LOCATION` | Required for BLE scan on Android 6–11 |
| `ACCESS_BACKGROUND_LOCATION` | BLE scan while backgrounded (Android 10+) |
| `FOREGROUND_SERVICE` | Keep scanner alive in background |
| `FOREGROUND_SERVICE_CONNECTED_DEVICE` | Foreground service type for BLE (Android 14+) |
| `POST_NOTIFICATIONS` | Local boarding/deboarding notifications (Android 13+) |

## Testing without an ESP32

Any BLE device that actively advertises its name can be used:
1. Open **Settings** in the app
2. Type the exact device name (as shown in your phone's Bluetooth scan)
3. Tap **Add** — the scanner restarts immediately

Devices that work: printers, smartwatches, BLE peripherals. Android phones and MacBooks do **not** advertise their names in BLE GAP packets by default.

## Trip logging

Each confirmed boarding opens a SQLite record. On deboarding, the record is updated with:
- Deboarding timestamp
- GPS coordinates at boarding and deboarding (via `expo-location`)
- Duration in seconds

The History screen shows all trips including the currently active one (green dot).
