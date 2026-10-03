import { render, act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  PulseNotifyDevtools,
  listConnections,
  registerConnection,
  subscribe,
  unregisterConnection,
  updateConnection,
} from "../src/devtools.tsx";

const base = {
  serverUrl: "https://events.example.com",
  address: "GABC",
  url: "https://events.example.com/stream",
  connected: true,
  error: null as string | null,
};

afterEach(() => {
  for (const conn of listConnections()) unregisterConnection(conn.id);
  vi.unstubAllEnvs();
  cleanup();
});

describe("devtools connection registry", () => {
  test("registerConnection returns an id and stores defaults", () => {
    const id = registerConnection({ ...base });
    expect(typeof id).toBe("string");
    expect(id).toContain(base.serverUrl);
    expect(id).toContain(base.address);

    const [conn] = listConnections();
    expect(conn).toMatchObject({
      id,
      serverUrl: base.serverUrl,
      address: base.address,
      url: base.url,
      connected: true,
      error: null,
      lastEvent: null,
    });
  });

  test("registerConnection respects an explicit id and coerces connected", () => {
    const id = registerConnection({ ...base, id: "custom-id", connected: false });
    expect(id).toBe("custom-id");
    expect(listConnections()[0]).toMatchObject({ id: "custom-id", connected: false });
  });

  test("listConnections sorts by address", () => {
    registerConnection({ ...base, id: "b", address: "GBBB" });
    registerConnection({ ...base, id: "a", address: "GAAA" });
    expect(listConnections().map((c) => c.address)).toEqual(["GAAA", "GBBB"]);
  });

  test("updateConnection patches fields and ignores unknown ids", () => {
    const id = registerConnection({ ...base });
    const now = Date.now();
    updateConnection(id, { connected: false, error: "boom", lastEvent: now });
    expect(listConnections()[0]).toMatchObject({
      connected: false,
      error: "boom",
      lastEvent: now,
    });
    expect(() => updateConnection("nope", { connected: true })).not.toThrow();
  });

  test("unregisterConnection removes the entry", () => {
    const id = registerConnection({ ...base });
    unregisterConnection(id);
    expect(listConnections()).toEqual([]);
    expect(() => unregisterConnection(id)).not.toThrow();
  });
});

describe("devtools subscribe notifications", () => {
  test("notifies on register, update, and unregister; stops after unsubscribe", () => {
    let calls = 0;
    const unsub = subscribe(() => {
      calls++;
    });

    let id = "";
    act(() => {
      id = registerConnection({ ...base });
    });
    expect(calls).toBe(1);
    act(() => updateConnection(id, { connected: false }));
    expect(calls).toBe(2);
    act(() => unregisterConnection(id));
    expect(calls).toBe(3);

    unsub();
    act(() => registerConnection({ ...base, id: "after-unsub" }));
    expect(calls).toBe(3);
  });

  test("unregister of an unknown id does not notify", () => {
    let calls = 0;
    const unsub = subscribe(() => {
      calls++;
    });
    unregisterConnection("missing");
    expect(calls).toBe(0);
    unsub();
  });
});

describe("PulseNotifyDevtools component", () => {
  test("shows the empty state and live connection rows", () => {
    const { container, getByText, queryByText } = render(<PulseNotifyDevtools />);
    expect(getByText("No active connections")).toBeTruthy();

    act(() => registerConnection({ ...base, id: "row-1" }));
    expect(container.textContent).toContain("GABC");
    expect(container.textContent).toContain("https://events.example.com/stream");
    expect(queryByText("No active connections")).toBeNull();

    act(() => updateConnection("row-1", { error: "stale", lastEvent: 1700000000000 }));
    expect(container.textContent).toContain("stale");

    act(() => unregisterConnection("row-1"));
    expect(getByText("No active connections")).toBeTruthy();
  });

  test("renders null in production builds", () => {
    vi.stubEnv("NODE_ENV", "production");
    const { container } = render(<PulseNotifyDevtools />);
    expect(container.innerHTML).toBe("");
  });
});
