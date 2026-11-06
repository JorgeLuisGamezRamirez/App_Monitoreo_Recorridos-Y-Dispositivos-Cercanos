import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Trip } from './types';
const HISTORY_KEY = '@route-monitor/trips/v1';
export async function loadTrips(): Promise<Trip[]> {
  const value = await AsyncStorage.getItem(HISTORY_KEY);
  if (!value) return [];
  try { return JSON.parse(value) as Trip[]; } catch { return []; }
}
export async function saveTrips(trips: Trip[]) { await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(trips.slice(0, 100))); }
