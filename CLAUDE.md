# Project: blueteam-portal
## Purpose
Next.js 14 (App Router) SaaS portal for Blue Team Africa — managed security services company. Two user-facing surfaces sharing a single codebase: `/portal` (admin/staff internal dashboard) and `/client` (client-facing read-only views).

## Stack
- Next.js 14 (App Router), React 18, Tailwind CSS 3, TypeScript 5
- Auth: Firebase Auth (Email/Password only)
- Database: Firestore (multi-tenant, scoped under `tenants/{tenantId}`)
- PDF: `@react-pdf/renderer` (server-side)
- Email: Nodemailer singleton (`lib/mailer.ts`)
- `server-only` package enforces server/client boundary in `lib/server/`
- Hosting: Vercel

## Commands
```bash
npm run dev       # dev server (localhost:3000)
npm run build     # production build (ESLint errors ignored)
npm run lint
```
No tests configured — verify changes manually in the browser.

## Environment Variables (`.env.local`)
```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
NEXT_PUBLIC_PORTAL_URL=https://portal.blueteamafrica.com
```
Run `node setup-env.js` to scaffold `.env.local` from template.

## Auth & Role Routing
- Firebase Email/Password only
- On login, app reads `users/{uid}` from Firestore to determine role
- `admin` / `owner` → `/portal` | `client` → `/client/dashboard` | unauthenticated → `/login`
- Three context providers in order: `lib/authContext.tsx` → `lib/userProfileContext.tsx` → `lib/tenantContext.tsx`
- `TenantProvider` is critical — resolves `tenantId`, `role`, `clientId`; must be populated before any Firestore queries run

## Multi-Tenancy Model
- All data scoped under `tenants/{tenantId}`
- `tenants/{tenantId}` — tenant document (name, billing plan, subscription)
- `userTenants/{uid}_{tenantId}` — membership map (role, clientId, status); deterministic doc ID
- `users/{uid}` — user doc with `tenantId`, `role`, `clientId` (canonical for client users)
- Sub-collections: `clients`, `projects`, `services`, `invoices`, `subscriptions`, `tickets` (+ `tickets/{id}/replies`), `notifications`, `payments`, `planPermissions/{planId}`
- Every query must filter by `tenantId`; client users additionally filter by `clientId`

### Tenant resolution order (client and server)
1. `userTenants/{uid}_{tenantId}` (deterministic)
2. Legacy `userTenants` query (`userId == uid`)
3. `users/{uid}` (fallback; canonical for clients)

## Billing Plan Gating
`lib/tenantBillingPlan.ts` → `getBillingPlanIdFromTenant()` checks:
`tenant.subscription.plan` → `tenant.plan` → `tenant.billingPlanId` → fallback `"starter"`
Firestore rules mirror this logic exactly — keep in sync when changing plan resolution.

## API Routes
- `POST /api/invoices/[id]/pdf` — PDF generation; protected by Firebase Admin ID-token Bearer auth
- `POST /api/admin/generate-invoices` — Batch invoice creation
- `POST /api/cron/generate-invoices` — Same logic, cron-triggered
- `POST /api/admin/test-email` — Email delivery test
- `app/api/cron/client-notifications/` — Triggers notification + email for due/overdue invoices and service input requests

## Key lib/ Utilities
| File | Purpose |
|------|---------|
| `serviceHealth.ts` | Normalizes health status strings; "healthy" is default for unset values |
| `managedServiceCategories.ts` | Canonical list of service categories |
| `pdf/InvoicePdf.tsx` | React component rendered server-side to PDF |
| `mailer.ts` | Nodemailer singleton; `portalBaseUrl()` for staff links, `clientFacingEmailBaseUrl()` for client links (strips `/portal`) |
| `tenantContext.tsx` | Multi-tenant resolution — always read before touching Firestore query patterns |
| `portalSelectStyles.ts` | Shared react-select styling across portal forms |
| `tenantBillingPlan.ts` | Billing plan resolution — keep in sync with Firestore rules |

## Server-Only Helpers (lib/server/)
All files import `"server-only"`:
| File | Purpose |
|------|---------|
| `resolvePortalUser.ts` | Auth middleware for API routes (Bearer token → tenant membership) |
| `resolveRespondUser.ts` | Resolves who a response should go to |
| `invoiceNotify.ts` | Sends invoice email + upserts notification in one call |
| `processClientNotifications.ts` | Main driver for cron client-notifications endpoint |
| `generateDueInvoices.ts` | Invoice generation logic |
| `tenantInvoiceAccess.ts` | Server-side invoice permission checks |

## Notification System
- Server: `lib/server/notifications.ts` → `upsertNotification()` idempotently creates/updates `tenants/{tenantId}/notifications/{dedupeKey}`
- Targets: `targetType: "user"` (by uid) or `targetType: "role"` (by role + optional clientId)
- Client-side: `lib/notificationsFirestore.ts` + `hooks/useNotificationUnreadCount.ts`
- Bell icon: `components/notifications/NotificationBell.tsx`
- Clients may only update `status`, `readAt`, `updatedAt` (enforced by Firestore rules)

## Responsive Layout Pattern
- Staff: `app/portal/PortalShell.tsx` — fixed sidebar (w-64) desktop, slide-out drawer mobile
- Clients: `app/client/layout.tsx` — separate layout
- Mobile: card lists instead of tables on small screens

## Firestore Rules
- File: `firestore.rules`
- Deploy: `firebase deploy --only firestore:rules` from `blueteam-portal/` directory
- Must stay in sync with `lib/tenantBillingPlan.ts` and `lib/server/resolvePortalUser.ts`
- Composite indexes in `firestore.indexes.json` — deploy with `firebase deploy --only firestore:indexes`
- Where index is missing, pages fall back to in-memory sorting rather than crashing

## Client-Friendly Language
- `serviceHealth.ts` exports separate label maps for admin and client roles
- Never use admin label map in client-facing components

## Relation to Other Projects
- Lives inside `blueteamafrica` monorepo as `blueteam-portal/` subdirectory
- Standalone clone also maintained at `~/Documents/blueteam-portal` — sync with rsync after changes
- No dependency on `secure-reporter-*` codebases

## Open Threads
- [ ] Invoice create permission denied for portal owner role — Firestore rules need to grant `owner` role write access to invoices collection
- [ ] Verify all role-based access rules are committed and deployed
- [ ] Keep `firestore.rules` in sync with `getBillingPlanIdFromTenant()` after any plan resolution changes

## Key Conventions
- Security-first: never relax Firestore rules without explicit review
- Role hierarchy: owner > admin > client — verify before changing
- Always read `tenantContext.tsx` before modifying any Firestore query pattern
- Firestore rules changes must be committed AND deployed before testing
- `portalBaseUrl()` for staff email links; `clientFacingEmailBaseUrl()` for client email links — never mix
- Blueprints before coding — plan rule changes in chat before implementing

## Do Not Touch
- Auth flow unless explicitly scoped
- Firestore rules without first reviewing current committed state
- Admin label maps in client-facing components
- `lib/server/` files without importing `"server-only"`

## Session Start Checklist
1. Read this file
2. Read `MASTER_HANDOVER.md`
3. State which open thread you are targeting before writing any code

## Corrections
- [Date] — [mistake Claude made] → [correct approach]
