function toDate(input: Date | { toDate: () => Date } | null | undefined): Date | null {
  if (!input) return null;
  if (input instanceof Date) return input;
  if (typeof (input as { toDate?: () => Date }).toDate === "function") {
    try {
      return (input as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

/** Short relative label for notification timestamps (English). */
export function formatRelativeTime(input: Date | { toDate: () => Date } | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  const now = Date.now();
  const diffMs = now - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
