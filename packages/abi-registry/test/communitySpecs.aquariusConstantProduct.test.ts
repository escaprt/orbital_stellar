/**
 * Offline checks for the Aquarius constant-product community spec (#1211).
 * Pins the contract ID checksum, that the committed spec is valid and in
 * canonical form, and that the recorded verdict is `match`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StrKey } from "@stellar/stellar-sdk";
import { canonicalizeSpec, validateSpec } from "../src/spec.js";
import type { ContractSpec } from "../src/spec.js";

const ID = "CCY2PXGMKNQHO7WNYXEWX76L2C5BH3JUW3RCATGUYKY7QQTRILBZIFWV";
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../specs/community");
const spec = JSON.parse(readFileSync(resolve(DIR, `${ID}.json`), "utf-8")) as ContractSpec;

describe("specs/community - Aquarius constant-product pool", () => {
  it("is a checksum-valid mainnet contract and a valid, described ContractSpec", () => {
    expect(StrKey.isValidContract(ID)).toBe(true);
    expect(spec.contractId).toBe(ID);
    expect(spec.network).toBe("mainnet");
    expect(validateSpec(spec)).toEqual({ valid: true });
    expect(spec.name).toContain("Aquarius");
    expect(spec.description).toContain("constant-product");
  });

  it("is in canonical form and exposes the pool swap entry point", () => {
    expect(JSON.parse(canonicalizeSpec(spec))).toEqual(spec);
    expect(spec.functions.map((f) => f.name)).toContain("swap");
  });

  it("has a committed verdict of match", () => {
    const verdict = JSON.parse(readFileSync(resolve(DIR, `${ID}.verdict.json`), "utf-8"));
    expect(verdict).toEqual({ contractId: ID, status: "match" });
  });
});
