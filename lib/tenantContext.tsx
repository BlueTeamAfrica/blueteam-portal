"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import { useAuth } from "./authContext";

export type TenantContextValue = {
  tenant: { id: string; name?: string; status?: string; [k: string]: unknown } | null;
  role: string | undefined;
  clientId: string | undefined;
  loading: boolean;
  error: string | null;
};

const TenantContext = createContext<TenantContextValue>({
  tenant: null,
  role: undefined,
  clientId: undefined,
  loading: true,
  error: null,
});

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [tenant, setTenant] = useState<TenantContextValue["tenant"]>(null);
  const [role, setRole] = useState<string | undefined>(undefined);
  const [clientId, setClientId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setTenant(null);
      setRole(undefined);
      setClientId(undefined);
      setError(null);
      setLoading(false);
      return;
    }

    const uid = user.uid;

    async function loadTenant() {
      setLoading(true);
      setError(null);
      try {
        const userSnap = await getDoc(doc(db, "users", uid));
        const userData = userSnap.data();
        const userRole = userData?.role as string | undefined;
        const tenantIdFromUser = userData?.tenantId as string | undefined;

        // Client users: tenantId and clientId live on users/{uid}
        if (userRole === "client") {
          const clientIdFromUser = userData?.clientId as string | undefined;
          if (!tenantIdFromUser) {
            setTenant(null);
            setRole(undefined);
            setClientId(undefined);
            setError("Client user is missing tenantId on users/{uid}.");
            return;
          }
          const tenantDoc = await getDoc(doc(db, "tenants", tenantIdFromUser));
          setTenant({ id: tenantIdFromUser, ...tenantDoc.data() });
          setRole("client");
          setClientId(clientIdFromUser);
          return;
        }

        // Admin/owner users: prefer deterministic reads if users/{uid}.tenantId exists.
        if (tenantIdFromUser) {
          const tenantDoc = await getDoc(doc(db, "tenants", tenantIdFromUser));
          setTenant({ id: tenantIdFromUser, ...tenantDoc.data() });

          // Optional: fetch role/clientId from userTenants/{uid}_{tenantId}
          const mapId = `${uid}_${tenantIdFromUser}`;
          const utSnap = await getDoc(doc(db, "userTenants", mapId));
          const ut = utSnap.data() as { role?: string; clientId?: string } | undefined;
          setRole(ut?.role);
          setClientId(ut?.clientId);
          return;
        }

        // Fallback legacy path: query userTenants by userId (may be blocked by rules).
        const q = query(collection(db, "userTenants"), where("userId", "==", uid));
        const snap = await getDocs(q);
        if (snap.empty) {
          setTenant(null);
          setRole(undefined);
          setClientId(undefined);
          setError("No tenant membership found for this user.");
          return;
        }

        const first = snap.docs[0].data();
        const tenantId = first.tenantId as string;
        const tenantDoc = await getDoc(doc(db, "tenants", tenantId));
        setTenant({ id: tenantId, ...tenantDoc.data() });
        setRole(first.role as string | undefined);
        setClientId(first.clientId as string | undefined);
      } catch (e) {
        const err = e as { code?: string; message?: string };
        console.log("TENANT DEBUG: loadTenant failed", { uid, code: err.code, message: err.message });
        setTenant(null);
        setRole(undefined);
        setClientId(undefined);
        setError(err.message ?? "Failed to load tenant context.");
      } finally {
        setLoading(false);
      }
    }

    loadTenant();
  }, [authLoading, user]);

  return (
    <TenantContext.Provider value={{ tenant, role, clientId, loading, error }}>
      {children}
    </TenantContext.Provider>
  );
}

export const useTenant = () => useContext(TenantContext);
