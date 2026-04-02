export function normalizeHealthToWaitingClient(health?: string) {
  const h = (health ?? "").trim().toLowerCase();
  return h === "waiting_client" || h === "waiting client" || h === "waiting-on-client";
}

export function isWaitingClientHealth(health?: string) {
  return normalizeHealthToWaitingClient(health);
}

export function getInvoiceEmphasis(status?: string) {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "unpaid") return "Unpaid";
  if (s === "overdue") return "Overdue";
  return null;
}

export function isUnpaidOrOverdueInvoice(status?: string) {
  const s = (status ?? "").trim().toLowerCase();
  return s === "unpaid" || s === "overdue";
}

export function isTicketReplyNeeded(status?: string) {
  const s = (status ?? "").trim().toLowerCase();
  return s === "waiting_client";
}

