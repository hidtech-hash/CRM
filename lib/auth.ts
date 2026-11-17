// ============================================================
// Authentication + role helpers.
//
// IMPORTANT — provenance of the role helpers below: the original
// helper block of this file (ROLES, canManage*, isAgentRole, …) was
// lost when a partial "merge-in" copy of this file overwrote it. The
// rules below were RECONSTRUCTED from the documented behaviour in
// README.md, README_PLAN.md and the comments inside the API routes
// (each rule notes its source). If you have the original file in Git
// history or a backup, diff the helper block against it and keep the
// original where they differ.
// ============================================================

import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { isLoginBlocked, recordLoginFailure, clearLoginFailures } from "./loginLimiter";

// How often a signed-in session is re-checked against the database
// (user still active, role unchanged, agent still active). Between
// checks the JWT is trusted, so this is also the worst-case delay
// before a deactivation takes effect.
const REVALIDATE_MS = 60 * 1000;

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Login ID or Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        const loginId = credentials.email.trim();
        const forwarded = (req?.headers as any)?.["x-forwarded-for"];
        const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "";
        const keys = [`id:${loginId.toLowerCase()}`, ...(ip ? [`ip:${ip}`] : [])];

        if (isLoginBlocked(keys)) return null;

        // Exact match first (existing accounts keep working exactly as
        // before), then a lower-cased match (new accounts are stored
        // lower-cased).
        let user = await prisma.user.findUnique({ where: { email: loginId } });
        if (!user && loginId !== loginId.toLowerCase()) {
          user = await prisma.user.findUnique({ where: { email: loginId.toLowerCase() } });
        }

        const valid = user ? await bcrypt.compare(credentials.password, user.passwordHash) : false;
        if (!user || !user.isActive || !valid) {
          recordLoginFailure(keys);
          return null;
        }

        let enterpriseName: string | null = null;
        if (user.role === "AGENT") {
          const agent = await prisma.agent.findUnique({
            where: { userId: user.id },
            select: { enterpriseName: true, status: true, deletedAt: true },
          });
          // An inactive/deleted agent must not be able to sign in.
          if (!agent || agent.deletedAt || agent.status !== "ACTIVE") {
            recordLoginFailure(keys);
            return null;
          }
          enterpriseName = agent.enterpriseName || null;
        }

        clearLoginFailures(keys);
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          enterpriseName,
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.role = (user as any).role;
        token.enterpriseName = (user as any).enterpriseName ?? null;
        token.checkedAt = Date.now();
        return token;
      }

      // Periodic server-side re-validation so deactivating a user (or
      // an agent) actually ends their session instead of waiting for
      // the JWT to expire. Throwing here makes NextAuth drop the
      // session (getServerSession then returns null → routes answer
      // 401). Database errors are NOT treated as "invalid": an outage
      // must not log everyone out.
      if (token.id && Date.now() - ((token.checkedAt as number) ?? 0) > REVALIDATE_MS) {
        let dbUser: {
          isActive: boolean;
          role: any;
          name: string;
          agentProfile: { enterpriseName: string; status: string; deletedAt: Date | null } | null;
        } | null | undefined = undefined;
        try {
          dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: {
              isActive: true,
              role: true,
              name: true,
              agentProfile: { select: { enterpriseName: true, status: true, deletedAt: true } },
            },
          });
        } catch {
          dbUser = undefined; // infra error — keep the existing token
        }
        if (dbUser !== undefined) {
          const agentBlocked =
            dbUser?.role === "AGENT" &&
            (!dbUser.agentProfile || dbUser.agentProfile.deletedAt !== null || dbUser.agentProfile.status !== "ACTIVE");
          if (!dbUser || !dbUser.isActive || agentBlocked) {
            throw new Error("Session is no longer valid");
          }
          token.role = dbUser.role;
          token.name = dbUser.name;
          token.enterpriseName = dbUser.agentProfile?.enterpriseName || null;
          token.checkedAt = Date.now();
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).enterpriseName = token.enterpriseName ?? null;
        if (token.name) session.user.name = token.name as string;
      }
      return session;
    },
  },
};

// ------------------------------------------------------------
// Role helpers
// ------------------------------------------------------------

export const ROLES = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  EMPLOYEE: "EMPLOYEE",
  AGENT: "AGENT",
} as const;

type Role = string | null | undefined;
const STAFF: string[] = [ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE];
const ADMIN_MANAGER: string[] = [ROLES.ADMIN, ROLES.MANAGER];
const has = (role: Role, allowed: string[]) => !!role && allowed.includes(role);

// AGENT-role sessions (referral portal users).
export const isAgentRole = (role: Role) => role === ROLES.AGENT;

// Source: README ("Admin/Manager can create a portal login for an agent"),
// agents/[id] route comment ("canManageAgentUsers … currently maps to the
// same roles as canManageAgents").
export const canManageAgents = (role: Role) => has(role, ADMIN_MANAGER);
export const canManageAgentUsers = (role: Role) => has(role, ADMIN_MANAGER);

// Source: README ("gated by canManageServices (Admin/Manager)").
export const canManageServices = (role: Role) => has(role, ADMIN_MANAGER);

// Source: customer-services routes + application page ("only admin/manager
// may assign work to someone other than themselves / override price").
export const canAssignWork = (role: Role) => has(role, ADMIN_MANAGER);
export const canManagePayments = (role: Role) => has(role, ADMIN_MANAGER);

// Source: payment-requests / upi-config route comments ("Admin/Manager only").
export const canVerifyPayments = (role: Role) => has(role, ADMIN_MANAGER);
export const canConfigureUpi = (role: Role) => has(role, ADMIN_MANAGER);

// Source: README ("canManageWhatsApp = Admin/Manager/Employee").
export const canManageWhatsApp = (role: Role) => has(role, STAFF);

// Source: README ("Employee/Admin/Manager adds a customer"; "Admin and
// Employee can edit a specific applied service").
export const canCreateCustomer = (role: Role) => has(role, STAFF);
export const canEditServiceStatus = (role: Role) => has(role, STAFF);

// Not referenced by any route in the provided code; kept conservative.
export const canDeleteCustomer = (role: Role) => role === ROLES.ADMIN;

// ---- User management (new) ----
// Source: README_PLAN ("Admin-only for Manager creation, Admin+Manager for
// Employee"). Agents' logins stay under the Agents module
// (canManageAgentUsers), not here.
export const canManageUsers = (role: Role) => has(role, ADMIN_MANAGER);

// Which roles an actor may create / edit / (de)activate / reset passwords
// for. ADMIN: Manager + Employee. MANAGER: Employee only. Nobody creates
// ADMIN accounts through the API (seed / database only).
export function manageableUserRoles(actorRole: Role): string[] {
  if (actorRole === ROLES.ADMIN) return [ROLES.MANAGER, ROLES.EMPLOYEE];
  if (actorRole === ROLES.MANAGER) return [ROLES.EMPLOYEE];
  return [];
}
export const canActOnUserRole = (actorRole: Role, targetRole: Role) =>
  !!targetRole && manageableUserRoles(actorRole).includes(targetRole);
