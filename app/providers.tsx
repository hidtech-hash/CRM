"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

// `session` is resolved on the server (see app/layout.tsx) and handed
// in as the initial value, so useSession() has real data on the very
// first render — no "loading" state, no placeholder flash.
export default function Providers({ children, session }: { children: React.ReactNode; session?: Session | null }) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
