import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";
import {
  __getConnectionPoolSizeForTests,
  __resetConnectionPoolForTests,
} from "../src/connectionPool.ts";
import { __resetSuspenseResourcesForTests } from "../src/useStellarEventSuspense.ts";
import { useStellarEventSuspense } from "../src/index.ts";
import type { UseEventConfig } from "../src/index.ts";

class MockEventSource {
  static instances: MockEventSource[] = [];
  static failureUrl: string | undefined;

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closeCount = 0;

  constructor(readonly url: string) {
    if (url === MockEventSource.failureUrl) throw new Error("EventSource unavailable");
    MockEventSource.instances.push(this);
  }

  close(): void {
    this.closeCount += 1;
  }

  emit(event: unknown): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

class TestErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {}

  render(): ReactNode {
    return this.state.error ? (
      <div data-testid="error">{this.state.error.message}</div>
    ) : (
      this.props.children
    );
  }
}

function makeEvent(type: string): NormalizedEvent {
  return { type, timestamp: "2026-04-27T00:00:00.000Z" } as NormalizedEvent;
}

function EventView({ config }: { config: UseEventConfig }): ReactNode {
  const event = useStellarEventSuspense(config);
  return <div data-testid="event">{event.type}</div>;
}

function renderSuspense(config: UseEventConfig): ReturnType<typeof render> {
  return render(
    <TestErrorBoundary>
      <Suspense fallback={<div data-testid="fallback">Waiting</div>}>
        <EventView config={config} />
      </Suspense>
    </TestErrorBoundary>,
  );
}

let originalEventSource: typeof globalThis.EventSource;

beforeEach(() => {
  originalEventSource = globalThis.EventSource;
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  MockEventSource.instances = [];
  MockEventSource.failureUrl = undefined;
  __resetSuspenseResourcesForTests();
  __resetConnectionPoolForTests();
});

afterEach(() => {
  cleanup();
  __resetSuspenseResourcesForTests();
  __resetConnectionPoolForTests();
  globalThis.EventSource = originalEventSource;
  vi.useRealTimers();
});

describe("useStellarEventSuspense", () => {
  it("suspends until the first event and resolves with the event", async () => {
    const config = {
      serverUrl: "https://suspense-first.example.com",
      address: "GFIRST",
    } satisfies UseEventConfig;

    renderSuspense(config);

    expect(screen.getByTestId("fallback")).toBeTruthy();
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toBe(
      "https://suspense-first.example.com/events/GFIRST",
    );

    act(() => MockEventSource.instances[0]?.emit(makeEvent("payment.received")));

    await expect(screen.findByTestId("event")).resolves.toBeTruthy();
    expect(screen.getByTestId("event").textContent).toBe("payment.received");
    expect(screen.queryByTestId("fallback")).toBeNull();

    act(() => MockEventSource.instances[0]?.emit(makeEvent("account.created")));
    expect(screen.getByTestId("event").textContent).toBe("payment.received");
  });

  it("ignores nonmatching and malformed events before resolving", async () => {
    const config = {
      serverUrl: "https://suspense-filter.example.com",
      address: "GFILTER",
      event: ["payment.received", "account.created"],
    } satisfies UseEventConfig;

    renderSuspense(config);

    act(() => MockEventSource.instances[0]?.emit(makeEvent("payment.sent")));
    expect(screen.getByTestId("fallback")).toBeTruthy();

    act(() => MockEventSource.instances[0]?.onmessage?.({ data: "not-json" }));
    expect(screen.getByTestId("fallback")).toBeTruthy();

    act(() => MockEventSource.instances[0]?.emit(makeEvent("account.created")));

    await expect(screen.findByTestId("event")).resolves.toBeTruthy();
    expect(screen.getByTestId("event").textContent).toBe("account.created");
  });

  it("forwards tokens and accepts the config overload", async () => {
    const config = {
      serverUrl: "https://suspense-token.example.com",
      address: "GTOKEN",
      event: "payment.received",
      token: "token with spaces",
    } satisfies UseEventConfig;

    renderSuspense(config);

    expect(MockEventSource.instances[0]?.url).toBe(
      "https://suspense-token.example.com/events/GTOKEN?token=token%20with%20spaces",
    );

    act(() => MockEventSource.instances[0]?.emit(makeEvent("payment.received")));

    await expect(screen.findByTestId("event")).resolves.toBeTruthy();
  });

  it("propagates connection construction errors to an error boundary", () => {
    MockEventSource.failureUrl = "https://suspense-error.example.com/events/GERROR";

    renderSuspense({
      serverUrl: "https://suspense-error.example.com",
      address: "GERROR",
    });

    expect(screen.getByTestId("error").textContent).toBe("EventSource unavailable");
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("keeps the connection until the suspended consumer unmounts", async () => {
    const view = renderSuspense({
      serverUrl: "https://suspense-cleanup.example.com",
      address: "GCLEANUP",
    });

    expect(__getConnectionPoolSizeForTests()).toBe(1);
    act(() => MockEventSource.instances[0]?.emit(makeEvent("account.created")));
    await screen.findByTestId("event");

    view.unmount();

    expect(MockEventSource.instances[0]?.closeCount).toBe(1);
    expect(__getConnectionPoolSizeForTests()).toBe(0);
  });

  it("keeps the shared connection open until the last consumer unmounts", async () => {
    const config = {
      serverUrl: "https://suspense-shared.example.com",
      address: "GSHARED",
    } satisfies UseEventConfig;

    const first = renderSuspense(config);
    const second = renderSuspense(config);

    expect(MockEventSource.instances).toHaveLength(1);
    act(() => MockEventSource.instances[0]?.emit(makeEvent("payment.received")));
    await vi.waitFor(() => expect(screen.getAllByTestId("event")).toHaveLength(2));

    first.unmount();
    expect(MockEventSource.instances[0]?.closeCount).toBe(0);
    expect(__getConnectionPoolSizeForTests()).toBe(1);

    second.unmount();
    expect(MockEventSource.instances[0]?.closeCount).toBe(1);
    expect(__getConnectionPoolSizeForTests()).toBe(0);
  });

  it("handles open and connection error callbacks without resolving", () => {
    const config = {
      serverUrl: "https://suspense-errors.example.com",
      address: "GERRORS",
      event: "payment.received",
    } satisfies UseEventConfig;

    renderSuspense(config);

    act(() => MockEventSource.instances[0]?.onopen?.());
    act(() => MockEventSource.instances[0]?.onerror?.());

    expect(screen.getByTestId("fallback")).toBeTruthy();
  });

  it("releases the connection when a suspended render is abandoned before commit", () => {
    vi.useFakeTimers();

    renderSuspense({
      serverUrl: "https://suspense-abandoned.example.com",
      address: "GABANDONED",
    });

    expect(__getConnectionPoolSizeForTests()).toBe(1);
    expect(MockEventSource.instances[0]?.closeCount).toBe(0);

    // No event ever arrives, so the component stays suspended and never
    // commits - no effect, so no effect cleanup. The resource must still stop
    // holding the connection open.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(MockEventSource.instances[0]?.closeCount).toBe(1);
    expect(__getConnectionPoolSizeForTests()).toBe(0);
  });

  it("keeps the connection past the abandoned-render window once a consumer commits", async () => {
    vi.useFakeTimers();

    renderSuspense({
      serverUrl: "https://suspense-committed.example.com",
      address: "GCOMMITTED",
    });

    act(() => MockEventSource.instances[0]?.emit(makeEvent("payment.received")));
    await vi.waitFor(() => expect(screen.getByTestId("event")).toBeTruthy());

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(MockEventSource.instances[0]?.closeCount).toBe(0);
    expect(__getConnectionPoolSizeForTests()).toBe(1);
  });
});
