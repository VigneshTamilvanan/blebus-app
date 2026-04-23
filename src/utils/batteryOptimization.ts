import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'battery_opt_prompted';

export async function promptBatteryOptimizationIfNeeded(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const already = await AsyncStorage.getItem(KEY);
  if (already) return;
  await AsyncStorage.setItem(KEY, '1');

  Alert.alert(
    'Allow background scanning',
    'For the app to detect buses while in the background, disable battery optimization:\n\n' +
    '1. Tap "Open settings" below\n' +
    '2. Tap Battery → No restrictions\n\n' +
    'On Xiaomi/MIUI also enable:\n' +
    'Security app → Autostart → enable this app',
    [
      { text: 'Later', style: 'cancel' },
      {
        text: 'Open settings',
        onPress: () => Linking.openSettings(),
      },
    ],
  );
}
