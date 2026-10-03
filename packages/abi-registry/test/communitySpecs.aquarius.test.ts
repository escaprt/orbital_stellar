/**
 * Offline checks for the Aquarius stableswap community spec (#1212). The spec
 * exists only because discovery learned to map `scSpecTypeVal` to the `val`
 * primitive, so this pins that the committed file uses it, is valid, and that
 * the recorded verdict is `match`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StrKey } from "@stellar/stellar-sdk";
import { validateSpec } from "../src/spec.js";
import type { ContractSpec } from "../src/spec.js";

const ID = "CCLZQDL5LY2DBPNNFBRKPSROGFGTT7Y7AI2SM6QUI3SUTTKA672X4PDF";
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../specs/community");
const spec = JSON.parse(readFileSync(resolve(DIR, `${ID}.json`), "utf-8")) as ContractSpec;

describe("specs/community - Aquarius stableswap pool", () => {
  it("is a checksum-valid mainnet contract and a valid, described ContractSpec", () => {
    expect(StrKey.isValidContract(ID)).toBe(true);
    expect(spec.contractId).toBe(ID);
    expect(spec.network).toBe("mainnet");
    expect(validateSpec(spec)).toEqual({ valid: true });
    expect(spec.name).toContain("Aquarius");
    expect(spec.description).toContain("stableswap");
  });

  it("carries the generic val type discovered from the WASM", () => {
    expect(JSON.stringify(spec.functions)).toContain('"val"');
  });

  it("has a committed verdict of match", () => {
    const verdict = JSON.parse(readFileSync(resolve(DIR, `${ID}.verdict.json`), "utf-8"));
    expect(verdict).toEqual({ contractId: ID, status: "match" });
  });
});
