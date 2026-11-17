# CRM — Phases 1–4 (Core CRM, Agents, Fixed Pricing, Agent Portal + UPI Payments)

Core loop (Phase 1):
1. Employee/Admin/Manager **adds a customer**.
2. From the customer's profile, they **apply a service** for that customer
   (creates a `CustomerService` / work record — the customer is never duplicated,
   they can have many of these).
3. Anyone logged in can **search customers** (name / mobile / customer ID) and
   open a profile to see every service they've applied for, with status.
4. Admin and Employee can **edit a specific applied service** — change status,
   set the **reference number** (e.g. after online submission), add notes, mark
   completion date.
5. Every create/status-change/reference-number-set is written to an
   **activity log**, shown on the customer's profile.

### Phase 2 — Agents, work assignment, employee dashboard
- **Agents module** (`/agents`, `/agents/new`, `/agents/[id]`).
- **Work assignment** to a specific employee, with auto-assignment of an
  employee's own intake to themselves.
- **Employee dashboard** (`/dashboard`) — pending work, work missing a
  reference number, and (Admin/Manager) an org-wide Unassigned Queue.
- Per-application `Payment Status` / `Amount Received`.

### Phase 3 — Fixed agent pricing, no commission
- **Services module** (`/services`) — every service has a fixed **Customer
  Price** and **Agent Price** (Admin/Manager only). No commission math
  anywhere: applying a service auto-picks the right price based on whether
  an agent is linked.

### Phase 4 (this update) — Agent User System, Agent Portal, UPI Payments
A whole new self-service layer for agents, on top of everything above:

- **New role: `AGENT`.** Admin/Manager can create a portal login for an
  agent (at creation time, or later from the agent's profile) — one login
  is linked 1:1 to one `Agent` record via `Agent.userId`.
- **Route-level isolation.** `middleware.ts` now checks role, not just
  "logged in": an `AGENT` session is hard-blocked from every admin/manager
  page and API and redirected to `/agent`. This is enforced at the routing
  layer, not just hidden in the UI — an agent calling an admin API directly
  gets a 403, not just a missing button.
- **Agent Dashboard** (`/agent`): an agent sees *only* their own
  applications (customer, service, reference number, status, amount,
  received, pending) and summary totals (total applications / total amount
  / received / pending) — resolved server-side from their session, never
  from a client-supplied agent id.
- **Still no commission.** Agent pricing is exactly what Phase 3 built —
  the fixed `Service.agentPrice`. This phase only adds payment *collection*
  on top of that fixed pricing.
- **UPI Configuration** (`/settings/upi`, Admin/Manager only): set the
  business UPI ID (and payee name) used to generate every agent's QR.
  Enable/disable without losing the value; history is kept, not overwritten.
- **Dynamic UPI QR per agent**: the agent dashboard shows a QR encoding the
  configured UPI ID + **that agent's current pending amount**, computed
  fresh server-side on every load — the agent's browser never gets a
  chance to influence the amount. ₹0 pending shows "No pending payment"
  instead of a QR.
- **Manual payment verification workflow** (no payment gateway):
  1. Agent pays via the QR in their own UPI app.
  2. Agent goes to **My Payments** (`/agent/payments`) and submits a
     **UTR + screenshot only** — there is deliberately no amount field
     anywhere in that form or its API. The agent cannot tell the system how
     much they paid.
  3. This creates an `AgentPaymentRequest` with status
     `PENDING_VERIFICATION`. Nothing about the agent's balance changes yet.
  4. Admin/Manager reviews it on **Payment Requests** (`/payment-requests`):
     views the UTR and screenshot, manually enters the **actual verified
     amount**, and Approves or Rejects.
  5. **Only on Approve** does anything change: the verified amount is
     recorded, and immediately allocated across the agent's outstanding
     applications — oldest first, filling each one's remaining balance
     before moving to the next (`lib/agentContext.ts:allocatePaymentToAgentWork`).
     This is what keeps each application's own `amountReceived`/
     `paymentStatus` and the agent's aggregate total/received/pending
     numbers in agreement — there's one source of truth (the
     `CustomerService` rows), and `AgentPaymentRequest` is the permanent
     audit trail of *why* they changed.
  6. On Reject, nothing about the balance changes at all; the rejection
     reason is stored and visible to the agent.
- **Payment screenshot storage**: saved to `/public/uploads/payment-screenshots/`
  on local disk for now (a pragmatic dev-friendly default — `lib/uploads.ts`
  is a single, isolated swap-point for real object storage like S3/R2 later;
  nothing else needs to change since callers only ever see the returned URL).

Roles (`ADMIN`, `MANAGER`, `EMPLOYEE`, `AGENT`) and permission checks are
centralized in `lib/auth.ts`.

## Setup / applying this update

```bash
cd crm-app
npm install          # picks up the new `qrcode` dependency
npm run prisma:migrate      # prompts for a migration name, e.g. "agent_portal_upi_payments"
npm run dev
```

`prisma migrate dev` will detect: the new `AGENT` role value, `Agent.userId`,
and the two new models (`UpiConfig`, `AgentPaymentRequest`) — all additive,
nothing destructive this time. It re-runs the seed, which now also creates:
an agent portal login, a UPI config, and a sample pending payment request.

Fresh setup (first time):
```bash
cd crm-app
cp .env.example .env
# edit .env: set DATABASE_URL to a real Postgres instance, set NEXTAUTH_SECRET
npm install
npm run prisma:migrate
npm run dev
```

### Logins

| Role | Login | Password |
|---|---|---|
| Admin | admin@example.com | ChangeMe123! |
| Manager | manager@example.com | ChangeMe123! |
| Employee | employee@example.com | ChangeMe123! |
| **Agent** | **rahul01** | **ChangeMe123!** |

**Change these before any real/production use.**

### Try the full agent payment flow end-to-end
1. Log in as Admin → **UPI Settings** → confirm `business@upi` is configured
   (seeded already).
2. Log in as **rahul01** (Agent) → **Dashboard** → see two unpaid seeded
   applications (₹200 + ₹150 = ₹350 pending) and a QR for ₹350.
3. Go to **My Payments** → see a seeded request already sitting at
   "PENDING VERIFICATION" with UTR `SEED123456789`.
4. Log back in as Admin or Manager → **Payment Requests** → find that
   request → click **Verify** → enter a verified amount (e.g. `200`) →
   **Approve**.
5. Log back in as **rahul01** → Dashboard now shows pending reduced to
   ₹150, and the QR amount has updated automatically. The PAN Card
   application is now marked `PAID` (or `PARTIAL`, depending on the amount
   you entered) on the agent's own applications table.
6. Try submitting a *new* payment request as rahul01 (My Payments →
   upload any PNG/JPG as the screenshot) and reject it as Admin/Manager —
   confirm the pending amount does **not** change on rejection.

### Need a Postgres instance quickly for local dev?
- Easiest: [Neon](https://neon.tech) or [Supabase](https://supabase.com) — free tier, gives you a `DATABASE_URL` in under a minute, no local install needed.
- Or run Postgres locally with Docker: `docker run --name crm-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres`
- Or install Postgres natively on Windows (see setup steps discussed in chat).

## What's deliberately NOT in yet
- Documents/file upload for customer-facing applications (screenshots for
  agent payments ARE implemented — see above; this is about e.g. Aadhaar
  copies, application forms)
- Aadhaar e-KYC flow (schema fields for `kycVerificationStatus` etc. are
  planned — see `architecture.md` — not built into this phase)
- Dashboard charts, full reports module, notifications, follow-ups
- Employee incentive tracking (separate from agent pricing)
- Duplicate-check UI is basic (mobile-number match only)
- Real object storage for payment screenshots (currently local disk — see
  `lib/uploads.ts`)
- Agent record soft-delete UI (deactivate exists; delete does not)

## Project structure
```
app/
  api/
    customers/, customer-services/, agents/, services/, employees/
    dashboard/my-work/                → admin/employee dashboard data
    upi-config/                        → GET/POST/PATCH, admin/manager only
    payment-requests/[id]?             → admin/manager: list + verify/approve/reject
    agent-portal/
      dashboard/                        → agent's own applications + totals
      qr/                                → agent's own dynamic UPI QR
      payment-requests/                  → agent's own submit (UTR+screenshot) + history
    auth/
  customers/, agents/, services/, dashboard/, login/     → admin/manager/employee UI
  agent/                                → agent dashboard
  agent/payments/                        → agent payment submission + history
  payment-requests/                       → admin/manager verification screen
  settings/upi/                            → admin/manager UPI configuration
lib/
  auth.ts             → NextAuth config + centralized permission helpers (incl. AGENT)
  prisma.ts           → DB client
  codes.ts            → CUS-000001 / WRK-000001 / AGT-000001 ID generation
  activityLog.ts       → audit log writer
  agentContext.ts       → resolve session -> Agent, balance calc, FIFO payment allocation
  upi.ts                 → UPI URI + server-side QR generation
  uploads.ts               → local-disk screenshot storage (S3 swap-point)
components/
  Nav.tsx              → admin/manager/employee nav
  AgentNav.tsx          → separate, minimal nav for the agent portal
middleware.ts           → auth + role-based route isolation for AGENT
prisma/
  schema.prisma          → DB schema
  seed.ts                  → dev seed data (incl. agent login + UPI config + sample request)
```

## Next step
Tell me which phase to build next — the Aadhaar e-KYC flow, real customer
document uploads, a proper reports/dashboard-charts module, or something
else — and I'll add it on top of this same project.

---

## Phase 5 — Agent Self-Service Applications, Dynamic Fields/Documents, Accept/Reject Workflow

This phase adds the biggest architectural piece yet: agents submit their own applications, which flow through a real review workflow, and the fields/documents each service needs are entirely admin-configurable — no per-service code anywhere.

### 1–2. Agent search + Apply for Service
- Agent Dashboard (`/agent`) now has a search box (customer name, mobile, work code, reference number, service name, status) scoped server-side to that agent's own applications only — the query itself filters by `agentId: agent.id`, so there's no way to widen it into another agent's data.
- **Apply for Service** (`/agent/apply`): mobile-first customer lookup (find existing or add new) → pick a service → the form renders itself from that service's configuration.

### 3–6. Dynamic documents
- New **Service Configuration** page (`/services/:id`, linked from the Services list) lets Admin/Manager add/edit/remove **Document Requirements** (name + required/optional) per service — this is what the agent's upload form and the staff review checklist both read from, generically.
- The agent's apply form always additionally offers 3 **common optional documents** (Aadhaar Card, Photo, Signature) plus a **+ Add Document** button for anything custom-named — none of this is hard-coded per service, and it never overrides what the service actually requires.
- Submission is blocked server-side (not just in the UI) if any `required` document is missing — the same check exists at resubmit time too.

### 7–9. Dynamic service fields
- The same Service Configuration page has an **Application Fields** section: Admin/Manager define fields with a type (Text/Number/Date/Email/Phone/Password/Textarea/Select/Checkbox), whether it's required at submission, and whether it can still be edited later — e.g. Passport's `File Number` can be marked "not required initially" so an agent isn't blocked from submitting without it, and staff can fill it in once it exists.
- The agent's apply form renders whatever fields are configured for the selected service — nothing is hard-coded per service name.

### 12–17. Review workflow and the payment-timing rule
- Agent-submitted applications start at status **`PENDING_REVIEW`** and show up on a new **org-wide "Pending Review"** section on the staff Dashboard, visible to Admin/Manager/Employee alike.
- Opening one (`/applications/:id`) shows the full picture — customer, agent, submitted field values, a documents checklist with Required/Optional/Uploaded/Missing indicators, and **Accept**/**Reject** buttons. Rejecting requires a reason (enforced server-side too).
- **The payment-timing rule is implemented with a single, minimal change**: `lib/agentContext.ts`'s balance calculation now excludes `PENDING_REVIEW`, `REJECTED`, and `CANCELLED` applications from an agent's total/received/pending. There's no separate "add to balance" step to call — the moment staff flip an application's status away from `PENDING_REVIEW` (e.g. to `ACCEPTED`), the very next balance query picks it up automatically. Submitting never inflates an agent's balance; only accepting does.
- **Resubmit**: from a `REJECTED` application (`/agent/applications/:id`), the agent can update field values and re-upload/add documents, then resubmit — same record, same work code, full history preserved via the activity log. Status returns to `PENDING_REVIEW`.
- **Cancel**: from a `REJECTED` application, the agent can instead cancel it — status becomes `CANCELLED`, stays in history, never touches the balance.

### 18–21. Customer mobile-first lookup + Edit Customer
- **Add Customer** (`/customers/new`) now asks for the mobile number first. If a customer already exists with that number, it shows "Customer Found" with a direct link to their profile instead of re-collecting everything. If not, the rest of the form appears with the mobile pre-filled.
- **Edit Customer**: the customer profile page now has an inline "Edit Customer" toggle — edits the same record in place; every existing application keeps referencing the same customer id.
- The same lookup logic (`lib/customerLookup.ts`) is shared between the staff flow (`/api/customers/lookup`) and the agent flow (`/api/agent-portal/customers/lookup`) — one function, two thin route wrappers so the AGENT-only middleware boundary stays simple.

### 24–25. Authorization
- All of the above is layered on the existing role helpers in `lib/auth.ts` — no new role was needed (`ADMIN`/`MANAGER`/`EMPLOYEE`/`AGENT` from Phase 4 cover everything here). An agent physically cannot reach `/api/customer-services/:id` (the accept/reject endpoint) at all — it's outside the `/api/agent-portal/*` allowlist enforced in `middleware.ts` — so "an agent can't accept their own application" is true by construction, not just a missing button.
- Every dynamic field/document CRUD endpoint (`/api/services/:id/fields*`, `/api/services/:id/documents*`) is gated by `canManageServices` (Admin/Manager), same tier as pricing.

### Database changes
- `ServiceStatus` enum: added `PENDING_REVIEW`, `ACCEPTED` (existing values untouched).
- New models: `ServiceField`, `ServiceDocumentRequirement`, `ApplicationFieldValue`, `ApplicationDocument`.
- `CustomerService`: added `rejectionReason`, plus relations to the two new "Application*" models.
- `Customer`: added `updatedById`/`updatedBy` (was missing — needed for Edit Customer's audit trail).
- `lib/uploads.ts` generalized to `saveApplicationDocument` (images + PDF) alongside the existing `savePaymentScreenshot` (images only) — both are thin wrappers around one shared local-disk helper.

### Setup / applying this update
```bash
cd crm-app
npm install
npm run prisma:migrate      # e.g. "agent_applications_dynamic_fields_documents"
npm run dev
```
Re-seeds with: document requirements + a dynamic field on two of the sample services, one `PENDING_REVIEW` application (try accepting or rejecting it from `/applications/:id` or the Dashboard's Pending Review section), and one already-`REJECTED` application (try Fix & Resubmit or Cancel from the agent's own dashboard).

### Try it end-to-end
1. Log in as **rahul01** (Agent) → **Apply for Service** → search an existing mobile (`9876543210`, seeded) → pick **PAN Card** → see the Aadhaar Card (required) / Photo (optional) upload fields appear automatically → submit.
2. Log in as Admin/Manager/Employee → **Dashboard** → see it under **Pending Review** → open it → **Accept**.
3. Log back in as rahul01 → Dashboard → pending balance just went up by the PAN Card agent price (₹200) — it wasn't counted before acceptance.
4. Try the seeded `WRK-000006` (Aadhaar Update, already `REJECTED`) from rahul01's dashboard → **Fix & Resubmit** → see the rejection reason, correct the field, resubmit → it reappears in staff's Pending Review queue.
5. As Admin/Manager, go to **Services → PAN Card → Configure Fields/Docs** and add a new field or document requirement — reload the agent's Apply for Service form and see it appear with zero code changes.

## What's deliberately NOT in yet
- Aadhaar e-KYC flow (unrelated to the above; still from the original spec)
- Full reports/dashboard-charts module, notifications, follow-ups
- Employee incentive tracking
- Real object storage for uploads (still local disk — `lib/uploads.ts`)
- Field/document reordering UI (the `sortOrder` column exists and is respected on read; there's no drag-to-reorder control yet — new items just append to the end)
- Editing a dynamic field's value from the staff review screen (currently view-only there; editing happens via the agent's resubmit flow, or directly in the database/Prisma Studio for a quick fix)

---

## Bugfix — Agent "Apply for Service" empty service list + My Applications table layout

**Root cause 1 — services not loading for agents:** the Apply for Service page was calling `/api/services` and `/api/services/:id`, which sit outside the `/api/agent-portal/*` allowlist enforced in `middleware.ts` (added in Phase 4 for agent route isolation). Every request from an agent session was silently getting a 403 from the middleware before it ever reached the route handler; the frontend's `d.services ?? []` then quietly rendered an empty list instead of surfacing an error.

Fix: extracted the actual service queries into `lib/services.ts` (`listActiveServices`, `listAllServices`, `getServiceWithConfig`) — one shared source of truth, no duplicate service list, no hard-coding. The existing staff routes (`/api/services`, `/api/services/:id`) now call these same functions. Two new thin wrapper routes, `/api/agent-portal/services` and `/api/agent-portal/services/:id`, call the identical functions from inside the agent-portal namespace so they're reachable under the AGENT middleware allowlist. Any service Admin/Manager marks active in Service Management appears for agents automatically — same data, same `isActive` flag, just a second reachable path to it.

**Root cause 2 — My Applications columns getting clipped:** the table had no horizontal-scroll container and sat inside a `max-w-4xl` page with `overflow-hidden` on the table's wrapper — so with 9 columns plus long service names, the browser compressed columns instead of scrolling, and the View action could end up clipped.

Fix (`app/agent/page.tsx`): wrapped the table in `overflow-x-auto`, gave it a `min-w-[860px]` so columns get a horizontal scrollbar instead of being squeezed unreadable, added `whitespace-nowrap` to all the short/fixed-format columns (ref no., date, status, amounts, action) so they never wrap awkwardly, and `truncate` + `title` tooltip on the Customer/Service columns so one long name can't blow out the layout. Widened the page container from `max-w-4xl` to `max-w-5xl` to match every other table page in the app. No columns were removed — all nine (Customer, Service, Ref. No., Applied, Status, Amount, Received, Pending, Action) are still there, and the View/Fix & Resubmit action is now guaranteed visible via scroll rather than being at risk of clipping.

**Explicitly not touched:** the payment-timing logic in `lib/agentContext.ts` (submitting never adds to an agent's pending balance; only acceptance does), the `/api/agent-portal/applications/:id` scoping that prevents one agent from reaching another's data, and every other existing workflow — this was a two-file-plus-one-shared-helper fix, nothing else in the app changed.

---

## Bugfix round 2 — accepted applications vanishing, agent search crash, plus Agent Management improvements

### 1–2. "Forbidden: cannot reassign work" + accepted applications not appearing anywhere

**Root cause:** two bugs compounding. First, the customer-profile edit form always resent `assignedEmployeeId` in its save request — even when the user never touched that control — and the server compared the incoming value against the *acting user's own id* instead of the *record's current value*. Any Employee without reassignment permission saving a reference number on an application that had no assignee yet (which was *every* agent-submitted application, since nothing ever assigned one) got rejected as a false "reassignment." Second, and the real root of "it doesn't appear in Incomplete Applications": nothing ever auto-assigned an accepted application to anyone, so it had nowhere to show up as "my work."

**Fix:**
- `app/api/customer-services/[id]/route.ts` now compares the *effective* new assignee against the record's *existing* assignee — resending an unchanged value, or self-claiming, is always allowed regardless of role; only an actual handoff to someone else still requires `canAssignWork`.
- Accepting a previously-unassigned application now auto-assigns it to whoever accepts it (same pattern as an employee's own customer intake auto-assigning to themselves). It immediately shows up under the existing **Incomplete Applications** dashboard section (this label already existed from Phase 5 — it just had nothing to show).
- A new `acceptedAt` timestamp is stamped the moment an application first becomes balance-eligible (acceptance for agent-submitted work; immediately for staff-created work) — this also became the ledger source for the new "Payment Pending From" column (see below).
- Added `PUT /api/customer-services/:id/fields` so staff can now fill in/update fields a service marks `editableAfterSubmission` (e.g. a Passport's File Number) — previously view-only.

### 3. Agent Search returning nothing

**Root cause:** the search query unconditionally included `{ status: { equals: <raw search term> } }` against a typed enum column. Prisma throws a validation error for any value that isn't a real `ServiceStatus` member — which is every search term except an exact status name — so the whole query crashed on virtually every real search (a name, a mobile number, a service name).

**Fix:** that clause is now only added when the search term actually matches a known status value (checked against `Object.values(ServiceStatus)`, not a hand-maintained list).

### 4–5. Enterprise Name

`Agent.enterpriseName` is now required when creating an agent (validated both in the form and server-side via Zod). Existing agents created before this field existed default to `""` (a DB default, not a blocked migration) and show "Not set" in the list / a prompt to add one on their profile — nothing about existing data was made invalid. The Agent Portal navbar (`AgentNav`) now fetches the logged-in agent's own `enterpriseName` via a new lightweight `/api/agent-portal/me` endpoint and displays it in place of the hard-coded "Agent Portal" label.

### 6–7. Agent list columns + Agent Management summary cards

Both are entirely ledger-derived (`lib/agentContext.ts`), never computed in the UI:
- **Pending Payment** — same balance calculation used everywhere else.
- **Payment Pending From** — days since `acceptedAt` on the *oldest* currently-unpaid application for that agent; green at ≤7 days, red beyond; "No Due" (not "0 days") when nothing is outstanding.
- **Summary cards** (`GET /api/agents/summary`) — Total Agents, Total/Paid/Pending Payment, Agents With/Without Due. "Paid" specifically sums *approved* `AgentPaymentRequest.verifiedAmount` (per the spec's "only verified/approved payments count as paid"), which is deliberately a different figure from the general `amountReceived` sum used for "pending," since the latter can also be adjusted directly by staff for edge cases (e.g. the existing "Mark Fully Paid" shortcut).

### 8. Payment logic

Unchanged — verified by re-reading `lib/agentContext.ts`'s `EXCLUDED_FROM_BALANCE` list and the allocation logic before touching anything else in this round. The only related change was exporting that list so the acceptance endpoint could reuse the exact same source of truth for "when does this become balance-eligible" instead of duplicating it.

### 9–10. "Pay Through UPI App"

Added next to the QR on the Agent Dashboard as a plain `<a href="upi://...">` link — the standard way to trigger an installed UPI app on mobile. Uses the same server-computed `uri` the QR is generated from (now also returned by `/api/agent-portal/qr`), so there's no separate path for an agent to influence the amount. On desktop it simply does nothing harmful if unsupported; a caption below explains to scan the QR instead. The CRM still never assumes a payment succeeded — the UTR + screenshot + manual verification flow is completely unchanged.

---

## Fix round 3 — dynamic field/document architecture gaps, Service ID rename

The previous rounds fixed workflow *bugs* (wrong permission checks, a crashing search query). This round fixes an actual **architectural gap**: dynamic fields and documents were only ever wired into the Agent's own apply flow, and there was no single page that reliably showed an application's submitted information at every stage of its life.

### 1. Field visibility was never actually configurable in the UI
`ServiceField.visibleToAgent` / `.visibleToEmployee` / `.visibleToAdmin` have existed in the schema and API since Phase 5 — the Service Configuration form just never exposed checkboxes for them, so every field silently defaulted to "visible to everyone," and separately, the non-Agent apply flow never rendered dynamic fields *at all* (see #2), which is why it looked like fields were Agent-only. Fixed: `/services/:id` now has **Show for Agent** / **Show for Non-Agent Users** checkboxes (the latter sets both `visibleToEmployee` and `visibleToAdmin` together, since the ask was Agent-vs-everyone-else, not a 3-way split) — reusing the existing three flags, not a new mechanism.

### 2. Dynamic fields/documents were missing entirely from the staff apply flow
**Root cause:** `POST /api/customer-services` (used when Admin/Manager/Employee applies a service directly from a customer's profile) never accepted `fieldValues` or document uploads — only the separate `POST /api/agent-portal/applications` endpoint did. So a field configured on a service genuinely never appeared for a non-Agent application, because nothing was there to render or save it.

**Fix:** rewrote the endpoint to accept multipart form data with the exact same shape the agent-portal endpoint already used (`fieldValues` JSON, `requirement_<id>` files, `common_<name>` files, custom docs) — same `Service`/`ServiceField`/`ServiceDocumentRequirement` models, same validation, same everything, just reachable from the staff apply form too. The customer profile's "Apply Service" form now renders whichever fields/documents are configured for the selected service, filtered to what the current role can see, exactly like the Agent's form does.

### 3–7. Submitted information "disappearing" after acceptance
**Root cause:** the customer profile page linked an application to two *different* places depending on status — `/applications/:id` (which showed fields/documents, but only while `PENDING_REVIEW`) for review, or an inline edit form (which showed neither) for everything afterward. Once an application moved to "Accepted" and beyond, staff landed on the inline form and the submitted fields/documents were simply never rendered there — not deleted, just never displayed on that surface.

**Fix:** consolidated into one page. `/applications/:id` is now the single view/edit surface for an application at *every* stage — the customer profile always links there, for every status, and that page now also has the status/reference-number/agent/assignment/price editing that used to live only in the removed inline form. Dynamic fields (filtered by role visibility, editable where `editableAfterSubmission` allows), documents (with a new upload/replace capability — added `POST /api/customer-services/:id/documents`, which never deletes an existing document, just adds another), and the full activity history are all on that one page regardless of status. There's exactly one `CustomerService` record throughout — nothing about this fix creates a second record or copies data anywhere; it only changes what's *displayed* and *where*.

### 10–13. "Work ID" → "Service ID", format change
- Every user-facing "Work ID" label now reads "Service ID".
- New applications get a `SID-000001`-style code instead of `WRK-000001`. **Existing records are untouched** — the code is a plain stored string (`CustomerService.workCode`), not derived or regenerated, so old `WRK-xxxxxx` values stay exactly as they are; only the prefix used for values generated from now on changed. No migration needed for this change.
- The internal Prisma field/column is still named `workCode` (an implementation detail, deliberately not renamed — renaming a column is a needless, riskier migration when only the *display* format needed to change, per the "prefer changing the display ID over the internal identifier" guidance).

### Not a schema change this round
Everything above reuses existing models (`ServiceField`, `ServiceDocumentRequirement`, `ApplicationFieldValue`, `ApplicationDocument`) — no new migration is required to apply this update, just pull in the files and restart.

### Try it end-to-end
1. As Admin: **Services → PAN Card → Configure Fields/Docs** — see the seeded "Agent Enrollment Code" field marked *Agent only*.
2. As Admin/Manager/Employee: open a customer → **Apply Service** → pick PAN Card → the Aadhaar/Photo document fields appear (same as the Agent sees), but the Agent Enrollment Code field does **not** (it's Agent-only) — submit it.
3. Open that application from the customer profile → **View / Edit** → confirm the submitted field and document are visible immediately.
4. Accept it, then open it again from the customer profile — same page, same fields/documents still there, now with Reference Number / Status editable inline, right below the accept bar (which disappears once decided).

---

## Phase 6 — WhatsApp Messaging via Baileys

### Known first-run fix (already applied)
On Next.js 14.x, the "externalize Baileys from webpack bundling" config lives under `experimental.serverComponentsExternalPackages` — it only became a stable top-level `serverExternalPackages` key in Next.js 15. `next.config.js` now uses the correct 14.x key; if you'd already generated a build with the old key, restart `npm run dev` after pulling this fix (Next doesn't hot-reload `next.config.js` changes).

### ⚠️ Important: not testable in the environment this was built in
Everything below was written carefully against Baileys' well-established API (the `@whiskeysockets/baileys` package — the actively maintained fork; plain `baileys` on npm is outdated), but this was built in a sandboxed environment with **no network access**, so **none of the Baileys/WhatsApp connectivity has actually been run against a real WhatsApp account**. Expect to be the first to debug minor version-API mismatches when you `npm install` and actually try to connect — the architecture (singleton connection, session persistence, message service, scheduler) is sound and everything else in this codebase has been verified working, but the live WhatsApp handshake itself is unverified. If `connection.update` events, QR generation, or `sock.sendMessage`/`sock.onWhatsApp` don't match exactly what your installed Baileys version expects, check that package's own changelog/docs first — its API has shifted slightly across versions historically.

### 1–6. One shared connection, shared templates
- **`lib/whatsapp/baileysClient.ts`** is a singleton module — Node caches modules, so every API route in the same server process shares the same `sock` variable. This is what makes "one WhatsApp connection for the whole CRM" true, and it assumes the app runs as one long-lived Node process (`next start`/`next dev`), same assumption the local file upload storage already makes. It is **not** compatible with serverless/edge hosting without moving this to a separate always-on worker.
- Session credentials persist via Baileys' own `useMultiFileAuthState` to a local `.baileys-auth/` folder (gitignored) — never written to the database, never returned by any API response. Only connection *status* (`WhatsAppConfig`) is exposed to the frontend.
- `canManageWhatsApp` (`lib/auth.ts`) = Admin/Manager/Employee — enforced server-side on every `/api/whatsapp/*` route. Agents can't reach these routes at all (outside the `/api/agent-portal/*` middleware allowlist), and the permission check is there regardless as the real enforcement, not just a hidden nav link.
- `WhatsAppTemplate` has exactly one row per notification type (`@unique` on `type`) — editing it edits the one shared template, there's no mechanism to create a second one.

### 7–8. Customer Created / Service Applied
Hooked into the three places a customer or application gets created (`POST /api/customers`, `POST /api/customer-services`, `POST /api/agent-portal/applications`) — all three call the same `sendWhatsAppMessage()` from `lib/whatsapp/service.ts`, fired without `await`-blocking the response (`.catch(() => {})`), so a slow or failed WhatsApp send never adds latency to or blocks the actual CRM operation.

### 9–17. Agent Payment Reminder — one template, personalized dynamically, 7-day rule
- **`lib/whatsapp/scheduler.ts`** runs daily via `node-cron`, registered exactly once at server boot through `instrumentation.ts` (Next's official "run code once when the server starts" hook).
- Reuses `getAllAgentsBalances()` (`lib/agentContext.ts`) — the exact same balance calculation the Agents list and Agent Management summary already use. No second pending-amount calculation exists anywhere.
- The 7-day threshold is computed from the real `acceptedAt` ledger timestamp (the same one added in an earlier round for the "Payment Pending From" column) — never a UI date.
- Duplicate prevention queries the `WhatsAppMessage` log itself for a same-day `AGENT_PAYMENT_REMINDER` row for that agent, rather than a separate "reminders sent" tracker.
- **`generateAgentPendingPaymentUPILink(agent)`** (added to the existing `lib/upi.ts`, not a new file) is the one place an agent's UPI link is built — both `/api/agent-portal/qr` (the Dashboard's QR + "Pay Through UPI App" button) and the reminder job call this exact function, so they can never disagree about the UPI ID, payee name, or amount.
- UPI payment verification is completely unchanged — the reminder just links to the same manual UTR/screenshot/Manager-approval flow that already existed; nothing about clicking the link marks anything as paid.

### 18–21. Customer WhatsApp number selection
`Customer.mobileIsWhatsapp` / `.altMobileIsWhatsapp` — the exact Case 1/2/3 logic from the spec lives in one place, `resolveCustomerWhatsAppNumber()` in `lib/whatsapp/service.ts`. Both the Add Customer and Edit Customer forms expose the checkboxes; neither number is ever assumed to be WhatsApp-enabled by default.

### 22–25. Failed messages, retry, history
- Every send attempt (success or failure) writes a `WhatsAppMessage` row. A retry creates a **new** row linked back via `retryOfId` — the original is never mutated or deleted, so the full attempt history stays intact and visible on the WhatsApp Configuration → Failed Messages tab.
- Failure reasons are distinguished using Baileys' own signals where possible: `sock.onWhatsApp()` is checked before sending to specifically flag "not registered on WhatsApp" (rather than lumping every failure into that one bucket), `isWhatsAppConnected()` catches the disconnected case, and anything else surfaces the actual error message from the send attempt.
- The Failed Messages tab lets you edit the number inline and Resend without touching the Customer record itself.

### 26–30. Centralized service, non-blocking, number normalization
- `lib/whatsapp/service.ts` is the only place anything calls Baileys to send a message — `sendWhatsAppMessage()` never throws (always resolves to a result object), which is the entire mechanism behind "WhatsApp failures never block core CRM operations."
- `lib/whatsapp/phone.ts` is the one number-normalization utility, assuming Indian 10-digit numbers by default (matching how this CRM already stores customer/agent mobiles) and building the WhatsApp JID consistently everywhere.

### Setup

```bash
cd crm-app
npm install          # pulls in @whiskeysockets/baileys, @hapi/boom, pino, node-cron
npm run prisma:migrate      # new WhatsApp models + Customer.mobileIsWhatsapp/altMobileIsWhatsapp
npm run dev
```

Re-seeds: a `NOT_CONNECTED` `WhatsAppConfig` row, the three default templates (exact bodies from the spec), and the seeded customer's primary mobile marked as a WhatsApp number so you can test end-to-end immediately once connected.

### Connecting WhatsApp
1. Log in as Admin/Manager/Employee → **WhatsApp** (nav) → **Connection** tab → **Connect**.
2. A QR code should appear within a few seconds (polled automatically). Scan it from WhatsApp on your phone: Settings → Linked Devices → Link a Device.
3. Status should flip to Connected with the linked number shown.
4. Restart the dev server — the connection should restore automatically (via `instrumentation.ts` → `restoreWhatsAppConnectionIfConfigured`) without a new QR scan, since the session persisted to `.baileys-auth/`.

### What's deliberately simplified per the spec's own guidance
- Delivery/read receipt tracking — spec explicitly says not to make this mandatory; only Queued/Sent/Failed are tracked.
- The reminder job runs on a fixed daily cron time (10:00 server time, in `lib/whatsapp/scheduler.ts`) rather than a configurable schedule — change the cron expression there if a different time suits better.
