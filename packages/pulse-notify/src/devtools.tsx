import React, { useEffect, useState } from "react";

/**
 * A single connection tracked by the devtools registry: which server and
 * address it watches, whether it is connected, the last error, and when the
 * last event arrived (`lastEvent`, epoch ms, `null` when none has).
 */
export type DevConnection = {
  id: string;
  serverUrl: string;
  address: string;
  url: string;
  connected: boolean;
  error: string | null;
  lastEvent: number | null;
};

const connections = new Map<string, DevConnection>();
const events = new EventTarget();

function emit() {
  events.dispatchEvent(new CustomEvent("pulse-notify:change"));
}

/**
 * Registers a connection in the devtools registry and notifies subscribers.
 *
 * @param info - Connection fields; `id` is generated from
 *               `serverUrl`/`address` plus a random suffix when omitted, and
 *               `lastEvent` always starts as `null`.
 * @returns The connection id to pass to `updateConnection` /
 *          `unregisterConnection`.
 */
export function registerConnection(
  info: Omit<DevConnection, "id" | "lastEvent"> & { id?: string },
) {
  const id =
    info.id ?? `${info.serverUrl}::${info.address}::${Math.random().toString(36).slice(2, 9)}`;
  const conn: DevConnection = {
    id,
    serverUrl: info.serverUrl,
    address: info.address,
    url: info.url,
    connected: Boolean(info.connected),
    error: info.error ?? null,
    lastEvent: null,
  };
  connections.set(id, conn);
  emit();
  return id;
}

/**
 * Patches a registered connection and notifies subscribers. Unknown ids are
 * ignored. `id`, `serverUrl`, `address`, and `url` cannot be patched.
 *
 * @param id    - Connection id returned by `registerConnection`.
 * @param patch - Partial connection fields to merge over the current entry.
 */
export function updateConnection(
  id: string,
  patch: Partial<
    Omit<DevConnection, "id" | "serverUrl" | "address" | "url"> & { lastEvent?: number }
  >,
) {
  const cur = connections.get(id);
  if (!cur) return;
  const next: DevConnection = { ...cur, ...patch } as DevConnection;
  connections.set(id, next);
  emit();
}

/**
 * Removes a connection from the devtools registry. Notifies subscribers only
 * when an entry was actually removed.
 *
 * @param id - Connection id returned by `registerConnection`.
 */
export function unregisterConnection(id: string) {
  if (connections.delete(id)) emit();
}

/**
 * Returns a snapshot of the registered connections, sorted by address.
 *
 * @returns The current `DevConnection` entries (a new array each call).
 */
export function listConnections(): DevConnection[] {
  return Array.from(connections.values()).sort((a, b) => a.address.localeCompare(b.address));
}

/**
 * Subscribes to registry changes (register/update/unregister).
 *
 * @param fn - Called with no arguments after every change.
 * @returns An unsubscribe function that removes the listener.
 */
export function subscribe(fn: () => void) {
  const handler = () => fn();
  events.addEventListener("pulse-notify:change", handler as EventListener);
  return () => events.removeEventListener("pulse-notify:change", handler as EventListener);
}

/**
 * Development-only panel listing the active devtools connections. Renders
 * `null` in production builds and outside the browser; safe to mount
 * unconditionally in development.
 *
 * @returns The connections panel element, or `null` when it should not render.
 */
export function PulseNotifyDevtools(): React.ReactElement | null {
  const [state, setState] = useState<DevConnection[]>(() => listConnections());

  useEffect(() => {
    const unsub = subscribe(() => setState(listConnections()));
    return unsub;
  }, []);

  // Only render in development and in the browser. The hooks above run
  // unconditionally so hook order stays stable across renders.
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;

  return (
    <div style={{ padding: 12, fontFamily: "Inter, system-ui, sans-serif", fontSize: 12 }}>
      <h3 style={{ margin: "0 0 8px 0" }}>Pulse Notify - Active Connections</h3>
      <div
        style={{
          maxHeight: 360,
          overflow: "auto",
          border: "1px solid #eee",
          padding: 8,
          borderRadius: 6,
        }}
      >
        {state.length === 0 && <div style={{ color: "#666" }}>No active connections</div>}
        {state.map((c) => (
          <div key={c.id} style={{ padding: 8, borderBottom: "1px dashed #f0f0f0" }}>
            <div>
              <strong>Address:</strong> {c.address}
            </div>
            <div>
              <strong>URL:</strong> {c.url}
            </div>
            <div>
              <strong>Connected:</strong> {c.connected ? "yes" : "no"}{" "}
              {c.error ? ` - ${c.error}` : ""}
            </div>
            <div>
              <strong>Last event:</strong>{" "}
              {c.lastEvent ? new Date(c.lastEvent).toLocaleString() : "-"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Default export of {@link PulseNotifyDevtools} for lazy/dev entry points. */
export default PulseNotifyDevtools;
