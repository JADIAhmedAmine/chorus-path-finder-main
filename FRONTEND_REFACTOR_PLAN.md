# Frontend Refactor Plan — Chorus Pilot

> **Generated:** 2026-06-07 · React 18 + Vite + TS + Tailwind + shadcn/ui + React Query.
> Real file paths. Focus: unify the invoice/flux UI and stabilise types. No backend contract changes.

## 1. Current state (observed)
- Pages: `src/pages/*` (Dashboard, InvoiceList, InvoicesToProcess, InvoiceDetail, ChorusInvoiceDetail,
  EmissionRejections, ReceptionProcessing, FluxDepositPage, G2BFluxDepositPage, PdfToFluxPage,
  References, Monitoring, Settings, FluxHub…).
- Status rendering is **fragmented**: `src/components/common/StatusBadge.tsx`,
  `src/components/chorus/ChorusStatusBadge.tsx`, `src/components/chorus/InvoiceStatusBadge.tsx`,
  plus new `src/components/flux/{Invoice,Flux}SummaryCard.tsx`.
- Status truth source: `src/lib/status-utils.ts` (`getChorusRawStatusConfig`, classification).
- Data access via React Query: `src/lib/queries/db.ts`, helpers in `src/lib/chorus/actionableInvoices.ts`.
- **40 pre-existing `tsc` errors** in untouched files (reception cards, storage, InvoiceNotifications, tests).

## 2. Target architecture
```
src/components/invoice/
  InvoiceCard.tsx        # canonical card (wraps logic; reuses flux/InvoiceSummaryCard styles)
  InvoiceListItem.tsx    # canonical row
  InvoiceStatus.tsx      # single badge -> status-utils
  invoiceActions.ts      # status -> allowed actions (Voir/Corriger/Suivre/Compléter)
  invoiceDirection.ts    # emission vs reception derivation
```
- **Single status source:** everything renders via `status-utils.ts`. Deprecate the 3 badge variants
  (keep thin wrappers re-exporting the unified one to avoid breakage, then remove).
- **Single click model:** row → detail (`/invoices/:id` or `/invoices/chorus/:id`); actions are explicit
  buttons (no row-nav hijack).

## 3. Workstreams (maps to backlog)

### FR-A · Stabilise types (P0-1)
- Fix unions for reception results (`ReceptionConsult*`), `SyncRunSummary` props, predicate types in
  `InvoiceNotifications.tsx` / `ReceptionProcessing.tsx`; `storage.ts` never-type; `InvoiceCreate.tsx` `<details defaultOpen>`.
- **Acceptance:** `tsc -p tsconfig.app.json --noEmit` clean.

### FR-B · Canonical InvoiceCard / ListItem (P1-1, P1-2)
- Build from `Invoice` (`src/types/index.ts`); derive direction; reuse `InvoiceSummaryCard` visual.
- Adopt in `InvoiceList`, `InvoicesToProcess`, `EmissionRejections`, `ReceptionProcessing` (page-by-page).
- **Acceptance:** all lists use the shared component; no visual/behavior regression.

### FR-C · Harmonise statuses & badges (P1-3)
- One `InvoiceStatus` badge over `getChorusRawStatusConfig`; migrate usages; delete duplicates last.
- **Acceptance:** identical color/label per status across all pages.

### FR-D · Contextual actions + guidance (P1-4, P1-5)
- `invoiceActions.ts` derives actions from status (reuse `actionableInvoices.ts`,
  `InvoiceActionGuide.tsx`); ensure `ProcessExplanationCard` present on each Chorus page.
- **Acceptance:** actions match status; every page has a sourced explanation.

### FR-E · Dynamic click + page consistency (P1-6, P1-7)
- Unify navigation + filters across processed/rejected/suspended/to-process.
- **Acceptance:** consistent UX; keyboard accessible.

### FR-F · Wire Flux hub KPIs (P2-1 FE)
- New `src/lib/flux/fluxDepositsService.ts` (calls `GET /api/chorus/flux/deposits[/stats]`).
- Replace placeholders in `src/pages/FluxHub.tsx` with real KPIs + `FluxSummaryCard` list.
- **Acceptance:** hub shows real flux numbers; empty state only when truly empty.

### FR-G · CR panel + env UX (P2-3, P2-4 FE)
- CR viewer component (plain-language outcome) on flux/invoice detail.
- Settings env switch with explicit prod confirmation (`SettingsPage.tsx`, sidebar env badge).

## 4. Conventions to keep
- Tailwind tokens already in use (`success/warning/info/destructive-soft`, `card-elevated`, `status-badge`).
- React Query defaults from `App.tsx`; keep query keys stable.
- Keep components presentational; data fetching in `src/lib/queries|flux`.

## 5. Risks
- Broad refactor touching many pages → mitigate with the shared component + incremental page adoption + visual checks.
- Deprecating badges may hit hidden imports → keep re-export shims for one release.
