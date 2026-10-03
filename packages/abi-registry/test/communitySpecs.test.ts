/**
 * Every file under `specs/community/` is a verified canonical spec: a
 * `<contractId>.json` produced by `discoverContractSpec()` + `canonicalizeSpec()`
 * and a `<contractId>.verdict.json` recorded from `abi-registry verify --json`.
 * These checks are offline - they pin the file layout, the contract ID checksum,
 * and that the committed verdict is `match`; re-run the CLI to refresh a verdict.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StrKey } from "@stellar/stellar-sdk";
import { canonicalizeSpec, validateSpec } from "../src/spec.js";
import type { ContractSpec } from "../src/spec.js";

const COMMUNITY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../specs/community");
const specFiles = readdirSync(COMMUNITY_DIR).filter(
  (f) => f.endsWith(".json") && !f.endsWith(".verdict.json"),
);

describe("specs/community", () => {
  it("contains at least the Comet BLND:USDC pool", () => {
    expect(specFiles).toContain("CAS3FL6TLZKDGGSISDBWGGPXT3NRR4DYTZD7YOD3HMYO6LTJUVGRVEAM.json");
  });

  describe.each(specFiles)("%s", (file) => {
    const contractId = file.replace(/\.json$/, "");
    const text = readFileSync(resolve(COMMUNITY_DIR, file), "utf-8");
    const spec = JSON.parse(text) as ContractSpec;

    it("is named after a checksum-valid mainnet contract ID", () => {
      expect(StrKey.isValidContract(contractId)).toBe(true);
      expect(spec.contractId).toBe(contractId);
      expect(spec.network).toBe("mainnet");
    });

    it("is a valid ContractSpec in canonical form with identifying name/description", () => {
      expect(validateSpec(spec)).toEqual({ valid: true });
      // The repo's lint-staged hook pretty-prints JSON, so compare canonical forms, not bytes:
      // canonicalizeSpec (the on-chain hash input) must be stable and key-order independent.
      expect(JSON.parse(canonicalizeSpec(spec))).toEqual(spec);
      expect(spec.name).not.toBe(contractId);
      expect(spec.description?.length).toBeGreaterThan(0);
    });

    it("has a committed verdict of match", () => {
      const verdict = JSON.parse(
        readFileSync(resolve(COMMUNITY_DIR, `${contractId}.verdict.json`), "utf-8"),
      ) as { contractId: string; status: string };
      expect(verdict).toEqual({ contractId, status: "match" });
    });
  });
});
