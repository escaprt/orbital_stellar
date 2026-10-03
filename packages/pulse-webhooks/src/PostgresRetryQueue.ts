import type { RetryQueue, RetryRecord } from "./RetryQueue.js";
import type { PgLike } from "./PostgresDeadLetterStore.js";

/** Options for {@link PostgresRetryQueue}: table name, clock, and visibility timeout. */
export type PostgresRetryQueueOptions = {
  /** Table name. Defaults to `pulse_webhook_retry_queue` (see `migrations/001_retry_queue.sql`). */
  tableName?: string;
  now?: () => number;
  /** How long a dequeued-but-unacked record stays locked before it's eligible for redequeue. Defaults to 30,000ms. */
  visibilityTimeoutMs?: number;
};

const DEFAULT_TABLE_NAME = "pulse_webhook_retry_queue";
const DEFAULT_VISIBILITY_TIMEOUT_MS = 30_000;

type RetryQueueRow = {
  id: string;
  event: unknown | string;
  url: string;
  attempt: number;
  next_retry_at: Date | string;
  locked_until: Date | string | null;
  last_error: string | null;
  created_at: Date | string | null;
  metadata: Record<string, unknown> | string | null;
};

/**
 * Postgres-backed `RetryQueue`. Multi-consumer-safe dequeue is implemented
 * as `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`: concurrent
 * consumers each lock and claim a different ready row in one atomic
 * statement, so no record is ever handed to two consumers at once.
 *
 * Requires the table created by `migrations/001_retry_queue.sql`.
 */
export class PostgresRetryQueue implements RetryQueue {
  private readonly tableSql: string;
  private readonly now: () => number;
  private readonly visibilityTimeoutMs: number;

  constructor(
    private readonly pg: PgLike,
    options: PostgresRetryQueueOptions = {},
  ) {
    this.tableSql = quoteIdentifier(options.tableName ?? DEFAULT_TABLE_NAME);
    this.now = options.now ?? Date.now;
    this.visibilityTimeoutMs = Math.max(
      1,
      Math.floor(options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS),
    );
  }

  async enqueue(record: RetryRecord): Promise<void> {
    this.assertRecord(record);

    await this.pg.query(
      `INSERT INTO ${this.tableSql}
         (id, event, url, attempt, next_retry_at, last_error, created_at, metadata)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         event = EXCLUDED.event,
         url = EXCLUDED.url,
         attempt = EXCLUDED.attempt,
         next_retry_at = EXCLUDED.next_retry_at,
         locked_until = NULL,
         last_error = EXCLUDED.last_error,
         metadata = EXCLUDED.metadata`,
      [
        record.id,
        JSON.stringify(record.event),
        record.url,
        record.attempt,
        toTimestamp(record.nextRetryAt),
        record.lastError ?? null,
        record.createdAt !== undefined ? toTimestamp(record.createdAt) : null,
        record.metadata !== undefined ? JSON.stringify(record.metadata) : null,
      ],
    );
  }

  async dequeue(nowMs = this.now()): Promise<RetryRecord | null> {
    const nowTs = toTimestamp(nowMs);
    const lockedUntilTs = toTimestamp(nowMs + this.visibilityTimeoutMs);

    const result = await this.pg.query<RetryQueueRow>(
      `UPDATE ${this.tableSql}
       SET locked_until = $2
       WHERE id = (
         SELECT id FROM ${this.tableSql}
         WHERE next_retry_at <= $1
           AND (locked_until IS NULL OR locked_until <= $1)
         ORDER BY next_retry_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, event, url, attempt, next_retry_at, locked_until, last_error, created_at, metadata`,
      [nowTs, lockedUntilTs],
    );

    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async ack(recordId: string): Promise<void> {
    await this.pg.query(`DELETE FROM ${this.tableSql} WHERE id = $1`, [recordId]);
  }

  async nack(recordId: string, requeueDelayMs: number): Promise<void> {
    const delayMs = Number.isFinite(requeueDelayMs) ? Math.max(0, Math.floor(requeueDelayMs)) : 0;
    const nextRetryAt = toTimestamp(this.now() + delayMs);

    await this.pg.query(
      `UPDATE ${this.tableSql}
       SET next_retry_at = $2, locked_until = NULL
       WHERE id = $1`,
      [recordId, nextRetryAt],
    );
  }

  async evictNewest(): Promise<RetryRecord | null> {
    const result = await this.pg.query<RetryQueueRow>(
      `DELETE FROM ${this.tableSql}
       WHERE id = (
         SELECT id FROM ${this.tableSql}
         WHERE locked_until IS NULL
         ORDER BY next_retry_at DESC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, event, url, attempt, next_retry_at, locked_until, last_error, created_at, metadata`,
    );

    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async size(): Promise<number> {
    const result = await this.pg.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM ${this.tableSql} WHERE locked_until IS NULL OR locked_until <= $1`,
      [toTimestamp(this.now())],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private assertRecord(record: RetryRecord): void {
    if (!record.id) {
      throw new Error("RetryRecord.id is required");
    }

    if (!Number.isFinite(record.nextRetryAt)) {
      throw new Error("RetryRecord.nextRetryAt must be a finite timestamp");
    }
  }
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid Postgres identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function toTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

function parseTimestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function mapRow(row: RetryQueueRow): RetryRecord {
  const record: RetryRecord = {
    id: row.id,
    event: typeof row.event === "string" ? JSON.parse(row.event) : row.event,
    url: row.url,
    attempt: row.attempt,
    nextRetryAt: parseTimestamp(row.next_retry_at),
  };

  if (row.last_error !== null) record.lastError = row.last_error;
  if (row.created_at !== null) record.createdAt = parseTimestamp(row.created_at);
  if (row.metadata !== null) {
    record.metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;
  }

  return record;
}
