import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/authContext";
import { UserProfileProvider } from "@/lib/userProfileContext";
import { TenantProvider } from "@/lib/tenantContext";

export const metadata: Metadata = {
  title: "Blue Team Portal",
  description: "Internal Client Portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <UserProfileProvider>
            <TenantProvider>
              {children}
            </TenantProvider>
          </UserProfileProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
