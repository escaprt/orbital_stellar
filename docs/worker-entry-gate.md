# Phase 4 — Worker entry-gate tracker (§C.9)

> In-repo mirror of GitHub issue **#1037**. The four §C.9 gates are tracked here
> so their state is visible in review rather than only inside `ORBITAL_PRD.md`,
> and so a contributor who picks up a blocked worker issue can see in one click
> *why* it is blocked.
>
> This file is the tracker body. The canonical issue is #1037 on the tracker;
> this copy exists so the gate state is reviewable in a PR and gets the same
> audit as code. Evidence below was re-verified against `main` at commit time,
> not against the PRD (which reflects `ca0a51c` and is stale).

**Closing rule.** This issue closes only when **all four** gates below are
checked. Shipping `W0` (the worker standard) does **not** close it.

**Blocking rule.** Every issue in majors 19–22 names #1037 as its blocker.

---

## The four §C.9 gates

### Gate 1 — Phase 2 closed (registry live + ≥25 verified schemas)

- [ ] **Gate 1 met**

Evidence (re-verified against the repo):

- Open Phase 2 issues that still block it, per the issue spec:
  - #908 — (tracked on the issue tracker; status not resolvable from this repo)
  - #913 — (tracked on the issue tracker; status not resolvable from this repo)
  - #915 — (tracked on the issue tracker; status not resolvable from this repo)
  These are not closable from this repository; their state lives on the tracker.
- **≥25 verified schemas leg — counted, NOT MET.** Rows in the registry source
  (`packages/abi-registry/specs/well-known/index.json`) = **5** published specs
  (SAC interface, native XLM wrapper, USDC, EURC, AQUA). Four of those five
  (native XLM wrapper, USDC, EURC, AQUA) are the bundled seeded SAC specs from
  `contracts/deployed.testnet.json`'s `seededSpecs` — `ROADMAP.md` Wave 2.4's
  verification pipeline (cross-checking a submitted schema against on-chain
  `contractspec`) has not shipped, so these four are **unverifiable in this
  checkout and do not count** toward the verified-schema total. That leaves no
  more than the single generic SAC-interface entry as a candidate, and even it
  has not gone through a verification pipeline. `0 < 25` (at best `1 < 25`),
  so this leg fails regardless. See milestone
  [Worker gate 1 - 25 verified schemas](https://github.com/orbital-stellar/orbital_stellar/milestone/15)
  for the tracked target.
- **Deploy leg — MET (repo moved past the PRD).**
  `contracts/deployed.testnet.json` (deployedAt `2026-09-06`) contains a live
  `registry` contract (`CDJGK3KJMLQK6EVGOMIOQT35IFT2BTDVWC4ICEAXR7WBFTDGOP7FGXCV`)
  and `demoEmitter`. The "deploy to testnet" blocker from `ROADMAP.md` Wave 2.0
  is resolved in this checkout.

**Verdict: NOT MET** — blocked by the open Phase 2 issues and by the
verified-schema count (0-1, seeded SACs unverifiable, vs. the `≥25` target);
see milestone [Worker gate 1 - 25 verified schemas](https://github.com/orbital-stellar/orbital_stellar/milestone/15).

### Gate 2 — Publication (`v1.0.0` + `@orbital-stellar/anchor-sdk` on npm)

- [ ] **Gate 2 met**

Evidence:

- `v1.0.0`: **NOT MET.** No `v1.0.0` git tag exists (`v0.1.0` and `v0.2.0` are
  the only versioned releases). `ROADMAP.md` Phase 1 is still "in progress"
  (Waves 1.4–1.5 outstanding).
- `@orbital-stellar/anchor-sdk` publication: **MET.** `packages/anchor-sdk`'s
  `package.json` `version` is `0.2.0`, and `@orbital-stellar/anchor-sdk@0.2.0`
  is published on npm (Phase 3 release gate: "`anchor-sdk` on npm").

**Verdict: NOT MET** — `anchor-sdk@0.2.0` is on npm, but `v1.0.0` is still
outstanding (no `v1.0.0` git tag exists yet).

### Gate 3 — Named counterparty (binding constraint, §D.2)

- [ ] **Gate 3 met**

Evidence:

- Counterparty: **Aether Settlement** (a registered Stellar anchor / settlement
  desk). Named in the #1036 unfreeze rationale ([`CHANGELOG.md` dated
  2026-08-30](../../CHANGELOG.md)) as the counterparty that motivated the
  unfreeze, and wired to worker gate `W3` in
  [`ROADMAP.md` Phase 4](../../ROADMAP.md#phase-4--workers-entry-gate).
- This is the **binding constraint on the entire roadmap (§D.2)**: it cannot be
  delegated, and no amount of code substitutes for it.
- **Sub-gate status: NOT MET.** The actual `W3` sign-off — Aether Settlement
  confirming a production settlement flow runs worker-triggered and
  vault-custodied — is not yet recorded. Until that sign-off lands, this gate is
  functionally "named, but not cleared." If the maintainer does not treat Aether
  Settlement as a firm commitment, this gate should read **"none yet"** rather
  than an aspirational counterparty.

**Verdict: NAMED but NOT CLEARED** (binding sub-gate outstanding).

### Gate 4 — Go/no-go external input (§D.5: Nectar Network)

- [ ] **Gate 4 met**

Evidence:

- **No in-repo record of the §D.5 go/no-go.** Whether **Nectar Network** stalls
  or ships to mainnet changes the answer to this gate, and that input is not
  present anywhere in this repository (no `Nectar`, no `§D.5` artifact).
- Per the issue's instruction to avoid aspirational text: this gate is recorded
  as **UNKNOWN / NOT MET**, not approximated. The maintainer must supply the
  §D.5 determination (Nectar Network stalls vs. mainnet ship) before this gate
  can be checked.

**Verdict: NOT MET (input outstanding).**

---

## Summary

| Gate | Status | One-line evidence |
|---|---|---|
| 1 — Phase 2 closed | ❌ NOT MET | #908/#913/#915 open; 4 of 5 specs are unverifiable seeded SACs, 0-1 verified (`<25`); registry deployed ✅ |
| 2 — Publication | ❌ NOT MET | no `v1.0.0` tag; `anchor-sdk@0.2.0` on npm ✅ |
| 3 — Counterparty | ⚠️ NAMED, not cleared | Aether Settlement named (#1036); `W3` sign-off pending (binding) |
| 4 — §D.5 go/no-go | ❌ NOT MET | Nectar Network status not in repo; input outstanding |

**Issue closes only when all four gates are checked — not when `W0` ships.**
