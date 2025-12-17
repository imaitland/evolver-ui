import Dexie, { type EntityTable } from 'dexie';

export interface LocalDevice {
  id?: number;
  createdAt: Date;
  updatedAt: Date;
  url: string;
  device_id: string;
  name: string;
  syncStatus?: 'synced' | 'pending' | 'error';
  lastSyncAt?: Date;
}

const db = new Dexie('EvolverLocalDB') as Dexie & {
  devices: EntityTable<LocalDevice, 'id'>;
};

// Schema declaration
db.version(1).stores({
  devices: '++id, device_id, url, syncStatus'
});

export { db };