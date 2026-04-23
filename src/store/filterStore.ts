import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'custom_device_names';

export async function getCustomNames(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveCustomNames(names: string[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(names));
}
