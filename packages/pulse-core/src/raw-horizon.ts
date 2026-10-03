/**
 * Raw (un-normalized) Horizon API response types.
 *
 * Auto-generated types from the Horizon OpenAPI description are available from
 * `_raw-horizon.gen.ts` (do not edit that file directly) and re-exported here
 * for convenience.
 *
 * PERMANENT STATE (verified against the generated output, issue 16.3): of the
 * 12 hand-written `RawHorizon*` operation interfaces below, Horizon's OpenAPI
 * description only names THREE matching schemas at all - `CreateAccount`,
 * `AccountMerge`, and `Payment` - not just the two (`SetOptions`,
 * `ManageSellOffer`) originally assumed. The other nine
 * (`ManageBuyOffer`, `BumpSequence`, `ManageData`, `ChangeTrust`,
 * `CreateClaimableBalance`, `ClaimClaimableBalance`, `LiquidityPoolDeposit`,
 * `LiquidityPoolWithdraw`, `AllowTrust`, `SetTrustLineFlags`, plus
 * `SetOptions` and `ManageSellOffer`) have no generated counterpart
 * whatsoever - not a naming difference, they are absent from the spec - and
 * stay hand-written permanently; there is nothing to migrate them to.
 *
 * Of the three that exist, only `CreateAccount` and `AccountMerge` model a
 * single operation record the way the hand-written interfaces need - those
 * two are migrated below, picking their per-field types from the generated
 * schema so a future Horizon spec change flows through automatically, while
 * keeping the literal `type` discriminant and required `_links` this
 * package's consumers already depend on. The generated `Payment` schema is
 * NOT migrated: it models the `/payments` collection endpoint's envelope
 * (`_embedded.records[]`), not a bare operation record, and its `asset_code`
 * is typed as an enum of asset *type* strings (`"native" |
 * "credit_alphanum4" | "credit_alphanum12"`) - which is what `asset_type`
 * holds, not `asset_code` - so it does not safely back `RawHorizonPayment`.
 * `RawHorizonPayment` stays hand-written until Horizon's own OpenAPI
 * description fixes that mismatch.
 *
 * To regenerate:  node scripts/generate-horizon-types.mjs
 */

// ---------------------------------------------------------------------------
// Re-export generated Horizon OpenAPI component types
// ---------------------------------------------------------------------------
export type { components, operations, paths } from "./_raw-horizon.gen.js";

import type { components as _HorizonComponents } from "./_raw-horizon.gen.js";

// ---------------------------------------------------------------------------
// Hand-written raw operation interfaces (kept where the OpenAPI spec does not
// model the operation, or models it in a shape unsafe to reuse - see header)
// ---------------------------------------------------------------------------

/**
 * The transaction record Horizon embeds on each operation when a request asks
 * for `join=transactions`. Only the fields this package reads are modeled;
 * Horizon returns the full transaction resource.
 */
export interface RawHorizonJoinedTransaction {
  hash: string;
  /** Ledger sequence the transaction was included in. */
  ledger: number;
  /** Present as `null`/absent when `memo_type` is `"none"`. */
  memo?: string | null;
  memo_type?: string;
  successful?: boolean;
  [key: string]: unknown;
}

/**
 * Fields every raw Horizon operation record carries: identity
 * (`id`/`paging_token`), the owning transaction, the source account, the
 * numeric `type_i` discriminator, and the `_links` navigation block.
 * Base interface for all `RawHorizon*` operation types below.
 */
export interface RawHorizonBaseOperation {
  id: string;
  paging_token: string;
  transaction_successful: boolean;
  /**
   * Hash of the transaction this operation belongs to. Horizon returns it on
   * every operation record, with or without `join=transactions`.
   */
  transaction_hash: string;
  source_account: string;
  created_at: string;
  type_i: number;
  /**
   * The full transaction, present only when the request asked for
   * `join=transactions`. Source of `ledger` and `memo`, which live on the
   * transaction rather than the operation.
   */
  transaction?: RawHorizonJoinedTransaction;
  _links: {
    self: { href: string };
    transaction: { href: string };
    effects: { href: string };
    succeeds: { href: string };
    precedes: { href: string };
  };
}

/**
 * Raw Horizon `payment` operation record: sender (`from`), receiver (`to`),
 * string-encoded `amount`, and the asset triple (`asset_type` plus
 * `asset_code`/`asset_issuer` for non-native assets).
 */
export interface RawHorizonPayment extends RawHorizonBaseOperation {
  type: "payment";
  to: string;
  from: string;
  amount: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

/**
 * Raw Horizon `set_options` operation record: account option changes such as
 * signers, thresholds, `home_domain`, set/clear flags, and `inflation_dest`.
 * Only the options the transaction touched are present.
 */
export interface RawHorizonSetOptions extends RawHorizonBaseOperation {
  type: "set_options";
  signer_key?: string;
  signer_weight?: number;
  low_threshold?: number;
  med_threshold?: number;
  high_threshold?: number;
  master_key_weight?: number;
  home_domain?: string;
  set_flags?: number[];
  clear_flags?: number[];
  inflation_dest?: string;
}

/** Field types sourced from the generated `CreateAccount` schema - see header. */
type _GeneratedCreateAccount = _HorizonComponents["schemas"]["CreateAccount"];

/**
 * Raw Horizon `create_account` operation record: the `funder`, the new
 * `account`, and the string-encoded `starting_balance`.
 */
export interface RawHorizonCreateAccount extends RawHorizonBaseOperation {
  type: "create_account";
  funder: _GeneratedCreateAccount["funder"];
  account: _GeneratedCreateAccount["account"];
  starting_balance: _GeneratedCreateAccount["starting_balance"];
}

/**
 * Raw Horizon `manage_sell_offer` operation record: the offer being managed
 * (`offer_id`, `0` for a new offer), the amount and both asset legs, and the
 * `price`/`price_r` ratio. Amounts may arrive as strings or numbers.
 */
export interface RawHorizonManageSellOffer extends RawHorizonBaseOperation {
  type: "manage_sell_offer";
  offer_id: string | number;
  amount: string | number;
  buying_asset_type: string;
  buying_asset_code?: string;
  buying_asset_issuer?: string;
  selling_asset_type: string;
  selling_asset_code?: string;
  selling_asset_issuer?: string;
  price: string;
  price_r: { n: number; d: number };
}

/**
 * Raw Horizon `manage_buy_offer` operation record: same shape as
 * {@link RawHorizonManageSellOffer} but priced from the buying side.
 */
export interface RawHorizonManageBuyOffer extends RawHorizonBaseOperation {
  type: "manage_buy_offer";
  offer_id: string | number;
  amount: string | number;
  buying_asset_type: string;
  buying_asset_code?: string;
  buying_asset_issuer?: string;
  selling_asset_type: string;
  selling_asset_code?: string;
  selling_asset_issuer?: string;
  price: string;
  price_r: { n: number; d: number };
}

/**
 * Raw Horizon `bump_sequence` operation record: the string-encoded ledger
 * sequence the source account is bumped to (`bump_to`).
 */
export interface RawHorizonBumpSequence extends RawHorizonBaseOperation {
  type: "bump_sequence";
  bump_to: string;
}

/**
 * Raw Horizon `manage_data` operation record: the `data_name` key and its
 * base64 `data_value`, which is `null` when the entry is removed.
 */
export interface RawHorizonManageData extends RawHorizonBaseOperation {
  type: "manage_data";
  data_name: string;
  data_value: string | null;
}

/**
 * Raw Horizon `change_trust` operation record: the trustline `limit` and the
 * asset triple. A zero limit removes the trustline.
 */
export interface RawHorizonChangeTrust extends RawHorizonBaseOperation {
  type: "change_trust";
  limit: string | number;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

/** Field types sourced from the generated `AccountMerge` schema - see header. */
type _GeneratedAccountMerge = _HorizonComponents["schemas"]["AccountMerge"];

/**
 * Raw Horizon `account_merge` operation record: the merged `account` and the
 * `into` destination receiving its balance.
 */
export interface RawHorizonAccountMerge extends RawHorizonBaseOperation {
  type: "account_merge";
  account: _GeneratedAccountMerge["account"];
  into: _GeneratedAccountMerge["into"];
}

/**
 * Raw Horizon `create_claimable_balance` operation record: the funded
 * `amount`, the resulting `balance_id`, the `claimants` with their
 * predicates, and the asset triple.
 */
export interface RawHorizonCreateClaimableBalance extends RawHorizonBaseOperation {
  type: "create_claimable_balance";
  amount: string;
  balance_id: string;
  claimants: Array<{ destination: string; predicate: unknown }>;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

/**
 * Raw Horizon `claim_claimable_balance` operation record: the `balance_id`
 * the claimant swept. The claimant is the operation's `source_account`.
 */
export interface RawHorizonClaimClaimableBalance extends RawHorizonBaseOperation {
  type: "claim_claimable_balance";
  balance_id: string;
}

/**
 * Raw Horizon `liquidity_pool_deposit` operation record: the pool, the
 * `shares_received`, and the per-asset `reserves_deposited`.
 */
export interface RawHorizonLiquidityPoolDeposit extends RawHorizonBaseOperation {
  type: "liquidity_pool_deposit";
  liquidity_pool_id: string;
  shares_received: string;
  reserves_deposited: Array<{ asset: string; amount: string }>;
}

/**
 * Raw Horizon `liquidity_pool_withdraw` operation record: the pool, the
 * redeemed `shares`, and the per-asset `reserves_received`.
 */
export interface RawHorizonLiquidityPoolWithdraw extends RawHorizonBaseOperation {
  type: "liquidity_pool_withdraw";
  liquidity_pool_id: string;
  shares: string;
  reserves_received: Array<{ asset: string; amount: string }>;
}

/**
 * Raw Horizon `allow_trust` operation record: the `trustor` whose trustline
 * is authorized (`authorize`) for the asset, issued by `trustee`.
 */
export interface RawHorizonAllowTrust extends RawHorizonBaseOperation {
  type: "allow_trust";
  trustor: string;
  trustee?: string;
  authorize: boolean;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

/**
 * Raw Horizon `set_trust_line_flags` operation record: the `trustor` trustline
 * and the string-named flags being set or cleared for the asset.
 */
export interface RawHorizonSetTrustLineFlags extends RawHorizonBaseOperation {
  type: "set_trust_line_flags";
  trustor: string;
  set_flags_s?: string[];
  clear_flags_s?: string[];
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}
