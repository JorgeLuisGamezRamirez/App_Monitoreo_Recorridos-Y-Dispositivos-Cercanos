import type { Coordinate } from './types';
const EARTH_RADIUS_METERS = 6_371_000;
const radians = (degrees: number) => (degrees * Math.PI) / 180;
export function distanceBetween(a: Coordinate, b: Coordinate): number {
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
export function proximityFromRssi(rssi: number): string {
  if (rssi >= -55) return 'Muy cerca';
  if (rssi >= -70) return 'Cerca';
  if (rssi >= -85) return 'Lejos';
  return 'Muy lejos';
}
export const formatDuration = (seconds: number) => [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((part) => String(part).padStart(2, '0')).join(':');
