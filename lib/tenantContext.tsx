"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import { useAuth } from "./authContext";

export type TenantContextValue = {
  tenant: { id: string; name?: string; status?: string; [k: string]: unknown } | null;
  role: string | undefined;
  clientId: string | undefined;
};

const TenantContext = createContext<TenantContextValue>({ tenant: null, role: undefined, clientId: undefined });

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [tenant, setTenant] = useState<TenantContextValue["tenant"]>(null);
  const [role, setRole] = useState<string | undefined>(undefined);
  const [clientId, setClientId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!user) {
      setTenant(null);
      setRole(undefined);
      setClientId(undefined);
      return;
    }

    async function loadTenant() {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      const userData = userSnap.data();
      const userRole = userData?.role as string | undefined;

      if (userRole === "client") {
        const tenantId = userData?.tenantId as string | undefined;
        const clientIdFromUser = userData?.clientId as string | undefined;
        if (!tenantId) {
          setTenant(null);
          setRole(undefined);
          setClientId(undefined);
          return;
        }
        const tenantDoc = await getDoc(doc(db, "tenants", tenantId));
        setTenant({ id: tenantId, ...tenantDoc.data() });
        setRole("client");
        setClientId(clientIdFromUser);
        return;
      }

      const q = query(
        collection(db, "userTenants"),
        where("userId", "==", user.uid)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setTenant(null);
        setRole(undefined);
        setClientId(undefined);
        return;
      }

      const first = snap.docs[0].data();
      const tenantId = first.tenantId as string;
      const tenantDoc = await getDoc(doc(db, "tenants", tenantId));
      setTenant({ id: tenantId, ...tenantDoc.data() });
      setRole(first.role as string | undefined);
      setClientId(first.clientId as string | undefined);
    }

    loadTenant();
  }, [user]);

  return (
    <TenantContext.Provider value={{ tenant, role, clientId }}>
      {children}
    </TenantContext.Provider>
  );
}

export const useTenant = () => useContext(TenantContext);
