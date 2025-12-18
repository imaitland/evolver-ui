import { z } from "zod";
import { type ActionFunctionArgs, redirect, data } from "react-router";
import type { Route } from "./+types/devices.list";
import { parseWithZod } from "@conform-to/zod";
import { pingDevice } from "~/utils/pingDevice.server";
import { db } from "~/utils/db.server";
import { Prisma } from "@prisma/client";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useSubmit,
} from "react-router";
import { ROUTES } from "~/utils/routes";
import clsx from "clsx";
import { CloudIcon } from "@heroicons/react/24/outline";
import { generateDeviceId } from "~/utils/generateDeviceId";
import { toast as notify } from "react-toastify";
import { useEffect, useState } from "react";
import { DefaultErrorBoundary } from "~/components/DefaultErrorBoundary";
import { db as localDb } from "~/utils/localDb.client";
import { useLiveQuery } from "dexie-react-hooks";
import { pingDevice as pingDeviceClient } from "~/utils/pingDevice.client";

const IntentEnum = z.enum(
  ["add_device", "delete_device", "sync_devices", "get_server_side_devices"],
  {
    required_error: "intent is required",
    invalid_type_error:
      "must be one of, add_device, delete_device, sync_devices, or get_server_side_devices",
  },
);

const schema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal(IntentEnum.Enum.add_device),
    url: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url(),
    ),
  }),
  z.object({
    intent: z.literal(IntentEnum.Enum.delete_device),
    id: z.string(),
  }),
  z.object({
    intent: z.literal(IntentEnum.Enum.sync_devices),
  }),
  z.object({
    intent: z.literal(IntentEnum.Enum.get_server_side_devices),
  }),
]);

// This is the server action
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const submission = parseWithZod(formData, { schema });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const { intent } = submission.value;

  let id = "";
  switch (intent) {
    case IntentEnum.Enum.add_device:
      try {
        const { url } = submission.value;
        const { online: isOnline, name } = await pingDevice(url as string);
        if (isOnline) {
          id = await generateDeviceId(url);
          await db.device.create({ data: { url, device_id: id, name } });
        } else {
          throw Error("no evolver detected at that address");
        }
        return redirect(ROUTES.device.state({ id, name }));
      } catch (error) {
        const { url } = submission.value;
        const errorMessages = ["unable to add device"];
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === "P2002") {
            errorMessages.push(`device at ${url} already exists`);
          }
        } else if (error instanceof Error) {
          errorMessages.push(error.message);
        }
        return submission.reply({ formErrors: errorMessages });
      }

    case IntentEnum.Enum.delete_device:
      try {
        const { id } = submission.value;
        await db.device.delete({ where: { device_id: id } });
        return redirect(ROUTES.static.devices);
      } catch (error) {
        const errorMessages = ["unable to delete device"];
        return submission.reply({ formErrors: errorMessages });
      }

    case IntentEnum.Enum.sync_devices: {
      // Return server-side devices for syncing with client
      const devices = await db.device.findMany();
      return { success: true, devices };
    }

    case IntentEnum.Enum.get_server_side_devices: {
      // Return all devices from server database
      const devices = await db.device.findMany();
      return { devices };
    }

    default:
      return null;
  }
}

export const loader = async () => {
  const devices = await db.device.findMany();
  const deviceStatusPromises = devices.map(({ url }) => pingDevice(url));
  const resolved = await Promise.allSettled(deviceStatusPromises);
  const results = resolved.map((result, index) => {
    return {
      name: result.status === "fulfilled" && result.value.name,
      device_id: devices[index].device_id,
      url: devices[index].url,
      createdAt: devices[index].createdAt,
      status:
        result.status === "fulfilled" && result.value.online
          ? "online"
          : "offline",
    };
  });
  return results;
};

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  // Load devices from local IndexedDB
  const localDevices = await localDb.devices.toArray();

  // Ping each device from the client to get real online/offline status
  const deviceStatusPromises = localDevices.map(({ url }) =>
    pingDeviceClient(url)
  );
  const resolved = await Promise.allSettled(deviceStatusPromises);

  // Return devices with real status from client-side pings
  return localDevices.map((device, index) => {
    const result = resolved[index];
    const isOnline =
      result.status === "fulfilled" && result.value.online;
    const name =
      result.status === "fulfilled" && result.value.name !== "unknown"
        ? result.value.name
        : device.name;

    return {
      name,
      device_id: device.device_id,
      url: device.url,
      createdAt: device.createdAt,
      status: isOnline ? ("online" as const) : ("offline" as const),
      syncStatus: device.syncStatus,
    };
  });
}
clientLoader.hydrate = true;

export function HydrateFallback() {
  return (
    <div className="flex flex-col gap-4">
      <div className="skeleton h-10 w-80"></div>
      <div className="bg-base-300 rounded-box p-4">
        <div className="skeleton h-32 w-full"></div>
      </div>
    </div>
  );
}

// clientActions first, conditionally call serverAction if user is signed in and wants to sync with remote db.
export async function clientAction({
  serverAction,
  request,
}: Route.ClientActionArgs) {
  // Clone the request before reading formData so serverAction can still read the original body
  const formData = await request.clone().formData();
  const submission = parseWithZod(formData, { schema });

  if (submission.status !== "success") {
    return submission.reply();
  }

  const { intent } = submission.value;

  switch (intent) {
    case IntentEnum.Enum.add_device: {
      const { url } = submission.value;
      const device_id = await generateDeviceId(url as string);

      // Add to local database immediately
      await localDb.devices.add({
        device_id,
        url: url as string,
        name: "New Device",
        createdAt: new Date(),
        updatedAt: new Date(),
        syncStatus: "pending",
      });

      // Try to sync with server
      try {
        const result = await serverAction();

        // Update local device with server response
        if (result && "error" in result) {
          // Handle server error
          await localDb.devices.where("device_id").equals(device_id).modify({
            syncStatus: "error",
          });
          return result;
        }

        // Server succeeded, mark as synced
        await localDb.devices.where("device_id").equals(device_id).modify({
          syncStatus: "synced",
          lastSyncAt: new Date(),
        });

        return result;
      } catch (error) {
        // Server unavailable, keep as pending
        console.error("Failed to sync with server:", error);
        await localDb.devices.where("device_id").equals(device_id).modify({
          syncStatus: "error",
        });

        // Still redirect to device page (offline mode)
        return redirect(
          ROUTES.device.state({ id: device_id, name: "New Device" }),
        );
      }
    }

    case IntentEnum.Enum.delete_device: {
      const { id } = submission.value;

      // Delete from local database immediately
      await localDb.devices.where("device_id").equals(id).delete();

      // Try to sync with server
      try {
        const result = await serverAction();
        return result;
      } catch (error) {
        // Server unavailable, deletion still succeeded locally
        console.error("Failed to sync deletion with server:", error);
        return redirect(ROUTES.static.devices);
      }
    }

    case IntentEnum.Enum.sync_devices: {
      // Manually sync all devices with server
      try {
        // Sync the data
        await serverAction();

        notify.success("Devices synced successfully");
        return { success: true };
      } catch (error) {
        // Ignore AbortError - this happens when navigation is cancelled (e.g., component unmount, another action started)
        if (error instanceof DOMException && error.name === "AbortError") {
          return { success: false, aborted: true };
        }
        console.error("Manual sync failed:", error);
        notify.error("Failed to sync devices");
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  }
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <DefaultErrorBoundary
      error={error}
      title="Error loading devices"
      subtitle="Unable to load the device list. Please check your connection and try again."
    />
  );
}

export default function DevicesList() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const [syncingDevices, setSyncingDevices] = useState<Set<string>>(new Set());

  // Use live query to reactively update when local DB changes
  const localDevices = useLiveQuery(() => localDb.devices.toArray(), []);

  // Trigger sync on mount
  useEffect(() => {
    const formData = new FormData();
    formData.append("intent", IntentEnum.Enum.sync_devices);
    submit(formData, { method: "post" });
  }, []);

  // Show validation/action errors via toast
  useEffect(() => {
    if (actionData?.error) {
      notify.error(Array.isArray(actionData.error) ? actionData.error.join(", ") : actionData.error);
    }
  }, [actionData]);

  const removeDevice = (id: string) => {
    const formData = new FormData();
    formData.append("id", id);
    formData.append("intent", IntentEnum.Enum.delete_device);
    submit(formData, { method: "delete" });
  };

  const syncDevice = async (device_id: string) => {
    // Add to syncing set
    setSyncingDevices((prev) => new Set(prev).add(device_id));

    try {
      // Get the device from local DB
      const device = await localDb.devices
        .where("device_id")
        .equals(device_id)
        .first();

      if (!device) return;

      // Update status to show syncing
      await localDb.devices.update(device.id!, {
        syncStatus: "pending",
      });

      // Try to ping the device through the server
      const response = await fetch(`/devices/list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          intent: "add_device",
          url: device.url,
        }),
      });

      if (response.ok) {
        // Sync successful
        await localDb.devices.update(device.id!, {
          syncStatus: "synced",
          lastSyncAt: new Date(),
        });
        notify.success("Device synced successfully");
      } else {
        // Sync failed
        await localDb.devices.update(device.id!, {
          syncStatus: "error",
        });
        notify.error("Failed to sync device");
      }
    } catch (error) {
      console.error("Manual sync failed:", error);
      // Update to error status
      const device = await localDb.devices
        .where("device_id")
        .equals(device_id)
        .first();

      if (device) {
        await localDb.devices.update(device.id!, {
          syncStatus: "error",
        });
      }
      notify.error("Failed to sync device - server unavailable");
    } finally {
      // Remove from syncing set
      setSyncingDevices((prev) => {
        const next = new Set(prev);
        next.delete(device_id);
        return next;
      });
    }
  };

  const deviceTableItems = loaderData.map(
    ({ device_id, url, status, createdAt, name }, ix) => {
      // Find sync status from local devices
      const localDevice = localDevices?.find((d) => d.device_id === device_id);
      const syncStatus = localDevice?.syncStatus || "synced";
      console.log(syncStatus);

      return (
        <tr key={device_id}>
          <th>{ix + 1}</th>
          <td>{new Date(createdAt).toDateString()}</td>
          <td>
            {status === "online" ? (
              <Link
                to={ROUTES.device.state({
                  id: device_id,
                  name: name.toString(),
                })}
              >
                <div className="link link-primary">{name}</div>
              </Link>
            ) : (
              <div>{name}</div>
            )}
          </td>
          <td>
            {status === "online" && (
              <a
                className="link"
                href={`${url}/html/network`}
                target="_blank"
                rel="noreferrer"
              >
                {url}
              </a>
            )}
            {status === "offline" && <div className={clsx("")}>{url}</div>}
          </td>
          <td>
            <div
              className={clsx(
                "badge",
                status === "online" && "badge-accent",
                status === "offline" && "badge-ghost badge-outline",
              )}
            >
              {status}
            </div>
          </td>
          <td>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <div className="inline-grid *:[grid-area:1/1]">
                  {syncStatus === "error" && (
                    <div className="status status-error animate-ping"></div>
                  )}
                  <div
                    className={clsx(
                      "status",
                      syncStatus === "synced" && "status-success",
                      syncStatus === "pending" && "status-warning",
                      syncStatus === "error" && "status-error",
                    )}
                  ></div>
                </div>
                <span className="">
                  {syncStatus === "synced" && "synced"}
                  {syncStatus === "pending" && "pending"}
                  {syncStatus === "error" && "error"}
                </span>
              </div>
              {syncStatus !== "synced" && (
                <button
                  className={clsx(
                    "btn btn-xs",
                    syncStatus === "pending" && "btn-warning",
                    syncStatus === "error" && "btn-error",
                  )}
                  onClick={() => syncDevice(device_id)}
                  disabled={syncingDevices.has(device_id)}
                >
                  {syncingDevices.has(device_id) ? (
                    <span className="loading loading-spinner loading-xs"></span>
                  ) : syncStatus === "pending" ? (
                    "sync"
                  ) : (
                    "retry"
                  )}
                </button>
              )}
            </div>
          </td>

          <td>
            <button onClick={() => removeDevice(device_id)}>forget</button>
          </td>
        </tr>
      );
    },
  );

  return (
    <>
      <div className="flex justify-between items-start">
        <Form
          method="POST"
          action="/devices/list"
          className=""
        >
          <input
            name={"intent"}
            value={IntentEnum.Enum.add_device}
            type="hidden"
          />
          <div className="join">
            <div className="flex flex-col">
              <input
                name="url"
                placeholder="url address"
                type="text"
                className="input input-bordered max-w-xs join-item"
              />
            </div>
            <button type="submit" className="btn btn-primary join-item">
              Add
            </button>
          </div>
        </Form>

        {localDevices && localDevices.length > 0 && (
          <button
            className="btn btn-sm"
            onClick={() => {
              const formData = new FormData();
              formData.append("intent", IntentEnum.Enum.sync_devices);
              submit(formData, { method: "post" });
            }}
          >
            Sync All
          </button>
        )}
      </div>
      <div className="bg-base-300 rounded-box p-4">
        {deviceTableItems.length === 0 && (
          <div className="flex flex-col justify-center items-center gap-4">
            <CloudIcon className="w-16 h-16 text-gray-500" />
            <div>
              Enter the url where an instance of the{" "}
              <a
                href="https://github.com/ssec-jhu/evolver-ng"
                className="link link-primary"
                target="_blank"
                rel="noreferrer"
              >
                evolver-ng service
              </a>{" "}
              is running to get started.
            </div>
          </div>
        )}
        {deviceTableItems.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table table-zebra">
              <thead>
                <tr>
                  <th></th>
                  <th>added</th>
                  <th>name</th>
                  <th>url</th>
                  <th>status</th>
                  <th>sync</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>{deviceTableItems}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
