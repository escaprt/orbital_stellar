/** Minimal span surface: set attributes, then end the span. */
export type Span = {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
};

/** Minimal tracer surface: start a named span with optional attributes. */
export type Tracer = {
  startSpan(name: string, attrs?: Record<string, string | number | boolean>): Span;
};

/** Outcome of a single delivery attempt. */
export type WebhookAttemptStatus = "success" | "failure";

/** Final outcome of a delivery after all attempts/retries are resolved. */
export type WebhookTerminalOutcome = "success" | "failure" | "dropped";

/** Recorder for per-URL delivery attempts and terminal outcomes. */
export type WebhookMetrics = {
  recordAttempt(
    url: string,
    attempt: number,
    durationMs: number,
    status: WebhookAttemptStatus,
  ): void;
  recordTerminal(url: string, outcome: WebhookTerminalOutcome): void;
};

/** Attribute bag attached to an OpenTelemetry counter/histogram data point. */
export type MetricAttributes = Record<string, string | number | boolean>;

/** Minimal counter surface: add a value with optional attributes. */
export type OtelCounter = {
  add(value: number, attributes?: MetricAttributes): void;
};

/** Minimal histogram surface: record a value with optional attributes. */
export type OtelHistogram = {
  record(value: number, attributes?: MetricAttributes): void;
};

/**
 * Minimal structural subset of `@opentelemetry/api`'s `Meter` interface,
 * mirroring this file's `Tracer`/`Span` pattern: a real OTel `Meter` (or any
 * compatible object) satisfies this type, so pulse-webhooks does not need a
 * hard dependency on `@opentelemetry/api`.
 */
export type Meter = {
  createCounter(name: string, options?: { description?: string }): OtelCounter;
  createHistogram(name: string, options?: { description?: string }): OtelHistogram;
};

/** One delivery target: its URL plus an optional per-URL timeout override. */
export type UrlEntry = { url: string; timeoutMs?: number };

/**
 * Delivery configuration for {@link WebhookDelivery}: targets and secret plus
 * retry, timeout, tracing, validation, metrics, and durable-queue options.
 */
export type WebhookConfig = {
  url: string | string[] | UrlEntry[];
  secret: string;
  retries?: number;
  deliveryTimeoutMs?: number;
  /** Maximum number of concurrent in-flight retries. Defaults to 100. */
  maxConcurrentRetries?: number;
  /** Maximum number of concurrent in-flight first-attempt deliveries. Defaults to 100. */
  maxConcurrentDeliveries?: number;
  /** Optional RNG for testing jitter. Defaults to `Math.random`. */
  random?: () => number;
  /** Retry delay strategy. Defaults to `exponentialJittered`. */
  backoff?: import("./backoff.js").BackoffStrategy;
  /** Optional OpenTelemetry-compatible tracer. When provided, one span is emitted per delivery attempt. */
  tracer?: Tracer;
  /** Optional custom URL validator for additional block-lists. Runs after built-in URL checks. Return an error message to reject, or null to allow. */
  urlValidator?: (url: string) => Promise<string | null>;
  /** Optional metrics recorder for per-URL delivery observability. */
  metrics?: WebhookMetrics;
  /**
   * Optional durable retry queue. When set, every retry is enqueued into
   * this queue instead of scheduled via setTimeout. A separate poller
   * dequeues records at `retryQueuePollIntervalMs` and drives delivery.
   * Persists retries across restarts when backed by a durable store.
   */
  retryQueue?: import("./RetryQueue.js").RetryQueue;
  /** Poll interval for the retry queue dequeue loop. Defaults to 1000ms. */
  retryQueuePollIntervalMs?: number;
};

export const DEFAULT_MAX_AGE_MS = 300_000;
export const DEFAULT_CLOCK_SKEW_MS = 30_000;

/** Webhook signature envelope version accepted by the verifier. */
export type VerifierSignatureVersion = "v1" | "v2";

/** Verification options for `verifyWebhook` / `verifyWebhookRaw`: freshness window, clock, version, schema, and size cap. */
export type VerifyWebhookOptions = {
  /** Reject signatures older than this age in milliseconds. Defaults to 300_000 (5 minutes). */
  maxAgeMs?: number;
  /** Clock skew allowance in milliseconds for sender/receiver clock differences. Defaults to 30_000. */
  clockSkewMs?: number;
  /** Override current time for testing. Defaults to Date.now(). */
  nowMs?: number;
  /** Signature version selector. `v2` is a reserved placeholder for a future x-orbital-signature-v2 format. Defaults to `v1`. */
  version?: VerifierSignatureVersion;
  /** Optional schema hook to validate the parsed `NormalizedEvent`. When provided, the verifier
   *  will run this after signature verification and return `null` if it returns `false`.
   */
  schema?: (event: import("@orbital-stellar/pulse-core").NormalizedEvent) => boolean;
  /** Maximum payload size in bytes. Defaults to 100_000 (≈100 KB). */
  maxBodyBytes?: number;
};
