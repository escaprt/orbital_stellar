/**
 * Raw Soroban `getEvents` event record: the emitting `contractId`, the
 * `topic` discriminant array, the `value` payload (base64 XDR string, `{ xdr
 * }` envelope, or decoded object depending on the caller), and ledger
 * context (`ledger`, `ledgerClosedAt`, `txHash`).
 */
export interface RawSorobanEvent {
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  id: string;
  pagingToken: string;
  topic: string[];
  value: string | { xdr: string } | Record<string, unknown>;
  txHash: string;
  inSuccessfulContractCall: boolean;
}
