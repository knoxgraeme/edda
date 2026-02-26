import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ClientProvider } from "@/providers/ClientProvider";
import { ChatProvider } from "@/providers/ChatProvider";
import { SideNav } from "@/app/components/SideNav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ClientProvider>
          <ChatProvider>
            <div className="flex h-screen">
              <SideNav />
              <div className="flex-1 overflow-auto">{children}</div>
            </div>
            <Toaster />
          </ChatProvider>
        </ClientProvider>
      </body>
    </html>
  );
}
