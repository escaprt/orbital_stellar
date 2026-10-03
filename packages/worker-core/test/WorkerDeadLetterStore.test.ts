import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryWorkerDeadLetterStore } from "../src/WorkerDeadLetterStore.js";
import type { WorkerDeadLetterInput } from "../src/WorkerDeadLetterStore.js";

function makeInput(overrides: Partial<WorkerDeadLetterInput> = {}): WorkerDeadLetterInput {
  return {
    submissionId: "submission-1",
    error: "RPC timed out",
    attempts: 3,
    failures: [
      { kind: "rpc_timeout", message: "RPC timed out", retryable: true },
      { kind: "rate_limit", message: "Rate limited", retryable: true },
      { kind: "rpc_timeout", message: "RPC timed out", retryable: true },
    ],
    outcome: "max_attempts",
    windowDeadlineMs: 1_800_000,
    miss: true,
    terminalKind: "rpc_timeout",
    failedAt: 1_000,
    metadata: { workerId: "worker-1" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MemoryWorkerDeadLetterStore", () => {
  it("records, retrieves, deletes, and clears entries", async () => {
    const store = new MemoryWorkerDeadLetterStore();
    const input = makeInput();

    const id = await store.record(input);

    expect(id).toMatch(/^wdlq_[0-9a-f-]{36}$/);
    await expect(store.get(id)).resolves.toEqual({
      ...input,
      id,
      timestamp: input.failedAt,
      replayedAt: null,
    });
    await expect(store.get("missing")).resolves.toBeNull();
    expect(store.size()).toBe(1);

    await expect(store.delete(id)).resolves.toBe(true);
    await expect(store.delete(id)).resolves.toBe(false);
    expect(store.size()).toBe(0);

    const secondId = await store.record(makeInput({ failedAt: undefined }));
    expect((await store.get(secondId))?.timestamp).toBe(Date.now());
    store.clear();
    expect(store.size()).toBe(0);
  });

  it("lists entries in timestamp order and applies every filter", async () => {
    const store = new MemoryWorkerDeadLetterStore();
    const latestId = await store.record(
      makeInput({ submissionId: "submission-3", failedAt: 300, terminalKind: "rate_limit" }),
    );
    const firstId = await store.record(
      makeInput({
        submissionId: "submission-1",
        failedAt: 100,
        outcome: "window_expired",
        terminalKind: "rpc_network",
        miss: false,
      }),
    );
    const middleId = await store.record(
      makeInput({
        submissionId: "submission-2",
        failedAt: 200,
        outcome: "terminal",
        terminalKind: "contract_rejection",
      }),
    );
    const secondId = await store.record(
      makeInput({ submissionId: "submission-2", failedAt: 150, terminalKind: "unauthorized" }),
    );

    const all = await store.list();
    expect(all.map((entry) => entry.id)).toEqual([firstId, secondId, middleId, latestId]);

    await expect(store.list({ submissionId: "submission-2" })).resolves.toEqual([
      expect.objectContaining({ id: secondId }),
      expect.objectContaining({ id: middleId }),
    ]);
    await expect(store.list({ outcome: "max_attempts" })).resolves.toEqual([
      expect.objectContaining({ id: secondId }),
      expect.objectContaining({ id: latestId }),
    ]);
    await expect(store.list({ terminalKind: "unauthorized" })).resolves.toEqual([
      expect.objectContaining({ id: secondId }),
    ]);
    await expect(store.list({ miss: false })).resolves.toEqual([
      expect.objectContaining({ id: firstId }),
    ]);
    await expect(store.list({ since: 150 })).resolves.toHaveLength(3);
    await expect(store.list({ until: 200 })).resolves.toHaveLength(3);
    await expect(store.list({ limit: 2 })).resolves.toEqual(
      [firstId, secondId].map((id) => expect.objectContaining({ id })),
    );
    await expect(store.list({ limit: 0 })).resolves.toEqual([]);
  });

  it("replays entries and records the replay time", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const store = new MemoryWorkerDeadLetterStore({ replay: handler });
    const id = await store.record(makeInput());
    const entry = await store.get(id);

    await store.replay(id);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(entry);
    expect((await store.get(id))?.replayedAt).toBe(Date.now());

    await expect(store.replay("missing")).rejects.toThrow(
      "Unknown worker dead-letter entry: missing",
    );
  });

  it("rejects replay until a handler is configured or replaced", async () => {
    const store = new MemoryWorkerDeadLetterStore();
    const id = await store.record(makeInput());

    await expect(store.replay(id)).rejects.toThrow(
      "Worker dead-letter replay handler is not configured",
    );

    const firstHandler = vi.fn().mockResolvedValue(undefined);
    store.setReplayHandler(firstHandler);
    await store.replay(id);
    expect(firstHandler).toHaveBeenCalledOnce();

    const secondHandler = vi.fn().mockResolvedValue(undefined);
    store.setReplayHandler(secondHandler);
    await store.replay(id);
    expect(secondHandler).toHaveBeenCalledOnce();
  });

  it("does not mark failed replays as replayed", async () => {
    const store = new MemoryWorkerDeadLetterStore({
      replay: vi.fn().mockRejectedValue(new Error("replay failed")),
    });
    const id = await store.record(makeInput());

    await expect(store.replay(id)).rejects.toThrow("replay failed");
    expect((await store.get(id))?.replayedAt).toBeNull();
  });

  it("evicts the oldest entries at the configured limit", async () => {
    const store = new MemoryWorkerDeadLetterStore({ maxEntries: 2 });
    const firstId = await store.record(makeInput({ failedAt: 100 }));
    const secondId = await store.record(makeInput({ failedAt: 200 }));
    const thirdId = await store.record(makeInput({ failedAt: 300 }));

    expect(store.size()).toBe(2);
    await expect(store.get(firstId)).resolves.toBeNull();
    await expect(store.get(secondId)).resolves.not.toBeNull();
    await expect(store.get(thirdId)).resolves.not.toBeNull();
  });
});
