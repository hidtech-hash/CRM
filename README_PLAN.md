# Status of this request

I don't have your current project files in this session (a sandbox reset between our last
few turns, same issue as before). Rather than guess at schema/API changes against files I
can't see — which is exactly what your own request tells me not to do ("do not assume
something does not exist... reuse existing functionality... inspect before coding") — I've
split this into what's genuinely safe to build standalone right now, and what needs your
actual current codebase first.

**What I need from you:** zip your current `crm-app` folder (skip `node_modules` and `.next`)
and upload it. The moment I have it, I'll work through the remaining list below in the same
session.

---

## Delivered now (self-contained, don't depend on your current file state)

### Location system — items #13, #14, #15, #16, #17
- `lib/location/types.ts`, `lib/location/indiaLocations.ts`, `lib/location/queries.ts` — a
  reusable State → District → Taluka data layer. **Honest scope note:** I filled in real,
  accurate district/taluka data for Maharashtra only (matching your own worked example,
  Ratnagiri → Chiplun) — I don't have web access in this sandbox to verify a complete,
  accurate ~800-district national dataset, and fabricating one would risk silently wrong data
  reaching a real customer's address. Every other state is listed (so the State dropdown is
  complete) with an empty district list and a clear placeholder. Swapping in a verified full
  dataset later means editing only `indiaLocations.ts` — no component or form changes, since
  everything else goes through `queries.ts`.
- `components/LocationSelect.tsx` — the one reusable cascading selector component. Resets
  District/Taluka when State changes, resets Taluka when District changes, shows honest
  empty/loading states, works identically wherever it's dropped in.
- **Not yet done (needs your files):** actually wiring this component into the Employee
  customer form, the Agent customer form, and the customer edit form — replacing whatever
  free-text State/District/Tehsil inputs currently exist there. That's a small change per form
  once I can see them, but I'm not going to guess at your exact current field names/JSX.

### Agent navbar flicker — items #20, #21, #22
**Root cause found and fixed:** `AgentNav` was fetching `enterpriseName` itself via a
`useEffect` *after* mounting — a real gap between first paint (showing "Agent Portal") and
that fetch resolving. Not a hydration bug, just a fetch-after-mount gap.
- `lib/auth.ts` (partial — merge instructions inside the file) — `enterpriseName` is now
  resolved once at sign-in (a single extra query, only for Agent logins) and embedded directly
  in the JWT/session, so it's available the moment `useSession()` returns real data.
- `components/AgentNav.tsx` (complete replacement) — reads `session.user.enterpriseName`
  directly, no second fetch, no "Agent Portal" fallback text at any point; shows a neutral
  loading skeleton only during NextAuth's own (brief) session resolution.
- **Trade-off, documented in the file:** since this is JWT-based, an enterprise-name edit
  won't show up for an already-logged-in Agent until they log out and back in. Flagging this
  now rather than presenting it as unlimited.

---

## Needs your project files — full plan, ready to execute the moment I have them

### 1. User creation & management (items #1, #18, #19)
Will inspect your existing `User` model, current Admin/Manager/Employee creation flow (I
recall building Agent-login creation inside the Agents module — need to check whether a
general User Management screen for Manager/Employee already exists or needs building), and
extend/build: a User Management page (Admin-only for Manager creation, Admin+Manager for
Employee per your existing role tiers), full server-side validation (uniqueness, password
rules, role validity), and confirm every mutation is permission-gated server-side, not just
UI-hidden.

### 2. Employee mobile number for WhatsApp (item #2)
Check whether `User` already has a `mobile` field (I don't recall adding one — Employees may
currently only have name/email). If missing, add it as a migration, reusing the same field
name/pattern already used on Customer/Agent (`mobile`), not a new WhatsApp-specific field.

### 3–4. Agent → Employee WhatsApp notification + new template (items #3, #4)
Add `AGENT_SERVICE_APPLICATION_TO_EMPLOYEE` to the existing `WhatsAppTemplateType` enum
(additive, same pattern as the three existing types), seed its default body, and hook a call
into the same centralized `sendWhatsAppMessage()` at the point an Agent's application is
created — sending to whichever Employee the "existing assignment/workflow logic" identifies
(need to check: is there always an assigned employee at agent-submission time, or does this
need to go to a role-wide "new application" queue recipient list? Your architecture has agent
submissions start unassigned — I'll confirm the intended recipient with you once I see the
current assignment flow, since sending to "no one" isn't valid).

### 5. No WhatsApp duplication (item #5)
Structural constraint I'll hold throughout — every new notification goes through the existing
`lib/whatsapp/service.ts` → `baileysClient.ts` chain, zero new connections/templates-per-user.

### 6–9. Service status change → customer notification, extensible per-status (items #6, #7, #8, #9)
This is the most architecturally significant new piece. Plan: extend `WhatsAppTemplateType`
with one entry per customer-visible status (or, cleaner: add a single
`APPLICATION_STATUS_CHANGED` template type with a `{STATUS}` variable, rather than one
template per status — avoids the enum growing unboundedly every time a status is added,
matches "adding a status notification later shouldn't require rewriting the architecture").
I'll propose this design to you explicitly before building it, since it's a real judgment call
your spec leaves open. Idempotency (item #9): the send call goes inside the existing
`PUT /api/customer-services/:id` handler, gated on `data.status && data.status !== existing.status`
— the exact same guard already used for the existing status-change activity log entry, so
"saved without an actual status change" already doesn't fire it; reusing that condition rather
than adding a new one.

### 10. Customer WhatsApp number selection (item #10)
Already correct and unchanged — `resolveCustomerWhatsAppNumber()` already implements exactly
this rule. Nothing to do here except reuse it for the new status-change notification too.

### 11–12. Agent vs Employee customer form parity (items #11, #12)
Needs a direct diff of both forms once I have them. From memory, the Agent apply-flow's
inline "new customer" form (inside `/agent/apply`) was deliberately minimal (name, mobile,
email, district, state, pincode) compared to the full Employee/Admin customer form (adds
village, tehsil, address, DOB, gender, notes, WhatsApp checkboxes). Plan: bring the Agent
form's field set up to match, excluding only genuinely system-controlled fields (customerCode,
createdBy, timestamps) — consistent with your own list of what should stay controlled.

### 23–25. Template management categories + Agent Payment Reminder integrity (items #23, #24, #25)
The new templates join the existing Message Templates UI as more rows in the same list — no
new UI system. I will explicitly re-verify (not just assume) that the existing Agent Payment
Reminder pending-calc, UPI link generation, 7-day threshold, and same-day dedupe are
untouched by any of this — that logic lives entirely in `lib/agentContext.ts` and
`lib/upi.ts`, which nothing in this request needs to modify.

### 26. Failure handling for new notifications (item #26)
Automatic — every new call site uses the same `sendWhatsAppMessage()`, which already never
throws and always logs to `WhatsAppMessage`. No new failure-handling code needed, just correct
reuse.

### 27–29. Schema/API consistency, full audit, non-regression (items #27, #28, #29)
Standard practice I'll follow once I have your files — reuse over duplication, additive
migrations only, full regression pass on the explicitly listed existing features before
calling anything done.

### 30. Testing (item #30)
Will walk each listed test scenario explicitly in my final summary, the same way I have for
every previous round in this project, not just assert completion.

---

## What "done" will look like next time
Once you upload the project, I'll work through the list above in the same structure your
request asked for: files changed, schema changes, APIs changed/added, templates added,
location system wiring, user-management changes, agent portal changes, tests actually
performed, and any genuinely unavoidable remaining gap — called out explicitly, not glossed
over.
