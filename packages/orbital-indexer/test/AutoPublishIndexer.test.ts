import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Watcher } from "@orbital-stellar/pulse-core";
import type {
  AbiRegistryClientLike,
  ContractEmittedEvent,
  ContractInvokedEvent,
  EventEngine,
  Logger,
} from "@orbital-stellar/pulse-core";
import type { ContractSpec, PublishResult, RegistryPublisher } from "@orbital-stellar/abi-registry";
import { NoEmbeddedSpecError } from "@orbital-stellar/abi-registry";
import { AutoPublishIndexer } from "../src/AutoPublishIndexer.js";

const discoverContractSpecMock = vi.fn();

vi.mock("@orbital-stellar/abi-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@orbital-stellar/abi-registry")>();
  return {
    ...actual,
    discoverContractSpec: (...args: unknown[]) => discoverContractSpecMock(...args),
  };
});

function testSpec(overrides: Partial<ContractSpec> = {}): ContractSpec {
  return {
    version: "0.0.0",
    name: "CTEST",
    contractId: "CTEST",
    functions: [],
    events: [],
    types: {},
    ...overrides,
  };
}

function makeFakeEngine() {
  const watcher = new Watcher("orbital-indexer");
  const subscribeContract = vi.fn().mockReturnValue(watcher);
  const unsubscribeContract = vi.fn();
  const engine = { subscribeContract, unsubscribeContract } as unknown as EventEngine;
  return { engine, watcher, subscribeContract, unsubscribeContract };
}

function makeEmittedEvent(contractId: string): ContractEmittedEvent {
  return {
    type: "contract.emitted",
    contractId,
    topics: [],
    data: null,
    inSuccessfulContractCall: true,
    timestamp: new Date().toISOString(),
    raw: {} as ContractEmittedEvent["raw"],
  };
}

function makeInvokedEvent(contractId: string): ContractInvokedEvent {
  return {
    type: "contract.invoked",
    contractId,
    function: "ping",
    args: [],
    inSuccessfulContractCall: true,
    timestamp: new Date().toISOString(),
    timestampDate: new Date(),
  };
}

function publishResult(overrides: Partial<PublishResult> = {}): PublishResult {
  return { contractId: "CNEW", version: "0.0.0", etag: "etag-1", txHash: "tx-1", ...overrides };
}

/** A `Logger` made entirely of spies so tests can assert on structured log calls. */
function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

const POINTER = "https://example.com/specs/CNEW.json";

/**
 * Compact constructor for the indexer. Optional fields are only included when
 * supplied so tests can exercise the `??` defaults in the source (no logger,
 * no TTL override, no network).
 */
function makeIndexer(
  overrides: {
    engine?: EventEngine;
    registryClient?: AbiRegistryClientLike;
    publisher?: RegistryPublisher;
    pointerStrategy?: (spec: ContractSpec, canonicalJson: string) => Promise<string>;
    logger?: Logger;
    undiscoverableTtlMs?: number;
    network?: "mainnet" | "testnet" | "futurenet";
  } = {},
) {
  const engine = overrides.engine ?? makeFakeEngine().engine;
  return new AutoPublishIndexer({
    engine,
    registryClient: overrides.registryClient ?? { getSpec: vi.fn().mockResolvedValue(null) },
    publisher: overrides.publisher ?? { publish: vi.fn() },
    rpcUrl: "https://soroban-testnet.stellar.org",
    pointerStrategy: overrides.pointerStrategy ?? vi.fn().mockResolvedValue(POINTER),
    ...(overrides.logger ? { logger: overrides.logger } : {}),
    ...(overrides.undiscoverableTtlMs === undefined
      ? {}
      : { undiscoverableTtlMs: overrides.undiscoverableTtlMs }),
    ...(overrides.network ? { network: overrides.network } : {}),
  });
}

describe("AutoPublishIndexer", () => {
  beforeEach(() => {
    discoverContractSpecMock.mockReset();
  });

  it("start() subscribes with a wildcard filter that matches every contract", () => {
    const { engine, subscribeContract } = makeFakeEngine();
    const indexer = new AutoPublishIndexer({
      engine,
      registryClient: { getSpec: vi.fn() },
      publisher: { publish: vi.fn() },
      rpcUrl: "https://soroban-testnet.stellar.org",
      pointerStrategy: vi.fn(),
    });

    indexer.start();

    expect(subscribeContract).toHaveBeenCalledWith("orbital-indexer", { filters: [{}] });
  });

  it("skips discovery when the registry already has a spec for the contract", async () => {
    const { engine, watcher } = makeFakeEngine();
    const registryClient: AbiRegistryClientLike = {
      getSpec: vi.fn().mockResolvedValue(testSpec()),
    };
    const publisher: RegistryPublisher = { publish: vi.fn() };

    const indexer = new AutoPublishIndexer({
      engine,
      registryClient,
      publisher,
      rpcUrl: "https://soroban-testnet.stellar.org",
      pointerStrategy: vi.fn(),
    });
    indexer.start();

    watcher.emit("*", makeEmittedEvent("CKNOWN"));
    await vi.waitFor(() => expect(registryClient.getSpec).toHaveBeenCalledWith("CKNOWN"));

    expect(discoverContractSpecMock).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("discovers and publishes an unknown contract exactly once, even with a concurrent duplicate event", async () => {
    const { engine, watcher } = makeFakeEngine();
    const registryClient: AbiRegistryClientLike = { getSpec: vi.fn().mockResolvedValue(null) };
    const publisher: RegistryPublisher = {
      publish: vi.fn().mockResolvedValue({ contractId: "CNEW", version: "0.0.0", etag: "x" }),
    };
    const pointerStrategy = vi.fn().mockResolvedValue("https://example.com/spec.json");

    let resolveDiscover!: (spec: ContractSpec) => void;
    discoverContractSpecMock.mockReturnValue(
      new Promise<ContractSpec>((resolve) => {
        resolveDiscover = resolve;
      }),
    );

    const indexer = new AutoPublishIndexer({
      engine,
      registryClient,
      publisher,
      rpcUrl: "https://soroban-testnet.stellar.org",
      pointerStrategy,
    });
    indexer.start();

    // Two events for the same never-seen contract arrive before discovery resolves.
    watcher.emit("*", makeEmittedEvent("CNEW"));
    watcher.emit("*", makeEmittedEvent("CNEW"));

    await vi.waitFor(() => expect(discoverContractSpecMock).toHaveBeenCalledTimes(1));

    resolveDiscover(testSpec({ contractId: "CNEW" }));
    await vi.waitFor(() => expect(publisher.publish).toHaveBeenCalledTimes(1));

    expect(pointerStrategy).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: "CNEW", pointer: "https://example.com/spec.json" }),
    );
  });

  it("backs off after NoEmbeddedSpecError and does not retry within the TTL window", async () => {
    const { engine, watcher } = makeFakeEngine();
    const registryClient: AbiRegistryClientLike = { getSpec: vi.fn().mockResolvedValue(null) };
    const publisher: RegistryPublisher = { publish: vi.fn() };
    discoverContractSpecMock.mockRejectedValue(new NoEmbeddedSpecError());

    const indexer = new AutoPublishIndexer({
      engine,
      registryClient,
      publisher,
      rpcUrl: "https://soroban-testnet.stellar.org",
      pointerStrategy: vi.fn(),
      undiscoverableTtlMs: 100_000,
    });
    indexer.start();

    watcher.emit("*", makeEmittedEvent("CSTRIPPED"));
    await vi.waitFor(() => expect(discoverContractSpecMock).toHaveBeenCalledTimes(1));

    watcher.emit("*", makeEmittedEvent("CSTRIPPED"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(discoverContractSpecMock).toHaveBeenCalledTimes(1);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("propagates discovery errors that are not NoEmbeddedSpecError", async () => {
    const { engine } = makeFakeEngine();
    const registryClient: AbiRegistryClientLike = { getSpec: vi.fn().mockResolvedValue(null) };
    discoverContractSpecMock.mockRejectedValue(new Error("rpc timeout"));

    const indexer = new AutoPublishIndexer({
      engine,
      registryClient,
      publisher: { publish: vi.fn() },
      rpcUrl: "https://soroban-testnet.stellar.org",
      pointerStrategy: vi.fn(),
    });

    await expect(indexer.ensureDiscovered("CBAD")).rejects.toThrow("rpc timeout");
  });

  it("stop() unsubscribes from the engine", () => {
    const { engine, unsubscribeContract } = makeFakeEngine();
    const indexer = new AutoPublishIndexer({
      engine,
      registryClient: { getSpec: vi.fn() },
      publisher: { publish: vi.fn() },
      rpcUrl: "https://soroban-testnet.stellar.org",
      pointerStrategy: vi.fn(),
    });

    indexer.start();
    indexer.stop();

    expect(unsubscribeContract).toHaveBeenCalledWith("orbital-indexer");
  });

  it("ignores non-contract watcher events", async () => {
    const { engine, watcher } = makeFakeEngine();
    const registryClient: AbiRegistryClientLike = { getSpec: vi.fn() };
    const indexer = new AutoPublishIndexer({
      engine,
      registryClient,
      publisher: { publish: vi.fn() },
      rpcUrl: "https://soroban-testnet.stellar.org",
      pointerStrategy: vi.fn(),
    });
    indexer.start();

    watcher.emit("*", { type: "payment.received", timestamp: new Date().toISOString() });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(registryClient.getSpec).not.toHaveBeenCalled();
  });
});

// ── In-flight dedupe ──────────────────────────────────────────────────────────
// The indexer keys in-flight work by contractId, so duplicate events for the
// same never-seen contract must collapse into a single discovery + publish.

describe("AutoPublishIndexer in-flight dedupe", () => {
  beforeEach(() => {
    discoverContractSpecMock.mockReset();
  });

  it("does not start a second discovery while one is already pending", async () => {
    const publish = vi.fn().mockResolvedValue(publishResult());
    let resolveDiscover!: (spec: ContractSpec) => void;
    discoverContractSpecMock.mockReturnValue(
      new Promise<ContractSpec>((resolve) => {
        resolveDiscover = resolve;
      }),
    );
    const indexer = makeIndexer({ publisher: { publish } });

    const first = indexer.ensureDiscovered("CDUP");
    const second = indexer.ensureDiscovered("CDUP");

    // Still pending: the second caller joined the first rather than
    // kicking off its own RPC round trip.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(discoverContractSpecMock).toHaveBeenCalledTimes(1);

    resolveDiscover(testSpec({ contractId: "CDUP" }));
    const [a, b] = await Promise.all([first, second]);

    expect(a).toBe(b);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("performs one discovery, one pointer commit and one publish for concurrent callers", async () => {
    const registryClient: AbiRegistryClientLike = {
      getSpec: vi.fn().mockResolvedValue(null),
    };
    const pointerStrategy = vi.fn().mockResolvedValue(POINTER);
    const publish = vi.fn().mockResolvedValue(publishResult());
    let resolveDiscover!: (spec: ContractSpec) => void;
    discoverContractSpecMock.mockReturnValue(
      new Promise<ContractSpec>((resolve) => {
        resolveDiscover = resolve;
      }),
    );
    const indexer = makeIndexer({ registryClient, publisher: { publish }, pointerStrategy });

    const first = indexer.ensureDiscovered("CDUP");
    const second = indexer.ensureDiscovered("CDUP");
    resolveDiscover(testSpec({ contractId: "CDUP" }));
    const [a, b] = await Promise.all([first, second]);

    expect(a).toBe(b);
    expect(a).toMatchObject({ contractId: "CDUP", pointer: POINTER });
    expect(registryClient.getSpec).toHaveBeenCalledTimes(1);
    expect(discoverContractSpecMock).toHaveBeenCalledTimes(1);
    expect(pointerStrategy).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("keys in-flight work per contractId, so distinct contracts do not share a discovery", async () => {
    const publish = vi.fn().mockResolvedValue(publishResult());
    discoverContractSpecMock.mockImplementation(async (args: { contractId: string }) =>
      testSpec({ contractId: args.contractId }),
    );
    const indexer = makeIndexer({ publisher: { publish } });

    const [a, b] = await Promise.all([
      indexer.ensureDiscovered("CONEA"),
      indexer.ensureDiscovered("CONEB"),
    ]);

    expect(a).toMatchObject({ contractId: "CONEA" });
    expect(b).toMatchObject({ contractId: "CONEB" });
    expect(discoverContractSpecMock).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("clears the in-flight entry once discovery settles, so a later call runs again", async () => {
    const publish = vi.fn().mockResolvedValue(publishResult());
    discoverContractSpecMock.mockResolvedValue(testSpec({ contractId: "CAGAIN" }));
    const indexer = makeIndexer({ publisher: { publish } });

    await indexer.ensureDiscovered("CAGAIN");
    await indexer.ensureDiscovered("CAGAIN");

    expect(discoverContractSpecMock).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("clears the in-flight entry after a failed discovery so a later call retries", async () => {
    const logger = makeLogger();
    const publish = vi.fn().mockResolvedValue(publishResult());
    discoverContractSpecMock
      .mockRejectedValueOnce(new Error("rpc timeout"))
      .mockResolvedValueOnce(testSpec({ contractId: "CRETRY" }));
    const indexer = makeIndexer({ logger, publisher: { publish } });

    await expect(indexer.ensureDiscovered("CRETRY")).rejects.toThrow("rpc timeout");
    await expect(indexer.ensureDiscovered("CRETRY")).resolves.toMatchObject({
      contractId: "CRETRY",
    });
    expect(discoverContractSpecMock).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

// ── Backoff for undiscoverable contracts ──────────────────────────────────────
// `NoEmbeddedSpecError` means the WASM has no SEP-48 section to discover, so
// retrying on every subsequent event would hammer the RPC node forever.

describe("AutoPublishIndexer undiscoverable backoff", () => {
  beforeEach(() => {
    discoverContractSpecMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to a 30 minute backoff and logs the window it applied", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    discoverContractSpecMock.mockRejectedValue(new NoEmbeddedSpecError());
    const logger = makeLogger();
    const indexer = makeIndexer({ logger });

    await expect(indexer.ensureDiscovered("CSTRIPPED")).resolves.toBeNull();

    expect(logger.info).toHaveBeenCalledWith("orbital-indexer: no embedded spec, backing off", {
      contractId: "CSTRIPPED",
      backoffMs: 30 * 60 * 1000,
    });
  });

  it("skips discovery while the backoff window is open and retries once it elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const ttlMs = 60_000;
    discoverContractSpecMock.mockRejectedValue(new NoEmbeddedSpecError());
    const indexer = makeIndexer({ undiscoverableTtlMs: ttlMs });

    expect(await indexer.ensureDiscovered("CSTRIPPED")).toBeNull();
    expect(discoverContractSpecMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(ttlMs - 1);
    expect(await indexer.ensureDiscovered("CSTRIPPED")).toBeNull();
    expect(discoverContractSpecMock).toHaveBeenCalledTimes(1);

    // Window is half-open: the entry expires the instant the TTL is reached.
    vi.advanceTimersByTime(1);
    discoverContractSpecMock.mockResolvedValue(testSpec({ contractId: "CSTRIPPED" }));
    await expect(indexer.ensureDiscovered("CSTRIPPED")).resolves.toMatchObject({
      contractId: "CSTRIPPED",
    });
    expect(discoverContractSpecMock).toHaveBeenCalledTimes(2);
  });

  it("scopes the backoff to a single contractId", async () => {
    vi.useFakeTimers();
    discoverContractSpecMock.mockImplementation(async (args: { contractId: string }) => {
      if (args.contractId === "CSTRIPPED") throw new NoEmbeddedSpecError();
      return testSpec({ contractId: args.contractId });
    });
    const indexer = makeIndexer({ undiscoverableTtlMs: 60_000 });

    expect(await indexer.ensureDiscovered("CSTRIPPED")).toBeNull();
    await expect(indexer.ensureDiscovered("CFINE")).resolves.toMatchObject({
      contractId: "CFINE",
    });

    expect(discoverContractSpecMock).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: "CSTRIPPED" }),
    );
    expect(discoverContractSpecMock).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: "CFINE" }),
    );
  });

  it("rethrows a non-Error discovery failure unchanged", async () => {
    discoverContractSpecMock.mockRejectedValue("socket hang up");
    const indexer = makeIndexer();

    await expect(indexer.ensureDiscovered("CBAD")).rejects.toBe("socket hang up");
  });

  it("passes the configured network through to discovery", async () => {
    discoverContractSpecMock.mockResolvedValue(testSpec({ contractId: "CMAIN" }));
    const indexer = makeIndexer({ network: "mainnet" });

    await indexer.ensureDiscovered("CMAIN");

    expect(discoverContractSpecMock).toHaveBeenCalledWith({
      rpcUrl: "https://soroban-testnet.stellar.org",
      contractId: "CMAIN",
      network: "mainnet",
    });
  });
});

// ── Publish failure handling ──────────────────────────────────────────────────
// `discoverAndPublish` translates two classes of on-chain publish failure into
// success (the version is already filed / a sequence collision is retryable)
// and lets everything else propagate.

describe("AutoPublishIndexer publish failure handling", () => {
  beforeEach(() => {
    discoverContractSpecMock.mockReset();
  });

  it("logs contractId, version, specHash and txHash after a successful publish", async () => {
    const logger = makeLogger();
    discoverContractSpecMock.mockResolvedValue(testSpec({ contractId: "CNEW" }));
    const indexer = makeIndexer({
      publisher: { publish: vi.fn().mockResolvedValue(publishResult()) },
      logger,
    });

    await indexer.ensureDiscovered("CNEW");

    expect(logger.info).toHaveBeenCalledWith("orbital-indexer: published auto-discovered spec", {
      contractId: "CNEW",
      version: "0.0.0",
      specHash: "etag-1",
      txHash: "tx-1",
    });
  });

  it.each([
    ["AlreadyPublished", "tx failed: AlreadyPublished"],
    ["already been published", "spec for CNEW has already been published"],
    ["contract_error", "rpc error: contract_error(9)"],
  ])(
    "treats a %s rejection as success-with-existing instead of an error",
    async (_label, message) => {
      const logger = makeLogger();
      const publish = vi.fn().mockRejectedValue(new Error(message));
      discoverContractSpecMock.mockResolvedValue(testSpec({ contractId: "CNEW" }));
      const indexer = makeIndexer({ publisher: { publish }, logger });

      const spec = await indexer.ensureDiscovered("CNEW");

      expect(spec).toMatchObject({ contractId: "CNEW", pointer: POINTER });
      expect(publish).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        "orbital-indexer: spec already published by another process, using existing",
        { contractId: "CNEW", version: "0.0.0" },
      );
      expect(logger.info).not.toHaveBeenCalledWith(
        "orbital-indexer: published auto-discovered spec",
        expect.anything(),
      );
    },
  );

  it.each([
    ["tx_bad_seq", "tx failed: tx_bad_seq"],
    ["a bare sequence message", "sequence number already consumed"],
  ])("retries publish once for %s", async (_label, message) => {
    const logger = makeLogger();
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValueOnce(publishResult({ etag: "etag-2", txHash: "tx-2" }));
    discoverContractSpecMock.mockResolvedValue(testSpec({ contractId: "CNEW" }));
    const indexer = makeIndexer({ publisher: { publish }, logger });

    const spec = await indexer.ensureDiscovered("CNEW");

    expect(spec).toMatchObject({ contractId: "CNEW", pointer: POINTER });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      "orbital-indexer: sequence collision, retrying publish once",
      { contractId: "CNEW" },
    );
    expect(logger.info).toHaveBeenCalledWith("orbital-indexer: published auto-discovered spec", {
      contractId: "CNEW",
      version: "0.0.0",
      specHash: "etag-2",
      txHash: "tx-2",
    });
  });

  it("stringifies a non-Error rejection before matching it for a sequence retry", async () => {
    const publish = vi
      .fn()
      .mockRejectedValueOnce("tx_bad_seq")
      .mockResolvedValueOnce(publishResult());
    discoverContractSpecMock.mockResolvedValue(testSpec({ contractId: "CNEW" }));
    const indexer = makeIndexer({ publisher: { publish } });

    await expect(indexer.ensureDiscovered("CNEW")).resolves.toMatchObject({
      contractId: "CNEW",
    });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("propagates when the single sequence-collision retry also fails", async () => {
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new Error("tx_bad_seq"))
      .mockRejectedValueOnce(new Error("insufficient fee"));
    discoverContractSpecMock.mockResolvedValue(testSpec({ contractId: "CNEW" }));
    const indexer = makeIndexer({ publisher: { publish } });

    await expect(indexer.ensureDiscovered("CNEW")).rejects.toThrow("insufficient fee");
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("propagates a publish failure that is neither a republish nor a sequence error", async () => {
    const publish = vi.fn().mockRejectedValue(new Error("insufficient balance"));
    discoverContractSpecMock.mockResolvedValue(testSpec({ contractId: "CNEW" }));
    const indexer = makeIndexer({ publisher: { publish } });

    await expect(indexer.ensureDiscovered("CNEW")).rejects.toThrow("insufficient balance");
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("propagates a non-Error publish failure without retrying", async () => {
    const publish = vi.fn().mockRejectedValue("publisher offline");
    discoverContractSpecMock.mockResolvedValue(testSpec({ contractId: "CNEW" }));
    const indexer = makeIndexer({ publisher: { publish } });

    await expect(indexer.ensureDiscovered("CNEW")).rejects.toBe("publisher offline");
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("propagates a pointerStrategy failure and never publishes", async () => {
    const publish = vi.fn().mockResolvedValue(publishResult());
    const pointerStrategy = vi.fn().mockRejectedValue(new Error("blob store 503"));
    discoverContractSpecMock.mockResolvedValue(testSpec({ contractId: "CNEW" }));
    const indexer = makeIndexer({ publisher: { publish }, pointerStrategy });

    await expect(indexer.ensureDiscovered("CNEW")).rejects.toThrow("blob store 503");
    expect(publish).not.toHaveBeenCalled();
  });

  it("hands the pointer strategy the discovered spec and its canonical JSON", async () => {
    const pointerStrategy = vi.fn().mockResolvedValue(POINTER);
    const spec = testSpec({ contractId: "CNEW", version: "1.2.3" });
    discoverContractSpecMock.mockResolvedValue(spec);
    const indexer = makeIndexer({
      publisher: { publish: vi.fn().mockResolvedValue(publishResult()) },
      pointerStrategy,
    });

    await indexer.ensureDiscovered("CNEW");

    const [passedSpec, canonicalJson] = pointerStrategy.mock.calls[0] as [ContractSpec, string];
    expect(passedSpec).toBe(spec);
    expect(JSON.parse(canonicalJson)).toMatchObject({ contractId: "CNEW", version: "1.2.3" });
  });

  it("does not republish a contract the registry already knows about", async () => {
    const publish = vi.fn().mockResolvedValue(publishResult());
    const pointerStrategy = vi.fn().mockResolvedValue(POINTER);
    const registryClient: AbiRegistryClientLike = {
      getSpec: vi.fn().mockResolvedValue(testSpec({ contractId: "CKNOWN", version: "9.9.9" })),
    };
    const indexer = makeIndexer({
      registryClient,
      publisher: { publish },
      pointerStrategy,
      logger: makeLogger(),
    });

    await expect(indexer.ensureDiscovered("CKNOWN")).resolves.toMatchObject({
      contractId: "CKNOWN",
      version: "9.9.9",
    });
    expect(discoverContractSpecMock).not.toHaveBeenCalled();
    expect(pointerStrategy).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

// ── Watcher plumbing ──────────────────────────────────────────────────────────

describe("AutoPublishIndexer event plumbing", () => {
  beforeEach(() => {
    discoverContractSpecMock.mockReset();
  });

  it("reacts to contract.invoked events as well as contract.emitted", async () => {
    const { engine, watcher } = makeFakeEngine();
    const registryClient: AbiRegistryClientLike = {
      getSpec: vi.fn().mockResolvedValue(testSpec({ contractId: "CINVOKED" })),
    };
    const indexer = makeIndexer({ engine, registryClient });
    indexer.start();

    watcher.emit("*", makeInvokedEvent("CINVOKED"));
    await vi.waitFor(() => expect(registryClient.getSpec).toHaveBeenCalledWith("CINVOKED"));
  });

  it("ignores contract events that carry no contractId", async () => {
    const { engine, watcher } = makeFakeEngine();
    const registryClient: AbiRegistryClientLike = { getSpec: vi.fn() };
    const indexer = makeIndexer({ engine, registryClient });
    indexer.start();

    watcher.emit("*", { type: "contract.emitted", timestamp: new Date().toISOString() });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(registryClient.getSpec).not.toHaveBeenCalled();
  });

  it("ignores non-object and null watcher payloads", async () => {
    const { engine, watcher } = makeFakeEngine();
    const registryClient: AbiRegistryClientLike = { getSpec: vi.fn() };
    const indexer = makeIndexer({ engine, registryClient });
    indexer.start();

    watcher.emit("*", null);
    watcher.emit("*", "contract.emitted");
    watcher.emit("*", 42);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(registryClient.getSpec).not.toHaveBeenCalled();
  });

  it("logs a warning when event-driven discovery rejects", async () => {
    const { engine, watcher } = makeFakeEngine();
    const logger = makeLogger();
    discoverContractSpecMock.mockRejectedValue(new Error("rpc timeout"));
    const indexer = makeIndexer({ engine, logger });
    indexer.start();

    watcher.emit("*", makeEmittedEvent("CBOOM"));

    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith("orbital-indexer: ensureDiscovered failed", {
        contractId: "CBOOM",
        error: "rpc timeout",
      }),
    );
  });

  it("stringifies a non-Error rejection in the warning", async () => {
    const { engine, watcher } = makeFakeEngine();
    const logger = makeLogger();
    discoverContractSpecMock.mockRejectedValue("socket hang up");
    const indexer = makeIndexer({ engine, logger });
    indexer.start();

    watcher.emit("*", makeEmittedEvent("CBOOM"));

    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith("orbital-indexer: ensureDiscovered failed", {
        contractId: "CBOOM",
        error: "socket hang up",
      }),
    );
  });

  it("works without a logger, swallowing event-driven failures", async () => {
    const { engine, watcher } = makeFakeEngine();
    discoverContractSpecMock.mockRejectedValue(new Error("rpc timeout"));
    const indexer = makeIndexer({ engine });
    indexer.start();

    watcher.emit("*", makeEmittedEvent("CBOOM"));
    await vi.waitFor(() => expect(discoverContractSpecMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("start() is idempotent", () => {
    const { engine, subscribeContract } = makeFakeEngine();
    const indexer = makeIndexer({ engine });

    indexer.start();
    indexer.start();

    expect(subscribeContract).toHaveBeenCalledTimes(1);
  });

  it("stop() is idempotent and unsubscribes only once", () => {
    const { engine, unsubscribeContract } = makeFakeEngine();
    const indexer = makeIndexer({ engine });

    indexer.start();
    indexer.stop();
    indexer.stop();

    expect(unsubscribeContract).toHaveBeenCalledTimes(1);
    expect(unsubscribeContract).toHaveBeenCalledWith("orbital-indexer");
  });

  it("stop() before start() does not touch the engine", () => {
    const { engine, unsubscribeContract } = makeFakeEngine();
    const indexer = makeIndexer({ engine });

    indexer.stop();

    expect(unsubscribeContract).not.toHaveBeenCalled();
  });
});
