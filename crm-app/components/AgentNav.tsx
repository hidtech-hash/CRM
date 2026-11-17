"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

// FIXED: previously this component fetched enterpriseName itself via
// a useEffect (fetch("/api/agent-portal/me")) AFTER mounting, which
// is why "Agent Portal" flashed before the real name replaced it —
// there was a real gap between first paint and that fetch resolving.
// Now enterpriseName comes from the session itself (see lib/auth.ts —
// it's embedded in the JWT at sign-in), which NextAuth resolves
// before this component ever renders with real data. No second
// fetch, no fallback text, no flicker.
export default function AgentNav() {
  const { data: session, status } = useSession();
  const enterpriseName = (session?.user as any)?.enterpriseName as string | null | undefined;

  // While the session itself is still resolving (a genuinely brief
  // window — this is NextAuth's own loading state, not a fetch we
  // added), show a neutral placeholder instead of "Agent Portal" or
  // any other fallback text that would itself need to be replaced.
  const brandContent =
    status === "loading" ? (
      <span className="inline-block h-4 w-32 bg-slate-700 rounded animate-pulse" aria-hidden />
    ) : (
      // Falls back to the agent's own name only in the genuinely rare
      // case an Agent has no enterpriseName on file at all (e.g. an
      // older record created before this field existed and never
      // filled in) — never falls back to generic "Agent Portal" text.
      enterpriseName || session?.user?.name || ""
    );

  return (
    <nav className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <span className="font-semibold">{brandContent}</span>
        <Link href="/agent" className="text-sm hover:text-slate-300">
          Dashboard
        </Link>
        <Link href="/agent/apply" className="text-sm hover:text-slate-300">
          Apply for Service
        </Link>
        <Link href="/agent/payments" className="text-sm hover:text-slate-300">
          My Payments
        </Link>
      </div>
      <div className="flex items-center gap-4 text-sm">
        {session?.user && <span className="text-slate-300">{session.user.name}</span>}
        <button onClick={() => signOut({ callbackUrl: "/login" })} className="hover:text-slate-300">
          Logout
        </button>
      </div>
    </nav>
  );
}
