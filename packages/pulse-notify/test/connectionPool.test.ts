import { beforeAll, afterAll, beforeEach, describe, test, vi } from "vitest";
import assert from "node:assert/strict";
import {
  __getConnectionPoolSizeForTests,
  __resetConnectionPoolForTests,
  acquireEventConnection,
  acquireContractEventConnection,
} from "../src/connectionPool.ts";
import type { ConnectionSubscriber } from "../src/connectionTypes.ts";
import { listConnections } from "../src/devtools.tsx";

type EventSourceMessageHandler = (message: { data: string; lastEventId?: string }) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: (() => void) | null = null;
  onmessage: EventSourceMessageHandler | null = null;
  onerror: (() => void) | null = null;
  closeCount = 0;

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closeCount += 1;
  }
}

let originalEventSource: typeof globalThis.EventSource;

beforeAll(() => {
  originalEventSource = globalThis.EventSource;
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
});

afterAll(() => {
  globalThis.EventSource = originalEventSource;
});

beforeEach(() => {
  __resetConnectionPoolForTests();
  MockEventSource.instances = [];
});

describe("connectionPool", () => {
  test("shares a single EventSource for identical connection keys", () => {
    const eventsA: string[] = [];
    const eventsB: string[] = [];

    const a = acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
      {
        onOpen: () => undefined,
        onEvent: (event) => eventsA.push(event.type),
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    const b = acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
      {
        onOpen: () => undefined,
        onEvent: (event) => eventsB.push(event.type),
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    assert.equal(MockEventSource.instances.length, 1);
    assert.equal(__getConnectionPoolSizeForTests(), 1);
    assert.equal(a.connected, false);
    assert.equal(b.connected, false);

    MockEventSource.instances[0]?.onopen?.();
    assert.equal(a.connected, true);
    assert.equal(b.connected, true);

    MockEventSource.instances[0]?.onmessage?.({
      data: JSON.stringify({ type: "payment.received" }),
    });

    assert.deepEqual(eventsA, ["payment.received"]);
    assert.deepEqual(eventsB, ["payment.received"]);
  });

  test("closes connection only after last subscriber unsubscribes", () => {
    const a = acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
      {
        onOpen: () => undefined,
        onEvent: () => undefined,
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    const b = acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
      {
        onOpen: () => undefined,
        onEvent: () => undefined,
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    a.unsubscribe();
    assert.equal(MockEventSource.instances[0]?.closeCount, 0);
    assert.equal(__getConnectionPoolSizeForTests(), 1);

    b.unsubscribe();
    assert.equal(MockEventSource.instances[0]?.closeCount, 1);
    assert.equal(__getConnectionPoolSizeForTests(), 0);
  });

  test("uses separate connections for different tokens", () => {
    acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GABC" },
      {
        onOpen: () => undefined,
        onEvent: () => undefined,
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GABC", token: "secret" },
      {
        onOpen: () => undefined,
        onEvent: () => undefined,
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    assert.equal(MockEventSource.instances.length, 2);
    assert.equal(__getConnectionPoolSizeForTests(), 2);
  });
});

describe("acquireContractEventConnection", () => {
  test("shares a single EventSource for identical contract connection keys", () => {
    const eventsA: string[] = [];
    const eventsB: string[] = [];

    const a = acquireContractEventConnection(
      {
        serverUrl: "https://events.example.com",
        contractId: "C123",
        topics: ["transfer"],
        token: "secret",
      },
      {
        onOpen: () => undefined,
        onEvent: (event) => eventsA.push(event.type),
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    const b = acquireContractEventConnection(
      {
        serverUrl: "https://events.example.com",
        contractId: "C123",
        topics: ["transfer"],
        token: "secret",
      },
      {
        onOpen: () => undefined,
        onEvent: (event) => eventsB.push(event.type),
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    assert.equal(MockEventSource.instances.length, 1);
    assert.equal(__getConnectionPoolSizeForTests(), 1);
    assert.equal(a.connected, false);
    assert.equal(b.connected, false);

    MockEventSource.instances[0]?.onopen?.();
    assert.equal(a.connected, true);
    assert.equal(b.connected, true);

    MockEventSource.instances[0]?.onmessage?.({
      data: JSON.stringify({ type: "contract.emitted", topics: ["transfer"], data: "test" }),
    });

    assert.deepEqual(eventsA, ["contract.emitted"]);
    assert.deepEqual(eventsB, ["contract.emitted"]);
  });

  test("uses separate connections for different contract topics", () => {
    acquireContractEventConnection(
      { serverUrl: "https://events.example.com", contractId: "C123", topics: ["transfer"] },
      {
        onOpen: () => undefined,
        onEvent: () => undefined,
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    acquireContractEventConnection(
      { serverUrl: "https://events.example.com", contractId: "C123", topics: ["mint"] },
      {
        onOpen: () => undefined,
        onEvent: () => undefined,
        onParseError: () => undefined,
        onError: () => undefined,
      },
    );

    assert.equal(MockEventSource.instances.length, 2);
    assert.equal(__getConnectionPoolSizeForTests(), 2);
  });
});

describe("connectionPool message handling", () => {
  const key = { serverUrl: "https://events.example.com", address: "GMSG" };

  function recorder(overrides: Partial<ConnectionSubscriber> = {}) {
    const calls = {
      onOpen: 0,
      events: [] as unknown[],
      ids: [] as string[],
      onParseError: 0,
      onError: 0,
      onAuthExpired: 0,
    };
    const subscriber: ConnectionSubscriber = {
      onOpen: () => {
        calls.onOpen += 1;
      },
      onEvent: (event) => {
        calls.events.push(event);
      },
      onParseError: () => {
        calls.onParseError += 1;
      },
      onError: () => {
        calls.onError += 1;
      },
      onAuthExpired: () => {
        calls.onAuthExpired += 1;
      },
      onEventId: (id) => {
        calls.ids.push(id);
      },
      ...overrides,
    };
    return { calls, subscriber };
  }

  test("marks the connection open and notifies subscribers", () => {
    const { calls, subscriber } = recorder();
    const conn = acquireEventConnection(key, subscriber);

    assert.equal(conn.connected, false);
    MockEventSource.instances[0]?.onopen?.();

    assert.equal(conn.connected, true);
    assert.equal(calls.onOpen, 1);
  });

  test("delivers parsed events and the Last-Event-ID when present", () => {
    const { calls, subscriber } = recorder();
    const conn = acquireEventConnection(key, subscriber);

    MockEventSource.instances[0]?.onmessage?.({
      data: JSON.stringify({ type: "payment.received", amount: "1" }),
      lastEventId: "evt-1",
    });

    assert.equal(calls.events.length, 1);
    assert.deepEqual(calls.ids, ["evt-1"]);

    // A message without an id must not invoke onEventId.
    MockEventSource.instances[0]?.onmessage?.({
      data: JSON.stringify({ type: "account.created" }),
    });

    assert.equal(calls.events.length, 2);
    assert.deepEqual(calls.ids, ["evt-1"]);
    assert.equal(conn.connected, false);
  });

  test("routes auth_expired payloads to onAuthExpired instead of onEvent", () => {
    const { calls, subscriber } = recorder();
    const conn = acquireEventConnection(key, subscriber);
    MockEventSource.instances[0]?.onopen?.();

    MockEventSource.instances[0]?.onmessage?.({
      data: JSON.stringify({ type: "auth_expired" }),
    });

    assert.equal(calls.onAuthExpired, 1);
    assert.equal(calls.events.length, 0);
    assert.equal(conn.connected, false);
  });

  test("tolerates subscribers without the optional callbacks", () => {
    const minimal: ConnectionSubscriber = {
      onOpen: () => undefined,
      onEvent: () => undefined,
      onParseError: () => undefined,
      onError: () => undefined,
    };
    const conn = acquireEventConnection(key, minimal);

    MockEventSource.instances[0]?.onmessage?.({
      data: JSON.stringify({ type: "x" }),
      lastEventId: "i",
    });
    MockEventSource.instances[0]?.onmessage?.({ data: JSON.stringify({ type: "auth_expired" }) });

    assert.equal(MockEventSource.instances.length, 1);
    conn.unsubscribe();
  });

  test("routes malformed payloads to onParseError", () => {
    const { calls, subscriber } = recorder();
    acquireEventConnection(key, subscriber);

    MockEventSource.instances[0]?.onmessage?.({ data: "not-json" });

    assert.equal(calls.onParseError, 1);
    assert.equal(calls.events.length, 0);
  });

  test("routes transport errors to onError and marks the entry disconnected", () => {
    const { calls, subscriber } = recorder();
    const conn = acquireEventConnection(key, subscriber);
    MockEventSource.instances[0]?.onopen?.();

    MockEventSource.instances[0]?.onerror?.();

    assert.equal(calls.onError, 1);
    assert.equal(conn.connected, false);
  });

  test("fans a single message out to every subscriber on the shared entry", () => {
    const a = recorder();
    const b = recorder();
    acquireEventConnection(key, a.subscriber);
    acquireEventConnection(key, b.subscriber);

    assert.equal(MockEventSource.instances.length, 1);
    MockEventSource.instances[0]?.onmessage?.({ data: JSON.stringify({ type: "shared" }) });

    assert.equal(a.calls.events.length, 1);
    assert.equal(b.calls.events.length, 1);
  });
});

describe("connectionPool key building", () => {
  const sub: ConnectionSubscriber = {
    onOpen: () => undefined,
    onEvent: () => undefined,
    onParseError: () => undefined,
    onError: () => undefined,
  };

  test("passes withCredentials through to the EventSource constructor", () => {
    acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GCRED", withCredentials: true },
      sub,
    );
    acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GCRED", withCredentials: false },
      sub,
    );

    assert.deepEqual(MockEventSource.instances[0]?.init, { withCredentials: true });
    assert.equal(MockEventSource.instances[1]?.init, undefined);
    // The credential flag participates in the pool key.
    assert.equal(MockEventSource.instances.length, 2);
  });

  test("encodes a token into the address URL", () => {
    acquireEventConnection(
      { serverUrl: "https://events.example.com", address: "GTOK", token: "a b/c" },
      sub,
    );

    assert.equal(
      MockEventSource.instances[0]?.url,
      "https://events.example.com/events/GTOK?token=a%20b%2Fc",
    );
  });

  test("builds a contract URL with both topics and token", () => {
    acquireContractEventConnection(
      {
        serverUrl: "https://events.example.com",
        contractId: "CURL",
        topics: ["transfer", "mint"],
        token: "t k",
      },
      sub,
    );

    assert.equal(
      MockEventSource.instances[0]?.url,
      "https://events.example.com/contract_events/CURL?topics=transfer%2Cmint&token=t%20k",
    );
  });

  test("omits the query string when a contract has no topics or token", () => {
    acquireContractEventConnection(
      { serverUrl: "https://events.example.com", contractId: "CBARE" },
      sub,
    );
    acquireContractEventConnection(
      { serverUrl: "https://events.example.com", contractId: "CEMPTY", topics: [] },
      sub,
    );

    assert.equal(
      MockEventSource.instances[0]?.url,
      "https://events.example.com/contract_events/CBARE",
    );
    assert.equal(
      MockEventSource.instances[1]?.url,
      "https://events.example.com/contract_events/CEMPTY",
    );
  });

  test("gives topic order and withCredentials independent contract keys", () => {
    // Same topics in a different order must share one connection.
    acquireContractEventConnection(
      { serverUrl: "https://events.example.com", contractId: "CORD", topics: ["b", "a"] },
      sub,
    );
    acquireContractEventConnection(
      { serverUrl: "https://events.example.com", contractId: "CORD", topics: ["a", "b"] },
      sub,
    );
    assert.equal(MockEventSource.instances.length, 1);

    // withCredentials must split the key.
    acquireContractEventConnection(
      {
        serverUrl: "https://events.example.com",
        contractId: "CORD",
        topics: ["a", "b"],
        withCredentials: true,
      },
      sub,
    );
    assert.equal(MockEventSource.instances.length, 2);
  });
});

describe("connectionPool devtools instrumentation", () => {
  test("registers, updates and unregisters a devtools entry in development", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const noop: ConnectionSubscriber = {
      onOpen: () => undefined,
      onEvent: () => undefined,
      onParseError: () => undefined,
      onError: () => undefined,
    };

    const conn = acquireEventConnection(
      { serverUrl: "https://dev.example.com", address: "GDEV" },
      noop,
    );

    // The devtools module is imported lazily, so registration lands a tick later.
    await vi.waitFor(() => {
      assert.equal(listConnections().length, 1);
    });

    const [registered] = listConnections();
    assert.equal(registered.url, "https://dev.example.com/events/GDEV");
    assert.equal(registered.address, "GDEV");
    assert.equal(registered.connected, false);
    assert.equal(registered.error, null);

    MockEventSource.instances[0]?.onopen?.();
    assert.equal(listConnections()[0]?.connected, true);

    MockEventSource.instances[0]?.onmessage?.({ data: JSON.stringify({ type: "tick" }) });
    assert.notEqual(listConnections()[0]?.lastEvent, null);

    MockEventSource.instances[0]?.onmessage?.({
      data: JSON.stringify({ type: "auth_expired" }),
    });
    assert.equal(listConnections()[0]?.error, "Token expired");

    MockEventSource.instances[0]?.onerror?.();
    assert.equal(listConnections()[0]?.error, "Connection lost - retrying...");

    conn.unsubscribe();
    assert.equal(listConnections().length, 0);

    vi.unstubAllEnvs();
  });

  test("skips devtools registration outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const noop: ConnectionSubscriber = {
      onOpen: () => undefined,
      onEvent: () => undefined,
      onParseError: () => undefined,
      onError: () => undefined,
    };
    const conn = acquireEventConnection(
      { serverUrl: "https://prod.example.com", address: "GPROD" },
      noop,
    );

    MockEventSource.instances[0]?.onopen?.();
    MockEventSource.instances[0]?.onmessage?.({ data: JSON.stringify({ type: "x" }) });

    assert.equal(listConnections().length, 0);
    conn.unsubscribe();
    vi.unstubAllEnvs();
  });
});
