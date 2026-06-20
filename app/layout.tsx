import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/authContext";
import { UserProfileProvider } from "@/lib/userProfileContext";
import { TenantProvider } from "@/lib/tenantContext";

export const metadata: Metadata = {
  title: "Blue Team Portal",
  description: "Internal Client Portal",
  icons: {
    icon: [
      { url: '/favicon-16.svg', sizes: '16x16', type: 'image/svg+xml' },
      { url: '/favicon-mark.svg', sizes: '32x32', type: 'image/svg+xml' },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="overflow-x-hidden">
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
