export type Coordinate = { latitude: number; longitude: number; altitude: number | null; accuracy: number | null; speed: number | null; timestamp: number };
export type MotionEvent = { timestamp: number; moving: boolean; acceleration: number; orientation: { x: number; y: number; z: number } };
export type BleDetection = { deviceId: string; name: string; rssi: number; proximity: string; timestamp: number; location: Coordinate | null };
export type Trip = {
  id: string; startedAt: number; endedAt: number | null; durationSeconds: number; distanceMeters: number; averageSpeedMps: number;
  points: Coordinate[]; motionEvents: MotionEvent[]; bleDetections: BleDetection[]; selectedDeviceId: string | null; selectedDeviceName: string | null;
};
export type NearbyDevice = { id: string; name: string; rssi: number; proximity: string; lastSeen: number };
