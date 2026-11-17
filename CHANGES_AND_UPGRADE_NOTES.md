# CRM update — changes, assumptions, and how to apply

This bundle contains ONLY the files that were changed or added (same relative paths as your project).
It does not contain `.env`, `.baileys-auth`, `public/uploads`, or `node_modules`.

## BEFORE YOU APPLY
1. Commit or copy your current project (Git commit, or zip the folder). Do not apply over unsaved work.
2. **`lib/auth.ts` — read this first.** The archive I audited had a truncated `lib/auth.ts` (helpers missing).
   I rebuilt the helper block from what README.md / README_PLAN.md / route comments document. If your
   local `lib/auth.ts` (or Git history) has the ORIGINAL helpers, diff them against the helper block in
   the new file and keep the original rule wherever it differs. Reconstructed rules:
   - Admin+Manager: canManageAgents, canManageAgentUsers, canManageServices, canAssignWork,
     canManagePayments, canVerifyPayments, canConfigureUpi, canManageUsers
   - Admin+Manager+Employee: canManageWhatsApp, canCreateCustomer, canEditServiceStatus
   - Admin only: canDeleteCustomer (not used by any route)
3. Compare the new `middleware.ts`, `app/layout.tsx`, `app/providers.tsx` with yours if you changed them.

## HOW TO APPLY
```
# 1. copy the files in this zip over your project (same paths)
# 2. apply the one new migration (additive: new columns/table/enum values, no data is changed or dropped)
npx prisma migrate deploy        # or: npx prisma migrate dev
npx prisma generate
# 3. optional: add the new default templates to the DB (the app also works without this — it falls back to built-in defaults)
npx prisma db seed
# 4. restart the server (the WhatsApp scheduler/reconnect code is loaded at boot)
```
The migration was written by hand. If `prisma migrate dev` reports drift, send me the output.
Seeding no longer uses a fixed shared password: it uses SEED_PASSWORD from your environment if set,
otherwise generates one and prints it once. Existing users are never overwritten.

## WHAT CHANGED (by your numbered requirements)
- **1,18,19 User management:** new `/users` page + `/api/users`, `/api/users/[id]`. Admin creates Manager+Employee;
  Manager creates Employee only; enforced server-side on every call (create, edit, role change, activate/
  deactivate, password reset). Validation: required fields, 10-digit Indian mobile, unique login ID and mobile,
  password policy (8+ chars, letter+number), bcrypt (cost 12), never returned/logged. Users are deactivated, never
  deleted. Agent logins stay in the Agents module.
- **2 Employee mobile:** `User.mobile` (+ contactEmail, address, state, district, tehsil). The same mobile is used
  for WhatsApp; no separate number system.
- **3,4,5 Agent applies → employee WhatsApp:** new shared template `AGENT_APPLICATION_TO_EMPLOYEE`
  (editable under WhatsApp → Message Templates → Employee Notifications). Sent through the existing single
  Baileys connection / logging / failed-message / retry system. Failure never affects the application.
- **6–9 Status-change customer notifications:** one shared, editable template PER STATUS (+ on/off switch), table
  `WhatsAppStatusTemplate`. Sent only when the status actually changes (compare-and-set update + database
  idempotency key). Same-status saves, double clicks and retries do not send again.
- **10 Number selection:** unchanged existing rule (primary if WhatsApp, else alternate if WhatsApp, else none).
- **11,12,17 Agent customer form:** Agent now uses the SAME form component and the SAME validation as Employee
  (`components/CustomerFormFields.tsx`, `lib/validation/customer.ts`). Only internal staff Notes is hidden from
  agents. Agent-created customers now keep WhatsApp flags/alternate number (previously dropped).
- **13–16 Location:** `LocationSelect` (State → District → Taluka, resets downstream on change) is now used in customer
  add, customer edit, agent new-customer, and user profile. Still ONE dataset (`lib/location/*`).
- **20–22 Agent navbar:** the session is now resolved on the server in `app/layout.tsx` and passed to the provider,
  so the enterprise name renders from the first paint; the "Agent Portal" fallback text was removed.
- **23–24 Templates UI:** grouped Customer / Employee / Agent; all shared, none per-agent/per-employee.
- **25 Payment reminder:** logic unchanged (same balance, 7-day rule, UPI link, one per day). A reminder that FAILED
  no longer blocks a retry; a second pass runs at 16:00 (agents already reminded today are skipped).
- **26 Failure handling:** `sendWhatsAppMessage` now truly never throws (it previously could on a database error).

## BUGS FROM THE AUDIT — FIXED
lib/auth.ts restored (build-breaking) · login form accepted only emails (agent IDs like `rahul01` were rejected) ·
payment approval now atomic (no double-credit, no half-applied approval) and duplicate UTRs refused · agent profile
pending total now matches the dashboard/QR · application creation (staff + agent) validates and stores all files
BEFORE writing, then one transaction (no orphan applications/customers) · agent-created customers keep WhatsApp
numbers · uploaded documents/screenshots are no longer public (login required; agents only their own files) · file
uploads verified by content (not just claimed type) · deactivated users/agents lose access (re-checked every 60s)
· hidden-field values and the walk-in customer price no longer sent to agents; field visibility enforced on the
server for staff too · login rate limiting (8 failures / 15 min per login ID or IP) · explicit WhatsApp Disconnect
no longer auto-reconnects; unexpected reconnects use backoff · retry cannot resend an already-delivered message ·
service routes return 404/409 instead of 500 and verify field/document belongs to the service · customer edit can now
actually clear fields · completedDate set on the server when completing · money sums rounded · code generators no
longer collide after deletions · seed no longer ships a fixed shared password.

## DECISIONS I MADE (tell me if you want any changed)
- **Who gets the employee WhatsApp:** the assigned employee if one is set; agent applications normally arrive
  UNASSIGNED, so then ALL active Employees who have a mobile number; if none, active Managers/Admins with a mobile.
- **Statuses:** your list (Submitted/In Progress/Pending/Approved) was mapped onto the real statuses:
  ACCEPTED="Approved", PROCESSING="In Progress". Default ON: ACCEPTED, PROCESSING, DOCUMENT_REQUIRED, SUBMITTED,
  COMPLETED, REJECTED, CANCELLED. Default OFF: NEW, PENDING_REVIEW, ASSIGNED (internal steps). All editable.
- Extra variables added where the data exists: {REFERENCE_NUMBER}, {STATUS}, {REJECTION_REASON}, {DATE}, {TIME}.
  A line whose variables are all empty is dropped (e.g. no reference number yet).
- Over-payment: an approved amount larger than the agent's dues is still accepted, but the unallocated part is
  now recorded in the activity log instead of silently vanishing.
- PIN code must be 6 digits when entered (new validation).

## NOT DONE / KNOWN LIMITS (be aware)
- **NOT TESTED against a database, browser, or WhatsApp.** I could only: type-check for syntax / missing exports /
  unresolved imports (clean — was 39 errors), and run the template renderer, default templates and mobile
  normaliser (13 checks, all pass). `next build`, the migration, every API route, the UI pages and real WhatsApp
  delivery are NOT TESTED — please run the checklist below.
- Location data is complete only for Maharashtra districts (Pune/Ratnagiri have talukas). For any state/district
  without data the form shows a text box instead of a dropdown. A verified dataset (e.g. data.gov.in) must replace
  `lib/location/indiaLocations.ts`.
- PASSWORD-type dynamic fields are still stored as plain text (encrypting them needs a key-management decision).
- UTR uniqueness is enforced in code, not as a database constraint (existing duplicates could block a migration).
- Login throttling is in-memory (fine for one server process).
- Not changed: agent customer lookup by mobile (deliberate in your design), employees can see all customers,
  status transitions are not restricted, several list pages still lack fetch error handling.
- Session revocation relies on NextAuth dropping the session when the jwt callback throws; I could not run it.
- The old `public/uploads` files remain where they are; they are now served only through the login-protected route.
  `crm-app.rar` inside your zip was NOT inspected.

## TEST CHECKLIST (please run, in this order)
1. `npx tsc --noEmit` then `npm run build`.
2. Log in as admin, manager, employee, agent (agent ID `rahul01` must be accepted by the form).
3. Users: Admin creates Manager + Employee (with mobile); duplicate login ID / mobile rejected; Manager can only
   create Employee; deactivate an employee → within ~60s their next request is rejected.
4. WhatsApp → connect → Templates tab shows the new Employee template and the per-status templates.
5. Agent applies for a service → employee with a mobile receives the WhatsApp; check WhatsApp history; disconnect
   WhatsApp and repeat → application still saved, message appears under Failed Messages → Resend works once.
6. Staff changes an application PENDING → SUBMITTED → COMPLETED: customer gets one message each; save again without
   changing status: no message; double-click: one message.
7. Agent "new customer" form shows all the staff fields; State→District→Taluka resets correctly.
8. Agent login: navbar shows the enterprise name immediately, never "Agent Portal".
9. Open an uploaded document link while logged out → must not load; as an agent, another agent's file → 404.
10. Approve a payment request twice quickly → second gets "already decided"; agent profile pending == dashboard pending.
