# Blue Team Africa — Client Portal
**Last updated:** 2026-05-20
**Repo:** BlueTeamAfrica/blueteam-portal
**Live URL:** https://portal.blueteamafrica.com
**Working with:** Claude Code

---

## What this project is

SaaS client portal for Blue Team Africa. Two surfaces in one codebase: `/portal` for staff (admin/owner) and `/client` for paying clients. Handles client management, services, invoices, subscriptions, support tickets, notifications, and PDF exports.

---

## Platform & Setup

- **Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Firebase Auth + Firestore, nodemailer, @react-pdf/renderer
- **Multi-tenancy:** All data under `tenants/{tenantId}`. User membership via `userTenants/{uid}_{tenantId}`.
- **Roles:** `admin`/`owner` → `/portal`, `client` → `/client/dashboard`
- **Billing plans:** Gated via `lib/tenantBillingPlan.ts` — must stay in sync with `firestore.rules`
- **Deploy:** Vercel (inferred), canonical repo is `~/Documents/blueteam-portal` — NOT just the monorepo copy

---

## What's built

- Full portal: clients, services, invoices, subscriptions, projects, support tickets, notifications
- PDF invoice generation, transactional email, billing plan gating
- Cron API routes for recurring invoices and client notifications
- Firestore rules and indexes in repo
- Mobile-first client layout with card lists

---

## Active issue — invoice permission denied

Owner role is getting permission denied when creating invoices. Root cause not fully traced yet. Need to instrument:
1. UI gate in the invoice creation flow
2. `planPermissions/{planId}.canInvoices` Firestore document
3. Firestore rules line for `canInvoices`
4. Confirm owner role is being resolved correctly via `tenantBillingPlan.ts`

This was interrupted and not resolved as of last session.

---

## Critical rules

- Always push changes to the **standalone `~/Documents/blueteam-portal` repo**, not only the monorepo copy
- `firestore.rules` must stay in sync with `lib/tenantBillingPlan.ts` — any plan resolution changes need both updated
- Never commit `.env.local`
- Deploy rules after changes: `firebase deploy --only firestore:rules,firestore:indexes`

---

## What's next

1. Resolve invoice create permission for owner role
2. Verify production cron schedules on Vercel
3. Keep Firestore rules in sync after any plan changes
