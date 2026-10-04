import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { AppProvider } from "@/lib/app-context";
import { RouteGuard } from "@/components/common/RouteGuard";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";

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
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased selection:bg-rose-500 selection:text-white">
        {/* Intense Care brand typeface (azo-sans-web) — same Adobe kit as intensecare.in */}
        <link rel="preconnect" href="https://use.typekit.net" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://p.typekit.net" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://use.typekit.net/lxs5qvm.css" />
        <AuthProvider>
          <AppProvider>
            <RouteGuard>
              <ErrorBoundary>
                <div className="flex flex-col min-h-screen">
                  {children}
                </div>
              </ErrorBoundary>
            </RouteGuard>
          </AppProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
