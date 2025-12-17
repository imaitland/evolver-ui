import {
  data,
  Link,
  useLoaderData,
  useParams,
  useRouteLoaderData,
} from "react-router";
import * as Evolver from "client/services.gen";
import { FilterableVialGrid } from "~/components/VialGrid";
import { createEvolverClient } from "~/utils/evolverClient.client";
import { deviceInfo } from "~/cookies.server";
import { ROUTES } from "~/utils/routes";
import type { Route } from "./+types/devices.$id.$name.state";
import { DefaultHydrateFallback } from "~/components/HydrateFallback";
import { getDeviceById } from "~/utils/evolverClient.server";
import { getDeviceById as getLocalDeviceById } from "~/utils/getDeviceById.client";
import { db as localDb } from "~/utils/localDb.client";
import { DefaultErrorBoundary } from "~/components/DefaultErrorBoundary";

// TODO: don't do this, i think the evolver config has layout dims.
const VIAL_COUNT = 16;

export const handle = {
  breadcrumb: ({ params }: { params: { id: string; name: string } }) => {
    const { id, name } = params;
    return <Link to={ROUTES.device.state({ id, name })}>state</Link>;
  },
};

export async function loader({ params }: Route.LoaderArgs) {
  const { id } = params;
  const device = await getDeviceById(id);
  return data(
    { device },
    {
      headers: {
        "Set-Cookie": await deviceInfo.serialize(device),
      },
    },
  );
}

export async function clientLoader({ serverLoader, params }: Route.ClientLoaderArgs) {
  let device;
  
  try {
    // Try to get device from server
    const serverData = await serverLoader();
    device = serverData.device;
    
    // Sync to local database
    const existing = await localDb.devices
      .where('device_id')
      .equals(device.device_id)
      .first();
      
    if (!existing) {
      await localDb.devices.add({
        ...device,
        syncStatus: 'synced',
        lastSyncAt: new Date(),
      });
    } else {
      await localDb.devices.update(existing.id!, {
        url: device.url,
        name: device.name,
        updatedAt: new Date(),
        syncStatus: 'synced',
        lastSyncAt: new Date(),
      });
    }
  } catch (error) {
    // Server unavailable, use local data
    console.warn('Server unavailable, using local device data:', error);
    device = await getLocalDeviceById(params.id);
  }

  const evolverClient = createEvolverClient(device.url);

  const [describeEvolver, evolverState] = await Promise.all([
    Evolver.describe({ client: evolverClient }),
    Evolver.state({ client: evolverClient }),
  ]);

  return {
    vials: describeEvolver?.data?.config?.vials,
    evolverState: evolverState.data,
  };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <DefaultHydrateFallback />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <DefaultErrorBoundary
      error={error}
      title="Error loading device state"
      subtitle="Unable to load the device state. Please ensure the device is online and try again."
    />
  );
}

export default function Hardware() {
  const { id } = useParams<Route.LoaderArgs["params"]>();
  const { evolverState } = useLoaderData<typeof clientLoader>();

  const {
    ENV: { EXCLUDED_PROPERTIES },
  } = useRouteLoaderData("root");

  const excludedProperties = EXCLUDED_PROPERTIES?.split(",") ?? [];

  return (
    <div className="p-4 bg-base-300 rounded-box relative overflow-x-auto">
      <FilterableVialGrid
        stateData={evolverState?.state ?? {}}
        id={id ?? ""}
        vialCount={VIAL_COUNT}
        excludedProperties={excludedProperties}
      />
    </div>
  );
}
