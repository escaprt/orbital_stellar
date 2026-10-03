import { useState, useEffect, useRef, useCallback } from "react";
import type { ContractEmittedEvent } from "@orbital-stellar/pulse-core";
import { acquireEventConnection } from "./connectionPool.js";

/**
 * Options for {@link useContractState}.
 */
export type ContractStateOptions = {
  /** How often to re-fetch the ledger entry. Defaults to 10000 ms. */
  pollIntervalMs?: number;
  /** When set, also refetch as soon as a matching `contract.emitted` event arrives */
  autoRefreshOn?: {
    /** Base URL of the pulse-notify server */
    serverUrl: string;
    /** Contract address to subscribe to (used as the connection's address) */
    contractId: string;
    /** Only refetch for `contract.emitted` events this predicate accepts */
    filter?: (event: ContractEmittedEvent) => boolean;
    /** API key forwarded as ?token= query param */
    token?: string;
  };
  /** Extra headers sent with the Soroban RPC POST (e.g. bearer auth) */
  headers?: Record<string, string>;
};

/**
 * State returned by {@link useContractState}.
 *
 * @typeParam T - Expected shape of the ledger entry. The RPC response is
 *   passed through unvalidated, so narrow it yourself before relying on it.
 */
export type ContractStateResult<T = unknown> = {
  /** Latest ledger entry, or null before the first successful fetch */
  data: T | null;
  /** True while a fetch is in flight */
  loading: boolean;
  /** Human-readable error message, or null when the last fetch succeeded */
  error: string | null;
  /** Triggers an immediate re-fetch, cancelling any in-flight request */
  refetch: () => void;
};

async function getLedgerEntry(
  rpcUrl: string,
  key: string,
  headers: Record<string, string> | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getLedgerEntry",
      params: { key },
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Soroban RPC request failed: ${response.status} ${response.statusText}`);
  }

  const json: { result?: unknown; error?: { message?: string } } = await response.json();
  if (json.error) {
    throw new Error(json.error.message ?? "Soroban RPC returned an error");
  }
  return json.result;
}

/**
 * Reads a single contract ledger entry from a Soroban RPC endpoint and keeps
 * it fresh, so a component can render live contract state without wiring up an
 * event subscription itself.
 *
 * @param rpcUrl    - Base URL of the Soroban RPC endpoint.
 * @param contractId - Soroban contract address (C…) that owns the entry.
 * @param key       - Ledger key to fetch, sent verbatim as the RPC `key` param.
 * @param options   - Poll interval, event-driven auto-refresh and extra RPC headers.
 * @returns The latest entry with loading/error flags and a `refetch()` trigger.
 *
 * @example
 * const { data, loading, error } = useContractState<Balance>(
 *   "https://soroban-testnet.stellar.org",
 *   contractId,
 *   ledgerKey,
 * );
 */
export function useContractState<T = unknown>(
  rpcUrl: string,
  contractId: string,
  key: string,
  options?: ContractStateOptions,
): ContractStateResult<T> {
  const pollIntervalMs = options?.pollIntervalMs ?? 10_000;
  const autoRefreshOn = options?.autoRefreshOn;
  const headers = options?.headers;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const headersRef = useRef(headers);
  useEffect(() => {
    headersRef.current = headers;
  });

  const autoRefreshFilterRef = useRef(autoRefreshOn?.filter);
  useEffect(() => {
    autoRefreshFilterRef.current = autoRefreshOn?.filter;
  });

  const fetchState = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const result = await getLedgerEntry(rpcUrl, key, headersRef.current, controller.signal);
      if (!controller.signal.aborted) {
        setData(result as T);
        setLoading(false);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [rpcUrl, key]);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, pollIntervalMs);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [fetchState, pollIntervalMs]);

  const autoRefreshServerUrl = autoRefreshOn?.serverUrl;
  const autoRefreshContractId = autoRefreshOn?.contractId;
  const autoRefreshToken = autoRefreshOn?.token;

  useEffect(() => {
    if (!autoRefreshServerUrl || !autoRefreshContractId) return;

    const connection = acquireEventConnection(
      {
        serverUrl: autoRefreshServerUrl,
        address: autoRefreshContractId,
        token: autoRefreshToken,
      },
      {
        onOpen: () => {},
        onEvent: (event) => {
          if (event.type !== "contract.emitted") return;
          if (
            autoRefreshFilterRef.current &&
            !autoRefreshFilterRef.current(event as ContractEmittedEvent)
          ) {
            return;
          }
          fetchState();
        },
        onParseError: () => {},
        onError: () => {},
      },
    );

    return () => {
      connection.unsubscribe();
    };
  }, [autoRefreshServerUrl, autoRefreshContractId, autoRefreshToken, fetchState]);

  return { data, loading, error, refetch: fetchState };
}
