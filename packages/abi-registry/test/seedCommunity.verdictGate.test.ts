import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  communityPointer,
  discoverCommunitySpecs,
  isPublishableVerdict,
  stampCommunityPointers,
} from "../scripts/seed-community.js";
import { canonicalizeSpec } from "../src/spec.js";
import type { ContractSpec } from "../src/spec.js";

// Real mainnet contract IDs (valid StrKey checksums) borrowed from the
// published fixtures - the gate cares about shape, not which contract.
const CONTRACT_A = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
const CONTRACT_B = "CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK";

function validSpec(contractId: string): ContractSpec {
  return {
    version: "1.0.0",
    name: "Community Token",
    contractId,
    network: "mainnet",
    functions: [],
    events: [],
    types: {},
  };
}

function writeSpec(dir: string, contractId: string, spec?: Partial<ContractSpec>): void {
  writeFileSync(
    join(dir, `${contractId}.json`),
    JSON.stringify({ ...validSpec(contractId), ...spec }, null, 2),
    "utf-8",
  );
}

function writeVerdict(dir: string, contractId: string, verdict: unknown): void {
  writeFileSync(join(dir, `${contractId}.verdict.json`), JSON.stringify(verdict, null, 2), "utf-8");
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seed-community-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("isPublishableVerdict", () => {
  it("publishes only a match verdict", () => {
    expect(isPublishableVerdict("match")).toBe(true);
  });

  it("refuses mismatch, unverifiable, and anything unexpected", () => {
    expect(isPublishableVerdict("mismatch")).toBe(false);
    expect(isPublishableVerdict("unverifiable")).toBe(false);
    expect(isPublishableVerdict(undefined)).toBe(false);
    expect(isPublishableVerdict(null)).toBe(false);
    expect(isPublishableVerdict("")).toBe(false);
  });
});

describe("discoverCommunitySpecs verdict gate (issue #1184)", () => {
  it("publishes a spec whose verdict is match, with its main pointer attached", () => {
    writeSpec(dir, CONTRACT_A);
    writeVerdict(dir, CONTRACT_A, { contractId: CONTRACT_A, status: "match" });

    const entries = discoverCommunitySpecs(dir);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.publishable).toBe(true);
    expect(entries[0]?.refusalReason).toBeUndefined();
    expect(entries[0]?.spec.pointer).toBe(
      `https://raw.githubusercontent.com/orbital-stellar/orbital_stellar/main/packages/abi-registry/specs/community/${CONTRACT_A}.json`,
    );
  });

  it("honours COMMUNITY_POINTER_BASE_URL for the attached pointer", () => {
    process.env.COMMUNITY_POINTER_BASE_URL = "https://example.invalid/specs";
    try {
      writeSpec(dir, CONTRACT_A);
      writeVerdict(dir, CONTRACT_A, { contractId: CONTRACT_A, status: "match" });

      const entries = discoverCommunitySpecs(dir);

      expect(entries[0]?.spec.pointer).toBe(`https://example.invalid/specs/${CONTRACT_A}.json`);
    } finally {
      delete process.env.COMMUNITY_POINTER_BASE_URL;
    }
  });

  it("refuses a mismatch verdict", () => {
    writeSpec(dir, CONTRACT_A);
    writeVerdict(dir, CONTRACT_A, { contractId: CONTRACT_A, status: "mismatch", diffs: [] });

    const entries = discoverCommunitySpecs(dir);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.publishable).toBe(false);
    expect(entries[0]?.refusalReason).toMatch(/mismatch/);
  });

  it("refuses an unverifiable verdict", () => {
    writeSpec(dir, CONTRACT_A);
    writeVerdict(dir, CONTRACT_A, { contractId: CONTRACT_A, status: "unverifiable" });

    const entries = discoverCommunitySpecs(dir);

    expect(entries[0]?.publishable).toBe(false);
  });

  it("refuses a spec with no verdict file", () => {
    writeSpec(dir, CONTRACT_A);

    const entries = discoverCommunitySpecs(dir);

    expect(entries[0]?.publishable).toBe(false);
    expect(entries[0]?.refusalReason).toMatch(/missing verdict/);
  });

  it("refuses an unreadable verdict file", () => {
    writeSpec(dir, CONTRACT_A);
    writeFileSync(join(dir, `${CONTRACT_A}.verdict.json`), "{ not json", "utf-8");

    const entries = discoverCommunitySpecs(dir);

    expect(entries[0]?.publishable).toBe(false);
  });

  it("refuses a verdict filed against a different contract", () => {
    writeSpec(dir, CONTRACT_A);
    writeVerdict(dir, CONTRACT_A, { contractId: CONTRACT_B, status: "match" });

    const entries = discoverCommunitySpecs(dir);

    expect(entries[0]?.publishable).toBe(false);
    expect(entries[0]?.refusalReason).toMatch(CONTRACT_B);
  });

  it("refuses a spec whose filename does not match its contract_id", () => {
    writeSpec(dir, CONTRACT_A, { contractId: CONTRACT_B });
    writeVerdict(dir, CONTRACT_A, { contractId: CONTRACT_B, status: "match" });

    const entries = discoverCommunitySpecs(dir);

    expect(entries[0]?.publishable).toBe(false);
    expect(entries[0]?.refusalReason).toMatch(/does not match/);
  });

  it("refuses an invalid spec", () => {
    writeFileSync(join(dir, `${CONTRACT_A}.json`), JSON.stringify({ name: "nope" }), "utf-8");
    writeVerdict(dir, CONTRACT_A, { contractId: CONTRACT_A, status: "match" });

    const entries = discoverCommunitySpecs(dir);

    expect(entries[0]?.publishable).toBe(false);
  });

  it("publishes matches while refusing the rest in one pass", () => {
    writeSpec(dir, CONTRACT_A);
    writeVerdict(dir, CONTRACT_A, { contractId: CONTRACT_A, status: "match" });
    writeSpec(dir, CONTRACT_B);
    writeVerdict(dir, CONTRACT_B, { contractId: CONTRACT_B, status: "mismatch", diffs: [] });

    const entries = discoverCommunitySpecs(dir);

    expect(entries.map((e) => [e.contractId, e.publishable])).toEqual([
      [CONTRACT_A, true],
      [CONTRACT_B, false],
    ]);
  });

  it("reads an empty directory as no specs", () => {
    expect(discoverCommunitySpecs(dir)).toEqual([]);
  });

  it("reads a missing directory as no specs", () => {
    expect(discoverCommunitySpecs(join(dir, "does-not-exist"))).toEqual([]);
  });
});

describe("community spec pointers", () => {
  it("keeps a committed pointer that matches the expected one", () => {
    writeSpec(dir, CONTRACT_A, { pointer: communityPointer(CONTRACT_A) });
    writeVerdict(dir, CONTRACT_A, { contractId: CONTRACT_A, status: "match" });

    const entries = discoverCommunitySpecs(dir);

    expect(entries[0]?.publishable).toBe(true);
    expect(entries[0]?.spec.pointer).toBe(communityPointer(CONTRACT_A));
  });

  it("refuses a committed pointer that points elsewhere", () => {
    writeSpec(dir, CONTRACT_A, { pointer: "https://example.invalid/other.json" });
    writeVerdict(dir, CONTRACT_A, { contractId: CONTRACT_A, status: "match" });

    const entries = discoverCommunitySpecs(dir);

    expect(entries[0]?.publishable).toBe(false);
    expect(entries[0]?.refusalReason).toMatch(/not the expected/);
  });

  it("stamp writes the pointer so the served file hashes like the published spec", () => {
    writeSpec(dir, CONTRACT_A);
    writeSpec(dir, CONTRACT_B, { pointer: communityPointer(CONTRACT_B) });
    writeVerdict(dir, CONTRACT_A, { contractId: CONTRACT_A, status: "match" });

    expect(stampCommunityPointers(dir)).toEqual([`${CONTRACT_A}.json`]);

    const onDisk = JSON.parse(
      readFileSync(join(dir, `${CONTRACT_A}.json`), "utf-8"),
    ) as ContractSpec;
    const [entry] = discoverCommunitySpecs(dir);
    expect(onDisk.pointer).toBe(communityPointer(CONTRACT_A));
    expect(canonicalizeSpec(onDisk)).toBe(canonicalizeSpec(entry!.spec));
    expect(stampCommunityPointers(dir)).toEqual([]);
  });
});
