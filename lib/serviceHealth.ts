/**
 * Normalized operational health for managed services (dashboard + detail pages).
 */

export type NormalizedServiceHealth =
  | "healthy"
  | "warning"
  | "critical"
  | "waiting_client"
  | "paused"
  | "";

export function normalizeServiceHealth(input?: string): NormalizedServiceHealth {
  const s = (input ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "healthy") return "healthy";
  if (s === "warning" || s === "warn") return "warning";
  if (s === "critical") return "critical";
  if (
    s === "waiting_client" ||
    s === "waiting client" ||
    s === "waiting-on-client"
  ) {
    return "waiting_client";
  }
  if (s === "paused") return "paused";
  return "";
}

export function getServiceHealthLabel(health?: string): string {
  const h = normalizeServiceHealth(health);
  if (h === "healthy") return "Healthy";
  if (h === "warning") return "Warning";
  if (h === "critical") return "Critical";
  if (h === "waiting_client") return "Waiting on Client";
  if (h === "paused") return "Paused";
  return "—";
}

/** Count bucket: unset / unknown → healthy (optimistic default for summaries). */
export function bucketServiceHealthForCounts(
  health?: string
): "healthy" | "warning" | "critical" | "waiting_client" | "paused" {
  const h = normalizeServiceHealth(health);
  if (h === "warning") return "warning";
  if (h === "critical") return "critical";
  if (h === "waiting_client") return "waiting_client";
  if (h === "paused") return "paused";
  if (h === "healthy") return "healthy";
  return "healthy";
}

export function isAttentionServiceHealth(health?: string): boolean {
  const h = normalizeServiceHealth(health);
  return h === "warning" || h === "critical" || h === "waiting_client";
}
