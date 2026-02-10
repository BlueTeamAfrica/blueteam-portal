"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import { useAuth } from "./authContext";

type UserProfileContextValue = {
  role: string | undefined;
  loading: boolean;
};

const UserProfileContext = createContext<UserProfileContextValue>({ role: undefined, loading: true });

export function UserProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [role, setRole] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setRole(undefined);
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        setRole(snap.data()?.role as string | undefined);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user]);

  return (
    <UserProfileContext.Provider value={{ role, loading }}>
      {children}
    </UserProfileContext.Provider>
  );
}

export const useUserProfile = () => useContext(UserProfileContext);
