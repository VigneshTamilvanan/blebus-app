import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function setupNotifications(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('ble-detection', {
      name: 'Bus Detection',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FFD000',
    });
  }
  await Notifications.requestPermissionsAsync();
}

export async function notifyBoarded(busId: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Boarded',
      body: `You have boarded ${busId}`,
      data: { busId, event: 'boarded' },
    },
    trigger: null,
  });
}

export async function notifyDeboarded(busId: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Deboarded',
      body: `You have deboarded ${busId}`,
      data: { busId, event: 'deboarded' },
    },
    trigger: null,
  });
}
