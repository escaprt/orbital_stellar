import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import { existsSync, writeFileSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { generateForContract, writeLockFile, watchCodegen } from "../src/watch.js";
import type { OrbitalCodegenConfig } from "../src/config.js";

describe("watch mode", () => {
  let tmpDir: string;

  function makeConfig(overrides: Partial<OrbitalCodegenConfig> = {}): OrbitalCodegenConfig {
    return {
      contracts: [{ contractId: "C123", name: "test-contract" }],
      outDir: tmpDir,
      ...overrides,
    };
  }

  function writeSpec(name: string, data: Record<string, unknown>) {
    const path = resolve(tmpDir, `${name}.spec.json`);
    writeFileSync(path, JSON.stringify(data), "utf-8");
    return path;
  }

  test("generateForContract returns hash on success", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "orbital-watch-test-"));
    writeSpec("test-contract", {
      name: "TestContract",
      functions: [],
      events: [{ name: "Ping", data: [{ name: "count", type: "u32" }] }],
      types: {},
    });

    const config = makeConfig();
    const hash = await generateForContract("C123", config, "test-contract");
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
    expect(hash!.length).toBe(64);

    const outPath = resolve(tmpDir, "test-contract.d.ts");
    expect(existsSync(outPath)).toBe(true);
    const content = readFileSync(outPath, "utf-8");
    expect(content).toContain("Ping");
  });

  test("generateForContract returns null for unresolvable contract", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "orbital-watch-test-"));
    const config = makeConfig();
    const hash = await generateForContract("C999", config, "nonexistent");
    expect(hash).toBeNull();
  });

  test("writeLockFile writes atomically", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "orbital-watch-test-"));
    const lock = {
      "test-contract": {
        specHash: "a".repeat(64),
        verifiedAt: "2026-07-28T12:00:00Z",
      },
    };

    writeLockFile(tmpDir, lock);

    const lockPath = resolve(tmpDir, "orbital.lock.json");
    expect(existsSync(lockPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(lockPath, "utf-8"));
    expect(parsed).toEqual(lock);
  });

  test("generateForContract resolves a spec filed under the contract id", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "orbital-watch-test-"));
    writeSpec("CAAA", {
      name: "ById",
      functions: [],
      events: [],
      types: {},
    });

    const config = makeConfig({ contracts: [{ contractId: "CAAA" }] });
    const hash = await generateForContract("CAAA", config);
    expect(hash).toHaveLength(64);
    expect(existsSync(resolve(tmpDir, "CAAA.d.ts"))).toBe(true);
  });
});

describe("watchCodegen poll loop", () => {
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const SPEC_V1 = {
    name: "PollContract",
    functions: [],
    events: [{ name: "Ping", data: [{ name: "count", type: "u32" }] }],
    types: {},
  };
  const SPEC_V2 = {
    name: "PollContract",
    functions: [],
    events: [{ name: "Pong", data: [{ name: "count", type: "u32" }] }],
    types: {},
  };

  function makeConfig(overrides: Partial<OrbitalCodegenConfig> = {}): OrbitalCodegenConfig {
    return {
      contracts: [{ contractId: "CPOLL", name: "poll-contract" }],
      outDir: tmpDir,
      ...overrides,
    };
  }

  function writeSpecFile(name: string, data: unknown) {
    writeFileSync(resolve(tmpDir, `${name}.spec.json`), JSON.stringify(data), "utf-8");
  }

  function readText(name: string) {
    return readFileSync(resolve(tmpDir, name), "utf-8");
  }

  function mtime(name: string) {
    return statSync(resolve(tmpDir, name)).mtimeMs;
  }

  function logged(matcher: string | RegExp) {
    return logSpy.mock.calls.some((args) =>
      args.some((a) =>
        typeof a === "string"
          ? matcher instanceof RegExp
            ? matcher.test(a)
            : a.includes(matcher)
          : false,
      ),
    );
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "orbital-watch-loop-"));
    vi.useFakeTimers();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as unknown as typeof process.exit);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function stopLoop(p: Promise<void>, pollMs: number) {
    process.emit("SIGINT");
    // Wake the sleeping poll so it observes shouldRun === false and breaks.
    await vi.advanceTimersByTimeAsync(pollMs);
    await p;
  }

  test("initial run generates outputs and a lock, then an unchanged poll rewrites nothing", async () => {
    writeSpecFile("poll-contract", SPEC_V1);
    const config = makeConfig();

    const p = watchCodegen(config, { pollIntervalMs: 1000, debounceMs: 50, cwd: tmpDir });
    await vi.advanceTimersByTimeAsync(0);

    expect(existsSync(resolve(tmpDir, "poll-contract.d.ts"))).toBe(true);
    expect(readText("poll-contract.d.ts")).toContain("Ping");
    expect(JSON.parse(readText("orbital.lock.json"))["poll-contract"].specHash).toHaveLength(64);
    expect(logged("Watching 1 contract(s)")).toBe(true);
    expect(logged("Burst debounce window")).toBe(true);

    // Regeneration always rewrites the .d.ts, but the lock is only written
    // when something changed: the content is stable and the lock untouched.
    const dtsContent = readText("poll-contract.d.ts");
    const lockMtime = mtime("orbital.lock.json");

    // One full poll + debounce cycle with identical bytes: OK, no rewrite.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(50);
    expect(logged(/OK - hash unchanged/)).toBe(true);
    expect(readText("poll-contract.d.ts")).toBe(dtsContent);
    expect(mtime("orbital.lock.json")).toBe(lockMtime);

    await stopLoop(p, 1000);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test("a changed spec regenerates outputs and updates the lock", async () => {
    writeSpecFile("poll-contract", SPEC_V1);
    const config = makeConfig();

    const p = watchCodegen(config, { pollIntervalMs: 1000, debounceMs: 50, cwd: tmpDir });
    await vi.advanceTimersByTimeAsync(0);
    const before = readText("poll-contract.d.ts");
    const lockBefore = JSON.parse(readText("orbital.lock.json"))["poll-contract"].specHash;

    writeSpecFile("poll-contract", SPEC_V2);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(50);

    expect(logged(/REGENERATED/)).toBe(true);
    const after = readText("poll-contract.d.ts");
    expect(after).toContain("Pong");
    expect(after).not.toBe(before);
    expect(JSON.parse(readText("orbital.lock.json"))["poll-contract"].specHash).not.toBe(
      lockBefore,
    );

    await stopLoop(p, 1000);
  });

  test("a missing spec is skipped without exiting, and picked up once added", async () => {
    const config: OrbitalCodegenConfig = {
      contracts: [
        { contractId: "CMISS", name: "missing" },
        { contractId: "CNAMELESSMISS" },
        { contractId: "CPOLL", name: "poll-contract" },
      ],
      outDir: tmpDir,
    };
    writeSpecFile("poll-contract", SPEC_V1);

    const p = watchCodegen(config, { pollIntervalMs: 1000, debounceMs: 0, cwd: tmpDir });
    await vi.advanceTimersByTimeAsync(0);

    expect(logged(/SKIP - spec not resolvable/)).toBe(true);
    expect(existsSync(resolve(tmpDir, "poll-contract.d.ts"))).toBe(true);

    // The missing specs appear later: the next poll generates them.
    writeSpecFile("missing", SPEC_V1);
    writeSpecFile("CNAMELESSMISS", SPEC_V1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(existsSync(resolve(tmpDir, "missing.d.ts"))).toBe(true);
    expect(existsSync(resolve(tmpDir, "CNAMELESSMISS.d.ts"))).toBe(true);

    await stopLoop(p, 1000);
  });

  test("a corrupt lock file is treated as absent and rewritten", async () => {
    writeSpecFile("poll-contract", SPEC_V1);
    writeFileSync(resolve(tmpDir, "orbital.lock.json"), "{ not json", "utf-8");
    const config = makeConfig();

    const p = watchCodegen(config, { pollIntervalMs: 1000, debounceMs: 0, cwd: tmpDir });
    await vi.advanceTimersByTimeAsync(0);

    const lock = JSON.parse(readText("orbital.lock.json"));
    expect(lock["poll-contract"].specHash).toHaveLength(64);

    await stopLoop(p, 1000);
  });

  test("a stale lock hash regenerates with old and new hashes reported", async () => {
    writeSpecFile("poll-contract", SPEC_V1);
    writeFileSync(
      resolve(tmpDir, "orbital.lock.json"),
      JSON.stringify({
        "poll-contract": { specHash: "0".repeat(64), verifiedAt: "2026-01-01T00:00:00Z" },
      }),
      "utf-8",
    );
    const config = makeConfig();

    const p = watchCodegen(config, { pollIntervalMs: 1000, debounceMs: 0, cwd: tmpDir });
    await vi.advanceTimersByTimeAsync(0);

    expect(logged(/REGENERATED - old:/)).toBe(true);

    await stopLoop(p, 1000);
  });

  test("rapid polls inside the debounce window schedule a single regeneration", async () => {
    writeSpecFile("poll-contract", SPEC_V1);
    const config = makeConfig();

    const p = watchCodegen(config, { pollIntervalMs: 100, debounceMs: 5000, cwd: tmpDir });
    await vi.advanceTimersByTimeAsync(0);
    const first = readText("poll-contract.d.ts");

    // Several polls fire while the debounce is still pending: each is skipped.
    writeSpecFile("poll-contract", SPEC_V2);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(readText("poll-contract.d.ts")).toBe(first);

    // Once the window elapses the single pending regeneration runs.
    await vi.advanceTimersByTimeAsync(5000);
    expect(readText("poll-contract.d.ts")).toContain("Pong");

    await stopLoop(p, 100);
  });

  test("SIGINT during a pending debounce clears it and exits", async () => {
    writeSpecFile("poll-contract", SPEC_V1);
    const config = makeConfig();

    const p = watchCodegen(config, { pollIntervalMs: 100, debounceMs: 5000, cwd: tmpDir });
    await vi.advanceTimersByTimeAsync(0);

    // A poll schedules the debounced regeneration; SIGINT lands first.
    await vi.advanceTimersByTimeAsync(100);
    process.emit("SIGINT");
    await vi.advanceTimersByTimeAsync(100);
    await p;

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logged("SIGINT received")).toBe(true);
  });

  test("a contract without a name resolves under its contract id", async () => {
    writeSpecFile("CNAMELESS", SPEC_V1);
    const config = makeConfig({ contracts: [{ contractId: "CNAMELESS" }] });

    const p = watchCodegen(config, { pollIntervalMs: 1000, debounceMs: 0, cwd: tmpDir });
    await vi.advanceTimersByTimeAsync(0);

    expect(existsSync(resolve(tmpDir, "CNAMELESS.d.ts"))).toBe(true);
    expect(Object.keys(JSON.parse(readText("orbital.lock.json")))).toEqual(["CNAMELESS"]);

    await stopLoop(p, 1000);
  });

  test("omitted intervals fall back to the documented defaults", async () => {
    writeSpecFile("poll-contract", SPEC_V1);
    const config = makeConfig();

    const p = watchCodegen(config, { cwd: tmpDir });
    await vi.advanceTimersByTimeAsync(0);
    expect(logged("poll every 15000ms")).toBe(true);
    expect(logged("Burst debounce window: 2000ms")).toBe(true);

    await stopLoop(p, 15000);
  });
});
