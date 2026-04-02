import "server-only";
import { createHash } from "crypto";

/**
 * Fields that affect what the client sees on the invoice / PDF / portal.
 * Internal bookkeeping (dedupe timestamps, hashes, etc.) is excluded by omission.
 */
export const CLIENT_VISIBLE_INVOICE_FIELDS = [
  "invoiceNumber",
  "number",
  "dueDate",
  "status",
  "currency",
  "amount",
  "subtotal",
  "total",
  "tax",
  "taxAmount",
  "notes",
  "lineItems",
  "title",
  "clientId",
  "clientName",
  "issueDate",
] as const;

export type ClientVisibleInvoiceField = (typeof CLIENT_VISIBLE_INVOICE_FIELDS)[number];

function normalizeForSignature(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "object" && value !== null && "toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function") {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((v) => normalizeForSignature(v));
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = normalizeForSignature(o[k]);
    }
    return out;
  }
  return String(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((x) => stableStringify(x)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Deterministic hash of client-visible invoice content (for meaningful-change detection + dedupe). */
export function clientVisibleInvoiceSignature(data: Record<string, unknown> | null | undefined): string {
  if (!data) {
    return createHash("sha256").update("").digest("hex");
  }
  const picked: Record<string, unknown> = {};
  for (const k of CLIENT_VISIBLE_INVOICE_FIELDS) {
    if (!(k in data)) continue;
    picked[k] = normalizeForSignature(data[k]);
  }
  return createHash("sha256").update(stableStringify(picked)).digest("hex");
}

export function hasMeaningfulClientVisibleInvoiceChange(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): boolean {
  return clientVisibleInvoiceSignature(before) !== clientVisibleInvoiceSignature(after);
}
