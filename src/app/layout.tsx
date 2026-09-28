import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { AppProvider } from "@/lib/app-context";
import { RouteGuard } from "@/components/common/RouteGuard";

export const metadata: Metadata = {
  title: "Intense Care Deep Cleaning Operations ERP",
  description:
    "Enterprise Field-Service ERP for Intense Care Deep Cleaning Operations — OTP Verification, Checklists, Independent QC, Customer Sign-off, and Commission Engine",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased selection:bg-slate-900 selection:text-white">
        <AuthProvider>
          <AppProvider>
            <RouteGuard>
              <div className="flex flex-col min-h-screen">
                {children}
              </div>
            </RouteGuard>
          </AppProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
