"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";
import { getManagedServiceDisplayName } from "@/lib/serviceDisplayName";

export default function ClientsPage() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [clients, setClients] = useState<{ id: string; name?: string; email?: string; status?: string }[]>([]);
  const [servicesByClient, setServicesByClient] = useState<
    Record<string, Array<{ id: string; name?: string; category?: string; categoryLabel?: string }>>
  >({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const tenantId = tenant?.id;
    if (!user || !tenantId) {
      setLoading(false);
      return;
    }

    async function loadClients() {
      setLoading(true);
      try {
        const [clientsSnap, servicesSnap] = await Promise.all([
          getDocs(collection(db, "tenants", tenantId as string, "clients")),
          getDocs(collection(db, "tenants", tenantId as string, "services")),
        ]);
        setClients(
          clientsSnap.docs.map((d) => ({
            id: d.id,
            name: d.data().name,
            email: d.data().email,
            status: d.data().status,
          }))
        );
        const grouped: Record<
          string,
          Array<{ id: string; name?: string; category?: string; categoryLabel?: string }>
        > = {};
        for (const d of servicesSnap.docs) {
          const data = d.data() as { clientId?: string; name?: string; categoryLabel?: string; category?: string };
          const cid = data.clientId ?? "";
          if (!cid) continue;
          if (!grouped[cid]) grouped[cid] = [];
          grouped[cid].push({
            id: d.id,
            name: data.name,
            category: data.category,
            categoryLabel: data.categoryLabel,
          });
        }
        setServicesByClient(grouped);
      } finally {
        setLoading(false);
      }
    }

    loadClients();
  }, [user, tenant?.id]);

  async function handleAddClient(e: React.FormEvent) {
    e.preventDefault();
    const tenantId = tenant?.id;
    if (!tenantId) return;
    if (!name.trim() || !email.trim()) return;

    setSubmitting(true);
    try {
      await addDoc(collection(db, "tenants", tenantId, "clients"), {
        name: name.trim(),
        email: email.trim(),
        status: "active",
        createdAt: serverTimestamp(),
      });

      setName("");
      setEmail("");
      setShowForm(false);

      const [clientsSnap, servicesSnap] = await Promise.all([
        getDocs(collection(db, "tenants", tenantId as string, "clients")),
        getDocs(collection(db, "tenants", tenantId as string, "services")),
      ]);
      setClients(
        clientsSnap.docs.map((d) => ({
          id: d.id,
          name: d.data().name,
          email: d.data().email,
          status: d.data().status,
        }))
      );
      const grouped: Record<
        string,
        Array<{ id: string; name?: string; category?: string; categoryLabel?: string }>
      > = {};
      for (const d of servicesSnap.docs) {
        const data = d.data() as { clientId?: string; name?: string; categoryLabel?: string; category?: string };
        const cid = data.clientId ?? "";
        if (!cid) continue;
        if (!grouped[cid]) grouped[cid] = [];
        grouped[cid].push({
          id: d.id,
          name: data.name,
          category: data.category,
          categoryLabel: data.categoryLabel,
        });
      }
      setServicesByClient(grouped);
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (loading) return <p className="text-[#0F172A]">Loading clients…</p>;

  return (
    <div className="max-w-full min-w-0">
      <h1 className="text-[#0F172A] text-xl sm:text-2xl font-semibold break-words">Clients</h1>

      <div className="mt-3 mb-3 md:mt-4 md:mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 rounded-lg bg-[#4F46E5] text-white font-medium hover:bg-indigo-600 transition-colors"
        >
          ➕ Add Client
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAddClient} className="mb-4 md:mb-6 flex flex-wrap gap-3 items-center bg-white rounded-xl shadow-sm border border-slate-200 p-4 max-w-full">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full min-w-0 sm:min-w-[200px] px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] placeholder:text-slate-400"
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full min-w-0 sm:min-w-[220px] px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors"
          >
            {submitting ? "Adding…" : "Save"}
          </button>
        </form>
      )}

      {clients.length > 0 ? (
        <>
          <div className="md:hidden mt-4 space-y-3">
            {clients.map((client) => (
              <div key={client.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="font-semibold text-[#0F172A]">{client.name ?? "—"}</p>
                <p className="text-sm text-slate-600 mt-0.5 break-all">{client.email ?? "—"}</p>
                <p className="text-xs text-slate-500 mt-2">
                  Status: <span className="font-medium text-[#0F172A]">{client.status ?? "—"}</span>
                </p>
                <div className="mt-3 pt-3 border-t border-slate-100">
                  {servicesByClient[client.id]?.length ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                        Services ({servicesByClient[client.id].length})
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {servicesByClient[client.id].slice(0, 4).map((s) => (
                          <span
                            key={s.id}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700"
                          >
                            {getManagedServiceDisplayName({
                              name: s.name,
                              category: s.category,
                              categoryLabel: s.categoryLabel,
                            })}
                          </span>
                        ))}
                        {servicesByClient[client.id].length > 4 ? (
                          <span className="text-xs text-slate-500 self-center">
                            +{servicesByClient[client.id].length - 4} more
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">No linked services</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-w-full">
            <div className="w-full overflow-x-auto">
              <table className="min-w-[980px] w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Name</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Email</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Services</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((client) => (
                    <tr key={client.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 px-4 text-[#0F172A]">{client.name ?? "—"}</td>
                      <td className="py-3 px-4 text-[#0F172A]">{client.email ?? "—"}</td>
                      <td className="py-3 px-4 text-[#0F172A]">
                        {servicesByClient[client.id]?.length ? (
                          <div className="space-y-1">
                            <p className="text-xs text-slate-500">
                              {servicesByClient[client.id].length} service
                              {servicesByClient[client.id].length === 1 ? "" : "s"}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {servicesByClient[client.id].slice(0, 3).map((s) => (
                                <span
                                  key={s.id}
                                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700"
                                >
                                  {getManagedServiceDisplayName({
                                    name: s.name,
                                    category: s.category,
                                    categoryLabel: s.categoryLabel,
                                  })}
                                </span>
                              ))}
                              {servicesByClient[client.id].length > 3 ? (
                                <span className="text-xs text-slate-500">
                                  +{servicesByClient[client.id].length - 3} more
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500 text-sm">No services</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-[#0F172A]">{client.status ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
      {clients.length === 0 && <p className="mt-4 text-slate-500">No clients.</p>}
    </div>
  );
}
