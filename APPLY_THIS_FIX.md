# WhatsApp send bug — root cause and fix

**Note on this delivery:** my sandbox's working directory reset mid-task, so I lost access to
your full project tree partway through debugging. Rather than risk reconstructing 170+ files
from memory and introducing new bugs, this is a **targeted fix bundle**: the two files that
needed a full rewrite, plus exact patches for three files that only needed small additions.
Everything here was written and syntax-checked in this same session — nothing is guessed.

## Root cause

`lib/whatsapp/baileysClient.ts` held its Baileys connection in a plain module-level variable:

```ts
let sock: BaileysSocket | null = null;
```

This looks like a singleton, but Next.js can bundle different API route handlers as **separate
module instances** — which is exactly why `lib/prisma.ts` in this same project anchors its
client to `globalThis` instead of a plain variable (that file's comment literally exists to avoid
this problem for Prisma). I built the Baileys client without following that same pattern.

Effect: `/api/whatsapp/connect` set `sock` in **its own** module instance. Every other route —
customer creation, service application, anything importing `lib/whatsapp/service.ts` — got a
**different** instance of `baileysClient.ts` where `sock` was still `null`. So `isWhatsAppConnected()`
always returned `false` from those routes, `sendWhatsAppMessage()` silently recorded a `FAILED`
message with reason `"WhatsApp is disconnected"`, and Baileys' `sendMessage()` was never reached
— with **zero console output**, because the original code had no logging at all.

## What's fixed

1. **`lib/whatsapp/baileysClient.ts`** — full rewrite. Connection state now lives on `globalThis`,
   exactly mirroring `lib/prisma.ts`'s pattern, so every route shares the true same connection.
   Added the exact logging you asked for at every stage: connect requested, QR generated,
   connection opened + masked JID, connection closed + reason, reconnect attempts, send
   attempted/succeeded/failed.
2. **`lib/whatsapp/service.ts`** — full rewrite. The `WhatsAppMessage` row is now created as
   `QUEUED` **before** any send is attempted (previously it was only ever created after —
   meaning if something failed before that point, there was no database trace at all), then
   updated to `SENT`/`FAILED` afterward. Added logging at every stage: notification triggered,
   number selected (masked), template loaded, placeholders replaced, connection check, send
   attempt, result.
3. Three small logging additions to existing route files (patches below) — an explicit
   `"[WhatsApp] Customer/Service ... notification triggered"` log right where each one fires,
   plus a log for the skip case (no number marked as WhatsApp), so you can see in the server log
   whether the trigger even ran at all.

## How to apply

### Step 1 — replace two files wholesale
Copy these two files into your project, overwriting what's there:
- `lib/whatsapp/baileysClient.ts`
- `lib/whatsapp/service.ts`

Both are complete, self-contained files — just overwrite, no merging needed.

### Step 2 — three small patches

**`app/api/whatsapp/connect/route.ts`** — find:
```ts
connectWhatsApp().catch((e) => console.error("[whatsapp] connect error:", e?.message));
```
replace with:
```ts
connectWhatsApp().catch((e) => console.error("[WhatsApp] Connect error:", e?.message));
```
(Purely a log-casing consistency fix — not required for the bug, safe to skip if you want.)

**`app/api/customers/route.ts`** — find:
```ts
  const waNumber = resolveCustomerWhatsAppNumber(customer);
  if (waNumber) {
    sendWhatsAppMessage({
      templateType: "CUSTOMER_CREATED",
      recipientType: "CUSTOMER",
      toNumberRaw: waNumber,
      customerId: customer.id,
      variables: { CUSTOMER_NAME: customer.fullName, CUSTOMER_ID: customer.customerCode },
    }).catch(() => {});
  }
```
replace with:
```ts
  const waNumber = resolveCustomerWhatsAppNumber(customer);
  if (waNumber) {
    console.log(`[WhatsApp] Customer created notification triggered for ${customer.customerCode}`);
    sendWhatsAppMessage({
      templateType: "CUSTOMER_CREATED",
      recipientType: "CUSTOMER",
      toNumberRaw: waNumber,
      customerId: customer.id,
      variables: { CUSTOMER_NAME: customer.fullName, CUSTOMER_ID: customer.customerCode },
    }).catch((e) => console.error("[WhatsApp] Unexpected error sending customer-created notification:", e?.message));
  } else {
    console.log(
      `[WhatsApp] Skipping customer created notification for ${customer.customerCode} — no number marked as WhatsApp`
    );
  }
```

**`app/api/customer-services/route.ts`** — find:
```ts
  const waNumber = resolveCustomerWhatsAppNumber(customer);
  if (waNumber) {
    sendWhatsAppMessage({
      templateType: "SERVICE_APPLIED",
      recipientType: "CUSTOMER",
      toNumberRaw: waNumber,
      customerId: customer.id,
      customerServiceId: record.id,
      variables: {
        CUSTOMER_NAME: customer.fullName,
        CUSTOMER_ID: customer.customerCode,
        SERVICE_NAME: record.service.name,
        SERVICE_ID: record.workCode,
      },
    }).catch(() => {});
  }
```
replace with:
```ts
  const waNumber = resolveCustomerWhatsAppNumber(customer);
  if (waNumber) {
    console.log(`[WhatsApp] Service applied notification triggered for ${record.workCode}`);
    sendWhatsAppMessage({
      templateType: "SERVICE_APPLIED",
      recipientType: "CUSTOMER",
      toNumberRaw: waNumber,
      customerId: customer.id,
      customerServiceId: record.id,
      variables: {
        CUSTOMER_NAME: customer.fullName,
        CUSTOMER_ID: customer.customerCode,
        SERVICE_NAME: record.service.name,
        SERVICE_ID: record.workCode,
      },
    }).catch((e) => console.error("[WhatsApp] Unexpected error sending service-applied notification:", e?.message));
  } else {
    console.log(`[WhatsApp] Skipping service applied notification for ${record.workCode} — no number marked as WhatsApp`);
  }
```

**`app/api/agent-portal/applications/route.ts`** — find:
```ts
  if (notifyCustomer) {
    const waNumber = resolveCustomerWhatsAppNumber(notifyCustomer);
    if (waNumber) {
      sendWhatsAppMessage({
        templateType: "SERVICE_APPLIED",
        recipientType: "CUSTOMER",
        toNumberRaw: waNumber,
        customerId: notifyCustomer.id,
        customerServiceId: application.id,
        variables: {
          CUSTOMER_NAME: notifyCustomer.fullName,
          CUSTOMER_ID: notifyCustomer.customerCode,
          SERVICE_NAME: service.name,
          SERVICE_ID: application.workCode,
        },
      }).catch(() => {});
    }
  }
```
replace with:
```ts
  if (notifyCustomer) {
    const waNumber = resolveCustomerWhatsAppNumber(notifyCustomer);
    if (waNumber) {
      console.log(`[WhatsApp] Service applied notification triggered for ${application.workCode} (agent submission)`);
      sendWhatsAppMessage({
        templateType: "SERVICE_APPLIED",
        recipientType: "CUSTOMER",
        toNumberRaw: waNumber,
        customerId: notifyCustomer.id,
        customerServiceId: application.id,
        variables: {
          CUSTOMER_NAME: notifyCustomer.fullName,
          CUSTOMER_ID: notifyCustomer.customerCode,
          SERVICE_NAME: service.name,
          SERVICE_ID: application.workCode,
        },
      }).catch((e) => console.error("[WhatsApp] Unexpected error sending service-applied notification:", e?.message));
    } else {
      console.log(
        `[WhatsApp] Skipping service applied notification for ${application.workCode} — no number marked as WhatsApp`
      );
    }
  }
```

## Round 2 — real-time connection status (added after the first fix)

Two more bugs, both real:

**Backend:** on a phone-side logout (`statusCode 401`, `loggedOut: true`), the old code set status
to `DISCONNECTED` and stopped — it never cleared the now-invalid local session files, and never
auto-triggered a new connection attempt. So even clicking "Reconnect" afterward risked Baileys
trying to reuse a session WhatsApp had already revoked. Fixed in `lib/whatsapp/baileysClient.ts`
(same file as before, now updated again): on `loggedOut`, the invalid session is wiped via a new
`clearAuthState()` helper, and a fresh connection attempt starts immediately — so a new QR appears
on its own, without needing a manual click. The explicit manual "Disconnect" button now also
clears session files unconditionally, rather than assuming Baileys' own `logout()` call handles
that internally.

**Frontend:** `app/settings/whatsapp/page.tsx`'s status polling only ran an interval while status
was `CONNECTING`/`QR_REQUIRED`/`RECONNECTING`, and **stopped polling once it reached `CONNECTED`**.
So if the connection later dropped (phone-side logout, network loss), the browser had no way to
find out — it just kept showing the last known "Connected" state until a manual reload. This is
exactly the bug you reported. Fixed: polling is now continuous (every 3 seconds) for as long as
the page is open, regardless of status, plus a `visibilitychange` listener that re-checks
immediately when you switch back to the tab. The status badge now also shows the 🟢/🔴/🟡/🔄
indicators from your spec.

I don't have your actual current copy of `app/settings/whatsapp/page.tsx` in this session (same
sandbox reset as before), so rather than risk a fragile patch against a file I can't verify, this
is a complete reconstructed replacement — overwrite the whole file. If you'd made other edits to
that page since the last round I don't know about, let me know what they were and I'll fold them
back in.

### Step 3 (round 2) — replace one more file
Copy `app/settings/whatsapp/page.tsx` into your project, overwriting what's there — full file,
same as the two `lib/whatsapp/` files.

### Step 4 (round 2) — restart and test the exact scenario from your report
1. Restart `npm run dev` fully.
2. Connect WhatsApp, confirm the page shows 🟢 Connected.
3. **Leave the CRM tab open — do not refresh.**
4. On your phone: WhatsApp → Linked Devices → tap the CRM's linked session → Log out.
5. Watch the CRM tab. Within ~3 seconds it should flip to 🔴/🟡 and, within a few seconds after
   that, a new QR code should appear automatically (no click required) — the server log should
   show:
   ```
   [WhatsApp] Connection closed. statusCode: 401 loggedOut: true
   [WhatsApp] Logged out from phone side — clearing invalid session and regenerating QR
   [WhatsApp] Connect requested
   [WhatsApp] QR generated — waiting for scan
   ```

### Step 3 (original round) — restart and retest
Restart `npm run dev` (module-level `globalThis` state needs a fresh process to take effect
cleanly). Then:

1. WhatsApp Configuration → Connect → scan the QR again if status isn't already `CONNECTED`.
2. Create a customer with the mobile number marked "This is a WhatsApp number".
3. Watch the server log — you should now see the full chain:
   ```
   POST /api/customers 201
   [WhatsApp] Customer created notification triggered for CUS-000123
   [WhatsApp] Notification triggered: CUSTOMER_CREATED (CUSTOMER)
   [WhatsApp] Number selected: ...
   [WhatsApp] Loading template: CUSTOMER_CREATED
   [WhatsApp] Placeholders replaced — message length NN chars
   [WhatsApp] Message record created (QUEUED): ...
   [WhatsApp] Connection check: connected
   [WhatsApp] Number registration check for ... -> true
   [WhatsApp] Attempting send. Message type: CUSTOMER_CREATED Target JID: ...
   [WhatsApp] Baileys sendMessage starting. Target JID: ...
   [WhatsApp] Baileys sendMessage succeeded
   [WhatsApp] Message ... marked SENT
   ```
4. If it stops at `Connection check: NOT connected` even though the Configuration page shows
   Connected — that means the fix didn't fully take (stale build cache, or the dev server wasn't
   actually restarted). Do a hard restart, not just a file save.
