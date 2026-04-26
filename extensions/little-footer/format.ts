/**
 * Pure formatting helpers for the little-footer extension.
 */

/** Format token count with k/M suffixes. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    const formatted = k < 10_000 ? k.toFixed(1) : Math.round(k).toFixed(0);
    return `${formatted.replace(/\.0$/, "")}k`;
  }
  const m = n / 1_000_000;
  const formatted = m < 10_000 ? m.toFixed(1) : Math.round(m).toFixed(0);
  return `${formatted.replace(/\.0$/, "")}M`;
}

/** Format cost in USD. */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Format a percentage value. */
export function formatPercent(percent: number | null): string {
  if (percent === null) return "?";
  return `${percent.toFixed(1)}%`;
}

/** Extract basename from a file path, handling both Unix and Windows separators. */
export function formatPathBasename(cwd: string): string {
  const stripped = cwd.replace(/[\\/]+$/, "");
  const parts = stripped.split(/[\\/]/);
  const last = parts[parts.length - 1];
  return last || "/";
}

/** Sanitize extension status text for single-line display. */
export function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
