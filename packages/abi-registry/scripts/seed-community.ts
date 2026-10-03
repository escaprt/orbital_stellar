#!/usr/bin/env node
/**
 * Publishes contributed community specs (`specs/community/*.json`) through the
 * live on-chain registry contract.
 *
 * Community specs differ from the bundled well-known specs in one respect:
 * they arrive with a verification verdict. Each `<contractId>.json` must sit
 * next to a `<contractId>.verdict.json` holding `abi-registry verify --json`
 * output, and only a `match` verdict is publishable - anything else refuses
 * the spec. There is no `generate` phase here: the specs are committed
 * directly (with their verdicts) by their authoring issues, so this script
 * only publishes what is already on disk.
 *
 * The pointer is the raw GitHub URL of the committed community file at `main`
 * (implementation note 2 in the issue), checked with the same
 * {@link checkPointer} routine as `seed-well-known.ts` before anything is
 * published. Re-running `publish` is safe for the same reason as there: a
 * version already on chain reports `AlreadyPublished` and counts as done.
 *
 * The published hash covers the pointer, so the committed file must carry
 * it. `stamp` writes it into any community spec lacking one; commit and push
 * the result to `main` before publishing.
 *
 * Usage:
 *   npx tsx scripts/seed-community.ts stamp
 *
 *   SOROBAN_CONTRACT_ID=... SOROBAN_INVOKER_SECRET=... \
 *     npx tsx scripts/seed-community.ts publish --dry-run
 *
 *   SOROBAN_CONTRACT_ID=... SOROBAN_INVOKER_SECRET=... \
 *     npx tsx scripts/seed-community.ts publish
 *
 * Run `--dry-run` first. It builds and simulates every transaction against
 * the live contract without signing or sending.
 *
 * Env:
 *   SOROBAN_CONTRACT_ID          - deployed registry contract ID (publish only)
 *   SOROBAN_INVOKER_SECRET       - publisher's secret key (publish only)
 *   SOROBAN_RPC_URL              - defaults to https://soroban-testnet.stellar.org
 *   SOROBAN_NETWORK_PASSPHRASE   - defaults to Networks.TESTNET
 *   COMMUNITY_POINTER_BASE_URL   - defaults to this repo's raw GitHub content
 *                                  for specs/community at main
 *   SKIP_POINTER_CHECK=1         - publish even if a pointer does not resolve
 */

import { readdirSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Networks, StrKey, Keypair } from "@stellar/stellar-sdk";
import { validateSpec, canonicalizeSpec } from "../src/spec.js";
import type { ContractSpec } from "../src/spec.js";
import { OnChainRegistryPublisher } from "../src/OnChainRegistryPublisher.js";
import { checkPointer, isAlreadyPublished, recordSeededSpecs } from "./seed-well-known.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMUNITY_DIR = resolve(__dirname, "../specs/community");
const DEPLOYED_TESTNET_JSON = resolve(__dirname, "../../../contracts/deployed.testnet.json");

const RPC_URL = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.SOROBAN_NETWORK_PASSPHRASE ?? Networks.TESTNET;

/**
 * Read at call time (not module load) so tests and one-shot overrides via
 * `COMMUNITY_POINTER_BASE_URL` take effect without re-importing the module.
 */
function pointerBaseUrl(): string {
  return (
    process.env.COMMUNITY_POINTER_BASE_URL ??
    "https://raw.githubusercontent.com/orbital-stellar/orbital_stellar/main/packages/abi-registry/specs/community"
  );
}

/** The registry pointer for a community spec: its committed file at `main`. */
export function communityPointer(contractId: string): string {
  return `${pointerBaseUrl()}/${contractId}.json`;
}

/**
 * Writes the registry pointer into every community spec file that lacks it.
 *
 * The published hash covers the pointer, so the file served at the pointer
 * must contain it too - otherwise no resolver can reproduce the on-chain
 * hash. Run this, commit and push the stamped files to `main`, then publish.
 * Returns the filenames that were changed.
 */
export function stampCommunityPointers(dir: string = COMMUNITY_DIR): string[] {
  let files: string[];
  try {
    files = readdirSync(dir).sort();
  } catch {
    return [];
  }
  const stamped: string[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.endsWith(".verdict.json")) continue;
    const parsed = readJson(resolve(dir, file));
    if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) continue;
    const spec = parsed.value as ContractSpec;
    if (!spec.contractId || spec.contractId !== basename(file, ".json")) continue;
    if (spec.pointer !== undefined) continue;
    const withPointer = { ...spec, pointer: communityPointer(spec.contractId) };
    writeFileSync(resolve(dir, file), `${JSON.stringify(withPointer, null, 2)}\n`, "utf-8");
    stamped.push(file);
  }
  return stamped;
}

/** A `<contractId>.verdict.json` file: `abi-registry verify --json` output. */
export type CommunityVerdict = {
  contractId?: string;
  status?: string;
  [key: string]: unknown;
};

/** One discovered community spec together with its publish decision. */
export type CommunityEntry = {
  /** Source filename, e.g. `CABC....json`. */
  file: string;
  /** Contract ID from the filename. */
  contractId: string;
  /** Validated spec with its registry pointer attached. */
  spec: ContractSpec;
  /** Parsed verdict file. */
  verdict: CommunityVerdict;
  /** True only when the verdict gate passes. */
  publishable: boolean;
  /** Why the entry was refused; present only when `publishable` is false. */
  refusalReason?: string;
};

/**
 * The verdict gate: only a `match` verdict may be published. Every other
 * status - `mismatch`, `unverifiable`, or anything unexpected - refuses.
 */
export function isPublishableVerdict(status: unknown): boolean {
  return status === "match";
}

function readJson(path: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    return {
      ok: false,
      reason: `cannot read file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return {
      ok: false,
      reason: `not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Discovers every community spec in `dir` and applies the verdict gate.
 *
 * Files are `<contractId>.json` (canonical {@link ContractSpec}) each paired
 * with a `<contractId>.verdict.json` (`abi-registry verify --json` output).
 * A missing directory reads as empty, so a fresh checkout with no
 * contributed specs is a successful no-op rather than an error.
 */
export function discoverCommunitySpecs(dir: string = COMMUNITY_DIR): CommunityEntry[] {
  let files: string[];
  try {
    files = readdirSync(dir).sort();
  } catch {
    return [];
  }

  const entries: CommunityEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.endsWith(".verdict.json")) continue;
    const contractId = basename(file, ".json");
    const refuse = (reason: string, spec?: ContractSpec, verdict?: CommunityVerdict): void => {
      entries.push({
        file,
        contractId,
        spec: spec ?? ({} as ContractSpec),
        verdict: verdict ?? {},
        publishable: false,
        refusalReason: reason,
      });
    };

    const parsed = readJson(resolve(dir, file));
    if (!parsed.ok) {
      refuse(`${file}: ${parsed.reason}`);
      continue;
    }
    const spec = parsed.value as ContractSpec;
    if (!spec.contractId || !StrKey.isValidContract(spec.contractId)) {
      refuse(`${file}: contract_id is missing or not a valid contract address`);
      continue;
    }
    if (spec.contractId !== contractId) {
      refuse(`${file}: filename does not match spec contract_id "${spec.contractId}"`);
      continue;
    }
    // The on-chain hash covers the whole canonical spec, pointer included, and
    // resolvers re-hash whatever the pointer serves. So the committed file
    // must carry the pointer itself (see the `stamp` phase); a file without
    // one gets it attached here so validation can run, and the pre-publish
    // pointer check then refuses it until the stamped file is on `main`.
    const expectedPointer = communityPointer(spec.contractId);
    if (spec.pointer !== undefined && spec.pointer !== expectedPointer) {
      refuse(`${file}: pointer "${String(spec.pointer)}" is not the expected "${expectedPointer}"`);
      continue;
    }
    const specWithPointer: ContractSpec = { ...spec, pointer: expectedPointer };
    const validation = validateSpec(specWithPointer);
    if (!validation.valid) {
      refuse(
        `${file}: spec failed validation:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}`,
        specWithPointer,
      );
      continue;
    }

    const verdictPath = resolve(dir, `${contractId}.verdict.json`);
    if (!existsSync(verdictPath)) {
      refuse(`${file}: missing verdict file ${contractId}.verdict.json`, specWithPointer);
      continue;
    }
    const verdictParsed = readJson(verdictPath);
    if (!verdictParsed.ok) {
      refuse(`${file}: verdict file unreadable: ${verdictParsed.reason}`, specWithPointer);
      continue;
    }
    const verdict = verdictParsed.value as CommunityVerdict;
    if (typeof verdict !== "object" || verdict === null) {
      refuse(`${file}: verdict file is not a JSON object`, specWithPointer, verdict);
      continue;
    }
    if (verdict.contractId !== undefined && verdict.contractId !== spec.contractId) {
      refuse(
        `${file}: verdict is for "${verdict.contractId}", not "${spec.contractId}"`,
        specWithPointer,
        verdict,
      );
      continue;
    }
    if (!isPublishableVerdict(verdict.status)) {
      refuse(
        `${file}: verdict is "${String(verdict.status)}", refusing (need "match")`,
        specWithPointer,
        verdict,
      );
      continue;
    }

    entries.push({ file, contractId, spec: specWithPointer, verdict, publishable: true });
  }

  return entries;
}

async function publish(dryRun: boolean): Promise<void> {
  const entries = discoverCommunitySpecs();

  if (entries.length === 0) {
    console.log("No community specs in specs/community/ - nothing to do.");
    return;
  }

  const contractId = process.env.SOROBAN_CONTRACT_ID;
  const invokerSecret = process.env.SOROBAN_INVOKER_SECRET;

  if (!contractId || !invokerSecret) {
    console.error(
      "seed-community: SOROBAN_CONTRACT_ID and SOROBAN_INVOKER_SECRET must both be set to publish.",
    );
    process.exit(1);
  }

  const publisher = new OnChainRegistryPublisher({
    contractId,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publisherSecret: invokerSecret,
    dryRun,
  });

  console.log(
    `==> ${dryRun ? "DRY RUN - simulating against" : "Publishing to"} ${contractId} via ${RPC_URL}\n`,
  );

  const published: string[] = [];
  const skipped: string[] = [];
  const failed: { name: string; reason: string }[] = [];
  const seeded: { contractId: string; name: string; version: string; specHash: string }[] = [];
  const publisherAddress = Keypair.fromSecret(invokerSecret).publicKey();

  for (const entry of entries) {
    const label = entry.publishable
      ? `${entry.spec.name} (${entry.contractId}) v${entry.spec.version}`
      : `${entry.file} (refused)`;
    if (!entry.publishable) {
      failed.push({ name: label, reason: entry.refusalReason ?? "refused by the verdict gate" });
      console.log(`  ✗ ${label}\n      ${entry.refusalReason ?? "refused by the verdict gate"}`);
      continue;
    }

    const spec = entry.spec;
    const fullLabel = `${spec.name} (${spec.contractId}) v${spec.version}`;
    // Same algorithm OnChainRegistryPublisher.publish hashes with - computed
    // once here so both the published and already-published paths below can
    // record it (publish() throws before returning on the latter path).
    const specHash = createHash("sha256").update(canonicalizeSpec(spec)).digest("hex");

    if (process.env.SKIP_POINTER_CHECK !== "1") {
      const pointerProblem = await checkPointer(spec);
      if (pointerProblem) {
        failed.push({ name: fullLabel, reason: pointerProblem });
        console.log(`  ✗ ${fullLabel}\n      ${pointerProblem}`);
        continue;
      }
    }

    try {
      const result = await publisher.publish(spec);
      published.push(fullLabel);
      console.log(
        `  ✓ ${fullLabel}\n      etag=${result.etag}${result.txHash ? ` tx=${result.txHash}` : " (simulated)"}`,
      );
      if (!dryRun) {
        seeded.push({
          contractId: spec.contractId!,
          name: spec.name,
          version: spec.version,
          specHash,
        });
      }
    } catch (err) {
      // Immutability per (contract_id, publisher, version) means a version
      // already on chain is the desired end state, not a failure - this is
      // what makes a partial run resumable.
      if (isAlreadyPublished(err)) {
        skipped.push(fullLabel);
        console.log(`  = ${fullLabel}\n      already published, skipping`);
        seeded.push({
          contractId: spec.contractId!,
          name: spec.name,
          version: spec.version,
          specHash,
        });
        continue;
      }
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ name: fullLabel, reason });
      console.log(`  ✗ ${fullLabel}\n      ${reason}`);
    }
  }

  console.log(
    `\n${dryRun ? "Dry run" : "Publish"} summary: ${published.length} ${
      dryRun ? "would publish" : "published"
    }, ${skipped.length} already on chain, ${failed.length} failed.`,
  );

  if (failed.length > 0) {
    console.error("\nFailures:");
    for (const f of failed) console.error(`  - ${f.name}: ${f.reason}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log("\nNothing was signed or sent. Re-run without --dry-run to publish.");
  } else if (seeded.length > 0) {
    recordSeededSpecs(seeded, publisherAddress);
    console.log(`\nRecorded ${seeded.length} spec hash(es) in ${DEPLOYED_TESTNET_JSON}.`);
  }
}

async function main(): Promise<void> {
  const phase = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  switch (phase) {
    case "stamp": {
      const stamped = stampCommunityPointers();
      for (const file of stamped) console.log(`==> Stamped pointer into ${file}`);
      console.log(
        stamped.length === 0
          ? "Every community spec already carries its pointer."
          : "\nCommit and push the stamped files to main, then run publish --dry-run.",
      );
      break;
    }
    case "publish":
      await publish(dryRun);
      break;
    default:
      console.error(
        "usage: seed-community.ts stamp | publish [--dry-run]\n\n" +
          "  stamp     write the registry pointer into community spec files lacking it\n" +
          "  publish   publish match-verdict community specs on chain; run with --dry-run first",
      );
      process.exit(2);
  }
}

// Only run as a CLI entrypoint, not when imported (e.g. by tests that need
// discoverCommunitySpecs without triggering the argv-driven publish flow and
// its process.exit calls).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Ensure the directory exists for a fresh checkout - an absent directory
  // reads as empty, but creating it keeps the layout discoverable.
  if (!existsSync(COMMUNITY_DIR)) {
    mkdirSync(COMMUNITY_DIR, { recursive: true });
  }
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
