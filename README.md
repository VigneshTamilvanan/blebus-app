# blebus-app

Android app that detects BLE beacons on buses and tracks boarding state in real time.

## How it works

Each bus carries an ESP32 beacon advertising a unique `bus_id` via BLE Manufacturer Specific Data. The app continuously scans for these beacons and runs a state machine to determine whether you have boarded or deboarded.

```
scanning → candidate → confirmed (boarded) → lost (deboarded)
```

**Boarding confirmation** requires:
- Signal above noise floor for 6 continuous seconds
- Low RSSI variance (rejects passing buses with fluctuating signal)
- Dominant lead over any competing beacon (5 dB margin)
- Signal not receding — if the bus is driving away during the dwell window, the candidate resets

**Deboarding** triggers after the beacon disappears from scan results for 2.5 s (stale expiry) followed by a 5 s exit countdown.

## Features

- Rolling average RSSI (5-sample window) to smooth out BLE noise
- Approaching / stable / receding trend via linear regression over signal history
- Distance estimate using log-distance path loss model
- Background colour ramps from amber (far) → green (on bus) based on distance score
- Pulse ring animation on boarding, radar rings while scanning

## Stack

- React Native + Expo SDK 54
- `react-native-ble-plx` for BLE scanning
- Local Gradle build (no EAS required)

## Building

```bash
# Install dependencies
npm install

# Export JS bundle
npx expo export --platform android
cp dist/_expo/static/js/android/<hash>.hbc android/app/src/main/assets/index.android.bundle

# Build APK
cd android && ./gradlew assembleDebug

# Install on device
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Requires Java 17 and Android SDK with NDK 27.1.12297006.

## Beacon format

The ESP32 firmware advertises `ADV_TYPE_NONCONN_IND` packets with Manufacturer Specific Data:

```
[length][0xFF][company_lo][company_hi][bus_id UTF-8 bytes]
```

Company ID is `0xFFFF`. Bus IDs follow the pattern `BUS-<number>` and are flashed per-device via NVS.

## Thresholds

| Parameter | Value | Purpose |
|---|---|---|
| `STRONG_THRESHOLD` | -87 dBm | Minimum avg RSSI to consider a candidate |
| `STABILITY_SECONDS` | 6 s | Dwell time before boarding confirms |
| `MAX_VARIANCE_TO_CONFIRM` | 10 dBm² | Rejects volatile (moving) beacons |
| `PASSING_BUS_RECEDE_SECS` | 2.5 s | Resets candidate if signal is receding |
| `EXIT_SECONDS` | 5 s | Countdown before declaring deboarded |
| `TX_POWER_1M` | -67 dBm | Calibrated RSSI at 1 m for ESP32 +9 dBm TX |
