import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

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
    <html lang="en" className={poppins.variable}>
      <body className="overflow-x-hidden font-sans">
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
