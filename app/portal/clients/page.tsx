"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { useTenant } from "@/lib/tenantContext";

export default function ClientsPage() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [clients, setClients] = useState<{ id: string; name?: string; email?: string; status?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user || !tenant?.id) {
      setLoading(false);
      return;
    }

    async function loadClients() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "tenants", tenant.id, "clients"));
        setClients(
          snap.docs.map((d) => ({
            id: d.id,
            name: d.data().name,
            email: d.data().email,
            status: d.data().status,
          }))
        );
      } finally {
        setLoading(false);
      }
    }

    loadClients();
  }, [user, tenant?.id]);

  async function handleAddClient(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant?.id) return;
    if (!name.trim() || !email.trim()) return;

    setSubmitting(true);
    try {
      await addDoc(collection(db, "tenants", tenant.id, "clients"), {
        name: name.trim(),
        email: email.trim(),
        status: "active",
        createdAt: serverTimestamp(),
      });

      setName("");
      setEmail("");
      setShowForm(false);

      const snap = await getDocs(collection(db, "tenants", tenant.id, "clients"));
      setClients(
        snap.docs.map((d) => ({
          id: d.id,
          name: d.data().name,
          email: d.data().email,
          status: d.data().status,
        }))
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return <p className="text-[#0F172A]">Please log in</p>;
  if (!tenant) return <p className="text-[#0F172A]">Loading tenant…</p>;
  if (loading) return <p className="text-[#0F172A]">Loading clients…</p>;

  return (
    <div>
      <h1 className="text-[#0F172A] text-2xl font-semibold">Clients</h1>

      <div className="mt-4 mb-4">
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 rounded-lg bg-[#4F46E5] text-white font-medium hover:bg-indigo-600 transition-colors"
        >
          ➕ Add Client
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAddClient} className="mb-6 flex flex-wrap gap-3 items-center bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="px-3 py-2 rounded-lg border border-slate-200 min-w-[200px] text-[#0F172A] placeholder:text-slate-400"
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="px-3 py-2 rounded-lg border border-slate-200 min-w-[220px] text-[#0F172A] placeholder:text-slate-400"
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

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Name</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Email</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-[#0F172A]">Status</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id} className="border-b border-slate-100 last:border-0">
                <td className="py-3 px-4 text-[#0F172A]">{client.name ?? "—"}</td>
                <td className="py-3 px-4 text-[#0F172A]">{client.email ?? "—"}</td>
                <td className="py-3 px-4 text-[#0F172A]">{client.status ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {clients.length === 0 && <p className="mt-4 text-slate-500">No clients.</p>}
    </div>
  );
}
