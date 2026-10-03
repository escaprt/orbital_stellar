import { createElement, useEffect, useMemo, useState } from "react";
import { StellarEventBoundary } from "./StellarEventBoundary.js";
import type { ComponentPropsWithoutRef, CSSProperties, ReactElement } from "react";
import { acquireEventConnection } from "./connectionPool.js";

/** The connection states the status indicator can report. */
export type StellarConnectionStatusState = "connecting" | "connected" | "error";

/**
 * Overrides for the text shown in each {@link StellarConnectionStatusState}.
 * Omitted states fall back to the built-in labels ("Connecting",
 * "Connected", "Retrying").
 */
export type StellarConnectionStatusLabels = Partial<Record<StellarConnectionStatusState, string>>;

/**
 * Props for {@link StellarConnectionStatus}: the connection coordinates plus
 * the native `<span>` attributes to forward.
 */
export type StellarConnectionStatusProps = Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  /** Base URL of the pulse-notify server */
  serverUrl: string;
  /** Stellar account address whose connection health to display */
  address: string;
  /** API key forwarded as ?token= query param - required when the server has authentication enabled */
  token?: string;
  /** Text to show per state. Missing entries use the built-in labels. */
  labels?: StellarConnectionStatusLabels;
};

const DEFAULT_LABELS: Record<StellarConnectionStatusState, string> = {
  connecting: "Connecting",
  connected: "Connected",
  error: "Retrying",
};

const STATUS_COLORS: Record<StellarConnectionStatusState, string> = {
  connecting: "#b45309",
  connected: "#047857",
  error: "#b91c1c",
};

/**
 * Renders a small live connection indicator for one Stellar address - for
 * places that need "are we connected?" without wiring `connected` and `error`
 * state by hand.
 *
 * The component owns its connection lifecycle and exposes the state on the
 * DOM through `data-status` and a `stellar-connection-status--*` class.
 * Appearance is driven entirely by CSS custom properties; see the package
 * README for the full list.
 *
 * @param props - See {@link StellarConnectionStatusProps}.
 * @returns A `<span role="status">` with a state dot and the current label.
 *
 * @example
 * <StellarConnectionStatus serverUrl={serverUrl} address={address} />
 */
export function StellarConnectionStatus({
  serverUrl,
  address,
  token,
  labels,
  className,
  style,
  "aria-label": ariaLabel,
  ...spanProps
}: StellarConnectionStatusProps): ReactElement {
  const [status, setStatus] = useState<StellarConnectionStatusState>("connecting");

  useEffect(() => {
    if (!serverUrl || !address) {
      setStatus("error");
      return;
    }

    setStatus("connecting");

    const connection = acquireEventConnection(
      { serverUrl, address, token },
      {
        onOpen: () => setStatus("connected"),
        onEvent: () => {},
        onParseError: () => {},
        onError: () => setStatus("error"),
      },
    );

    return () => {
      connection.unsubscribe();
    };
  }, [serverUrl, address, token]);

  const label = labels?.[status] ?? DEFAULT_LABELS[status];
  const statusClassName = [
    "stellar-connection-status",
    `stellar-connection-status--${status}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const rootStyle = useMemo<CSSProperties>(
    () => ({
      alignItems: "center",
      background: `var(--stellar-connection-status-${status}-background, var(--stellar-connection-status-background, transparent))`,
      border: `var(--stellar-connection-status-${status}-border, var(--stellar-connection-status-border, 1px solid currentColor))`,
      borderRadius: "var(--stellar-connection-status-radius, 999px)",
      color: `var(--stellar-connection-status-${status}-color, var(--stellar-connection-status-color, ${STATUS_COLORS[status]}))`,
      display: "inline-flex",
      fontSize: "var(--stellar-connection-status-font-size, 0.875rem)",
      fontWeight: "var(--stellar-connection-status-font-weight, 500)",
      gap: "var(--stellar-connection-status-gap, 0.375rem)",
      lineHeight: "var(--stellar-connection-status-line-height, 1)",
      padding: "var(--stellar-connection-status-padding, 0.25rem 0.5rem)",
      ...style,
    }),
    [status, style],
  );

  const dotStyle = useMemo<CSSProperties>(
    () => ({
      background: `var(--stellar-connection-status-${status}-dot-color, var(--stellar-connection-status-dot-color, currentColor))`,
      borderRadius: "999px",
      display: "inline-block",
      height: "var(--stellar-connection-status-dot-size, 0.5rem)",
      width: "var(--stellar-connection-status-dot-size, 0.5rem)",
    }),
    [status],
  );

  return createElement(
    StellarEventBoundary,
    { fallback: null },
    createElement(
      "span",
      {
        ...spanProps,
        "aria-label": ariaLabel ?? `Stellar connection ${label}`,
        "aria-live": spanProps["aria-live"] ?? "polite",
        className: statusClassName,
        "data-status": status,
        role: spanProps.role ?? "status",
        style: rootStyle,
      },
      createElement("span", {
        "aria-hidden": true,
        className: "stellar-connection-status__dot",
        style: dotStyle,
      }),
      createElement("span", { className: "stellar-connection-status__label" }, label),
    ),
  );
}
