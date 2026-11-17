import "./globals.css";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "CRM",
  description: "Customer & Service Management CRM",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve the session once on the server so client components (the
  // Agent navbar in particular) render with the signed-in user's data
  // — including enterpriseName — from the first paint.
  const session = await getServerSession(authOptions);
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900">
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
