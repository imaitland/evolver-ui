import { db } from './localDb.client';
import type { LocalDevice } from './localDb.client';

/**
 * Gets device data from the local IndexedDB by ID
 * @param deviceId The ID of the device to fetch
 * @returns The device data from the local database
 * @throws Error if the device is not found
 */
export async function getDeviceById(deviceId: string): Promise<LocalDevice> {
  const device = await db.devices
    .where('device_id')
    .equals(deviceId)
    .first();

  if (!device) {
    throw new Error("Device not found in local database");
  }

  return device;
}