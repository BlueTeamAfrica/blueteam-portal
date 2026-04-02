export async function markNotificationRead(idToken: string, tenantId: string, notificationId: string) {
  const res = await fetch("/api/notifications/mark-read", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tenantId, notificationId }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || `Mark read failed (${res.status})`);
  }
}

export async function markAllNotificationsRead(idToken: string, tenantId: string) {
  const res = await fetch("/api/notifications/mark-all-read", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tenantId }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || `Mark all read failed (${res.status})`);
  }
  return (await res.json()) as { updated?: number };
}
