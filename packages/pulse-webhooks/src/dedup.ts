import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

/** Seen-id set backing {@link dedupReceiver}: `mark` records, `seen` checks. */
export interface DedupStore {
  seen(id: string): Promise<boolean>;
  mark(id: string): Promise<void>;
}

/** In-memory {@link DedupStore} for single-process receivers and tests. */
export class MemoryDedupStore implements DedupStore {
  private readonly ids = new Set<string>();

  async seen(id: string): Promise<boolean> {
    return this.ids.has(id);
  }

  async mark(id: string): Promise<void> {
    this.ids.add(id);
  }

  clear(): void {
    this.ids.clear();
  }
}

/** Options for {@link dedupReceiver}. */
export type DedupReceiverOptions = {
  idExtractor?: (event: NormalizedEvent) => string;
};

const DEFAULT_ID_EXTRACTOR = (event: NormalizedEvent): string => {
  const id = (event as Record<string, unknown>).raw as Record<string, unknown> | null | undefined;
  if (id != null && typeof id.id === "string") return id.id;
  throw new Error("dedupReceiver: event has no raw.id string - provide a custom idExtractor");
};

/**
 * Wraps an event handler so each event id is delivered at most once: repeats
 * already recorded in `store` are skipped, new ids are marked then handled.
 *
 * @param handler - Downstream event handler invoked once per unseen id.
 * @param store   - Seen-id set used to detect repeats.
 * @param options - Optional `idExtractor` (defaults to reading `raw.id`).
 * @returns A receiver function with the same handler signature.
 */
export function dedupReceiver(
  handler: (event: NormalizedEvent) => Promise<void>,
  store: DedupStore,
  options?: DedupReceiverOptions,
): (event: NormalizedEvent) => Promise<void> {
  const extractId = options?.idExtractor ?? DEFAULT_ID_EXTRACTOR;

  return async (event: NormalizedEvent): Promise<void> => {
    const id = extractId(event);
    if (await store.seen(id)) return;
    await store.mark(id);
    await handler(event);
  };
}
