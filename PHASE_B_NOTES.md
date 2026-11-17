# Phase B — Employee ID, profile fields, agent hardening (+ Phase A leftovers)

Contains ONLY the files changed in this round. They are meant to be applied ON TOP of the previous
`crm-app-changes.zip`. Nothing else in your project is touched.

## Files
Modified: prisma/schema.prisma · prisma/seed.ts · app/api/users/route.ts · app/api/users/[id]/route.ts ·
app/users/page.tsx · lib/validation/user.ts · lib/whatsapp/notifications.ts · lib/whatsapp/baileysClient.ts ·
app/api/agents/route.ts
New: prisma/migrations/20261108120000_employee_id_and_profile_fields/migration.sql · lib/employeeCode.ts

## APPLY — exact order (this is also what fixes the 28 type errors you pasted)
1. Move `crm-app.zip` and `crm-app.rar` OUT of the project folder (they contain .env and the WhatsApp session).
2. Stop the dev server (on Windows `prisma generate` fails with EPERM while it is running).
3. Checkpoint: `git status` (confirm .env, .baileys-auth, public/uploads are NOT listed), then commit.
4. Back up the database:  pg_dump -h localhost -U <your_db_user> -F c -f crm_db_backup.dump crm_db
5. Copy these files over the project. Before overwriting, keep a copy of your current prisma/schema.prisma and
   app/api/agents/route.ts so you can compare (`git diff` afterwards shows the full change against your last commit).
6. npx prisma migrate deploy      # applies BOTH pending migrations (additive; see below)
7. npx prisma generate
8. npx tsc --noEmit               # expected: 0 errors
9. npm run build                  # expected: success
10. npm run dev, then run the checklist below.

## What the migration does (non-destructive)
- Adds table `Counter`; adds columns User.employeeCode (unique), User.dateOfJoining (date), User.mobileIsWhatsapp.
- Writes ONLY the new columns: every existing Employee gets EMP-000001, EMP-000002, ... (oldest first) and the
  EMPLOYEE counter starts after them. No existing value is changed or deleted.
- Written by hand and NOT run against PostgreSQL (none available to me). If `migrate deploy` errors, stop and send me the message.

## What changed
- Employee ID: generated on the server from the Counter table with ONE atomic INSERT .. ON CONFLICT .. RETURNING,
  inside the same transaction that creates the user (no count()+1, no gaps if the insert fails). Never accepted from
  the client; shown read-only; Managers have none; a Manager changed to Employee gets one once and keeps it.
- Users form/API: Date of Joining (optional, not in the future), "this is a WhatsApp number" flag, Employee ID column and
  search, duplicate email rejected (in addition to login ID and mobile). Agent is still NOT selectable (role must be
  MANAGER or EMPLOYEE, enforced by the server).
- Employee WhatsApp notifications now go only to numbers flagged as WhatsApp.
- Agent creation (same single workflow, permissions unchanged = Admin/Manager): enterprise name trimmed and mandatory,
  login ID lower-cased and checked case-insensitively against ALL accounts, duplicate agent mobile rejected,
  agent code collisions retry with the next free code, agent + login still created together in one transaction.
- Baileys type error (line 81) fixed — the only error not caused by the stale Prisma client.

## Decisions to confirm
- Duplicate agent mobile is now rejected (409). Say so if one phone may legitimately represent two agents.
- Duplicate user email is now rejected.
- Agent password policy is unchanged (min 6); only new Manager/Employee passwords use the 8+ letter+number rule.

## Tested vs NOT tested
Verified here: syntax / imports / undefined names via tsc (clean); Employee ID formatting and the allocator's SQL shape and
50-way parallel use against a MOCK counter. NOT verified (need your machine): the migration, real PostgreSQL concurrency,
type-check against the regenerated client, `next build`, every API call and UI page, and logins.

## Checklist (Phase B)
1. Admin → Users → Add Employee (mobile + WhatsApp box + date of joining) → saved; list shows EMP-0000nn; edit form shows it read-only.
2. Create a second Employee quickly twice (two browser tabs) → different IDs.
3. Log out; log in as the new Employee with the login ID/password → success. Same for a new Manager (no Employee ID).
4. Duplicate login ID, mobile and email each rejected with a clear message; weak password rejected; future joining date rejected.
5. Role dropdown offers only Manager/Employee (Manager actor: Employee only). Agent is never offered.
6. Check the database: `npx prisma studio` (view only) → User rows have employeeCode/dateOfJoining/mobileIsWhatsapp; passwordHash is a bcrypt hash.
7. Agents → Add Agent as Admin/Manager: Enterprise Name blank → rejected; with login → agent logs in and navbar shows the enterprise name;
   same mobile again → rejected; login ID with different capitals → rejected.
8. Existing agent login, agent apply, agent payment pages still work.
