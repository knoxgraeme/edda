import type { Metadata } from "next";
import { Toaster } from "sonner";
import { ConnectionBanner } from "@/providers/ConnectionBanner";
import { SideNav } from "@/app/components/SideNav";
import { fraunces, geistMono, geistSans } from "./fonts";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edda — Your Second Brain",
  description:
    "AI personal assistant that captures, organizes, and surfaces everything.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} antialiased`}
      >
        <ConnectionBanner />
        <div className="flex h-screen">
          <SideNav />
          <div className="flex-1 overflow-auto">{children}</div>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
