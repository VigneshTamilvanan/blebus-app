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

const CHANNEL = 'ble-detection';

export async function notifyCandidate(busId: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: 'ble-candidate',
    content: {
      title: 'Bus detected nearby',
      body: `Verifying ${busId} — hold on…`,
      data: { busId, event: 'candidate' },
      android: { channelId: CHANNEL },
    },
    trigger: null,
  });
}

export async function dismissCandidate(): Promise<void> {
  await Notifications.dismissNotificationAsync('ble-candidate').catch(() => {});
}

export async function notifyBoarded(busId: string): Promise<void> {
  await dismissCandidate();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🚌 Boarded',
      body: `You are on ${busId}`,
      data: { busId, event: 'boarded' },
      android: { channelId: CHANNEL },
    },
    trigger: null,
  });
}

export async function notifyDeboarded(busId: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Deboarded',
      body: `You have left ${busId}`,
      data: { busId, event: 'deboarded' },
      android: { channelId: CHANNEL },
    },
    trigger: null,
  });
}
