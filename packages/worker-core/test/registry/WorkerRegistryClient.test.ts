import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerRegistryClient } from "../../src/registry/WorkerRegistryClient.js";
import type { OperatorRecord, WorkerOfferingRecord } from "@orbital-stellar/abi-registry";

const STELLAR_ADDR = "GASDKEGVDZFF423H4MX27UHZUX35PBQBJBZTGCS7IVNVKG2LQTVVO7R7";
const CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const BASE_URL = "https://registry.example.com";

function makeOperator(overrides: Partial<OperatorRecord> = {}): OperatorRecord {
  return {
    id: "test-operator",
    name: "Test Operator",
    stellarAddress: STELLAR_ADDR,
    contact: "operator@example.com",
    maintainer: "@test-operator",
    supportedTriggers: ["event", "schedule"],
    networks: ["testnet"],
    terms: {
      pricePerInvocation: 0.01,
      denomination: "USDC",
      dailyCap: 1000,
      slaMs: 5000,
    },
    latencyTier: "standard",
    version: "1.0.0",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeOffering(overrides: Partial<WorkerOfferingRecord> = {}): WorkerOfferingRecord {
  return {
    id: "test-offering",
    contractId: CONTRACT_ID,
    functionName: "swap",
    triggerClass: "event",
    terms: {
      pricePerInvocation: 0.01,
      denomination: "USDC",
      dailyCap: 1000,
      slaMs: 5000,
    },
    operatorId: "test-operator",
    version: "1.0.0",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function jsonResponse(data: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => data };
}

describe("WorkerRegistryClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFetch(handler: (url: string) => unknown) {
    const fetchMock = vi.fn(async (url: string) => handler(url));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  describe("resolveOperator", () => {
    it("returns the record fetched from the registry", async () => {
      const fetchMock = stubFetch((url) =>
        url === `${BASE_URL}/operators/test-operator.json`
          ? jsonResponse(makeOperator())
          : jsonResponse(null, false, 404),
      );
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await expect(client.resolveOperator("test-operator")).resolves.toEqual(makeOperator());
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("serves repeat reads from the cache without refetching", async () => {
      const fetchMock = stubFetch(() => jsonResponse(makeOperator()));
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await client.resolveOperator("test-operator");
      await client.resolveOperator("test-operator");

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("refetches after the TTL expires", async () => {
      const fetchMock = stubFetch(() => jsonResponse(makeOperator()));
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL, cacheTtlMs: 60_000 });

      await client.resolveOperator("test-operator");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(59_999);
      await client.resolveOperator("test-operator");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Expiry is strict (Date.now() > expiresAt), so the entry survives
      // exactly until the TTL elapses, then refetches.
      vi.advanceTimersByTime(2);
      await client.resolveOperator("test-operator");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("returns null on a 404 and does not cache the miss", async () => {
      const fetchMock = stubFetch(() => jsonResponse({ error: "not found" }, false, 404));
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await expect(client.resolveOperator("ghost")).resolves.toBeNull();
      await expect(client.resolveOperator("ghost")).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("returns null on a server error", async () => {
      stubFetch(() => jsonResponse({ error: "boom" }, false, 500));
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await expect(client.resolveOperator("test-operator")).resolves.toBeNull();
    });

    it("returns null for a malformed record and does not cache it", async () => {
      const fetchMock = stubFetch(() => jsonResponse({ id: "test-operator" }));
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await expect(client.resolveOperator("test-operator")).resolves.toBeNull();
      await expect(client.resolveOperator("test-operator")).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("lets a transport failure propagate to the caller", async () => {
      stubFetch(() => {
        throw new Error("network down");
      });
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await expect(client.resolveOperator("test-operator")).rejects.toThrow("network down");
    });

    it("trims a trailing slash from the base URL", async () => {
      const fetchMock = stubFetch(() => jsonResponse(makeOperator()));
      const client = new WorkerRegistryClient({ baseUrl: `${BASE_URL}/` });

      await client.resolveOperator("test-operator");

      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/operators/test-operator.json`);
    });
  });

  describe("resolveOffering", () => {
    it("returns the record fetched from the registry", async () => {
      const fetchMock = stubFetch((url) =>
        url === `${BASE_URL}/offerings/test-offering.json`
          ? jsonResponse(makeOffering())
          : jsonResponse(null, false, 404),
      );
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await expect(client.resolveOffering("test-offering")).resolves.toEqual(makeOffering());
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("serves repeat reads from its own cache, separate from operators", async () => {
      const fetchMock = stubFetch((url) =>
        url.includes("/offerings/") ? jsonResponse(makeOffering()) : jsonResponse(makeOperator()),
      );
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await client.resolveOffering("test-offering");
      await client.resolveOperator("test-operator");
      await client.resolveOffering("test-offering");
      await client.resolveOperator("test-operator");

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("returns null on a 404 without caching the miss", async () => {
      const fetchMock = stubFetch(() => jsonResponse(null, false, 404));
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await expect(client.resolveOffering("ghost")).resolves.toBeNull();
      await expect(client.resolveOffering("ghost")).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("returns null on a server error", async () => {
      stubFetch(() => jsonResponse(null, false, 503));
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await expect(client.resolveOffering("test-offering")).resolves.toBeNull();
    });

    it("returns null for a malformed record without caching it", async () => {
      const fetchMock = stubFetch(() => jsonResponse({ id: "test-offering" }));
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await expect(client.resolveOffering("test-offering")).resolves.toBeNull();
      await expect(client.resolveOffering("test-offering")).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("lets a transport failure propagate to the caller", async () => {
      stubFetch(() => {
        throw new Error("network down");
      });
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await expect(client.resolveOffering("test-offering")).rejects.toThrow("network down");
    });
  });

  describe("listOfferingsForOperator", () => {
    it("returns every valid offering", async () => {
      stubFetch(() => jsonResponse([makeOffering(), makeOffering({ id: "second" })]));
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      const offerings = await client.listOfferingsForOperator("test-operator");

      expect(offerings).toHaveLength(2);
      expect(offerings.map((o) => o.id)).toEqual(["test-offering", "second"]);
    });

    it("filters out invalid entries while keeping the valid ones", async () => {
      stubFetch(() =>
        jsonResponse([makeOffering(), { id: "broken" }, makeOffering({ id: "kept" })]),
      );
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      const offerings = await client.listOfferingsForOperator("test-operator");

      expect(offerings.map((o) => o.id)).toEqual(["test-offering", "kept"]);
    });

    it("returns an empty array on a 404", async () => {
      stubFetch(() => jsonResponse(null, false, 404));
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await expect(client.listOfferingsForOperator("ghost")).resolves.toEqual([]);
    });

    it("returns an empty array on a server error", async () => {
      stubFetch(() => jsonResponse(null, false, 500));
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await expect(client.listOfferingsForOperator("test-operator")).resolves.toEqual([]);
    });

    it("returns an empty array when the body is not a list", async () => {
      stubFetch(() => jsonResponse(makeOffering()));
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await expect(client.listOfferingsForOperator("test-operator")).resolves.toEqual([]);
    });

    it("returns an empty array when the transport fails, as documented", async () => {
      stubFetch(() => {
        throw new Error("network down");
      });
      const client = new WorkerRegistryClient({ baseUrl: BASE_URL });

      await expect(client.listOfferingsForOperator("test-operator")).resolves.toEqual([]);
    });
  });
});
