# Architecture: Client-Side Device Communication

## Overview

The evolver-ui supports two deployment modes:
1. **Airgapped/Offline** - UI runs locally, communicates directly with evolver devices on local network
2. **Hosted** - UI hosted on a server, still communicates directly with evolver devices, but with cloud services (user logins, config sharing, remote experiments, org support, etc.)

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────┐ │
│  │  IndexedDB   │     │   React      │     │  Evolver Client  │ │
│  │  (localDb)   │────▶│   Router     │────▶│  (fetch API)     │ │
│  │              │     │  clientLoader│     │                  │ │
│  └──────────────┘     └──────────────┘     └────────┬─────────┘ │
│         │                                           │           │
└─────────┼───────────────────────────────────────────┼───────────┘
          │                                           │
          ▼                                           ▼
┌──────────────────┐                      ┌──────────────────────┐
│   Node Server    │                      │   Evolver Device(s)  │
│   (optional)     │                      │   (127.0.0.1:8080)   │
│                  │                      │                      │
│  - Prisma DB     │                      │  - /healthz          │
│  - Device list   │                      │  - /hardware/{name}  │
│    sync          │                      │  - /describe         │
│                  │                      │  - etc.              │
└──────────────────┘                      └──────────────────────┘
```

## Key Principles

### 1. IndexedDB for Device Registry Only
- Stores list of known device URLs (like OS Bluetooth paired devices)
- Syncs with server when available
- Does NOT cache device state/data

### 2. Browser → Evolver Direct Communication
- All device API calls (state, hardware, calibration) go directly from browser to device
- Uses `@hey-api/client-fetch` generated client
- Requires CORS enabled on evolver-ng

### 3. React Router Pattern
```tsx
// clientLoader fetches from local DB + evolver device
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  // 1. Get device URL from IndexedDB
  const device = await getDeviceById(params.id!);

  // 2. Create client for direct evolver communication
  const evolverClient = createEvolverClient(device.url);

  // 3. Fetch data from evolver (browser → device)
  const data = await Evolver.someEndpoint({ client: evolverClient });

  return { device, ...data };
}
clientLoader.hydrate = true;

export function HydrateFallback() {
  return <LoadingSkeleton />;
}
```

## Files

| File | Purpose |
|------|---------|
| `app/utils/localDb.client.ts` | IndexedDB schema (Dexie) |
| `app/utils/getDeviceById.client.ts` | Get device from IndexedDB |
| `app/utils/evolverClient.client.ts` | Create evolver API client |
| `app/utils/pingDevice.client.ts` | Ping device from browser |
| `app/routes/devices.list.tsx` | Device list (uses clientLoader + client pings) |
| `app/routes/devices.$id.$name.*.tsx` | Device routes (use clientLoader → evolver) |

## Server Role (Optional)

The Node server is optional and provides:
- Persistent device list storage (Prisma/SQLite)
- Sync across sessions/devices
- Future: user auth, sharing

When server unavailable, app works fully offline using IndexedDB.
