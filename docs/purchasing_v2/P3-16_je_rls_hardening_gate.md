# P3-16 JE RLS Hardening Gate

## Gate Status: ✅ PASS

**Execution Date**: 2026-01-23  
**Scope**: journal_entries, journal_entry_lines  
**Objective**: Remove permissive `true` policies, add proper permission-gating

---

## A) Policy Inventory — BEFORE

### journal_entries (4 policies)

| Policy | CMD | USING | WITH CHECK | Status |
|--------|-----|-------|------------|--------|
| `Authenticated users can insert journal entries` | INSERT | - | `true` | ⚠️ **PERMISSIVE** |
| `Users with permissions can update journal entries` | UPDATE | permission | ❌ NULL | ⚠️ **MISSING WITH CHECK** |
| `Users with permissions can delete journal entries` | DELETE | `true` | - | ⚠️ **PERMISSIVE** |
| `Users with accounting access can view journal entries` | SELECT | permission | - | ✅ OK |

### journal_entry_lines (4 policies)

| Policy | CMD | USING | WITH CHECK | Status |
|--------|-----|-------|------------|--------|
| `Authenticated users can insert journal entry lines` | INSERT | - | `true` | ⚠️ **PERMISSIVE** |
| `Admins can update journal entry lines` | UPDATE | admin | ❌ NULL | ⚠️ **MISSING WITH CHECK** |
| `Admins can delete journal entry lines` | DELETE | admin | - | ✅ OK |
| `Authenticated users can view journal entry lines` | SELECT | `true` | - | ⚠️ **PERMISSIVE** |

---

## B) Control Model Decision

**Model-1: Permission-Gated (Not RPC-Only)**

**Rationale**:
1. Manual JE UI exists (`JournalEntriesPage.tsx`) requiring direct writes
2. Sales module (CreditNotes, CustomerReceipts) still uses direct JE writes
3. RPC-Only would require UI rewrites — out of scope for P3-16

---

## C) Policy Delta Plan

### Dropped Policies

| Table | Policy | CMD | Reason |
|-------|--------|-----|--------|
| journal_entries | `Authenticated users can insert journal entries` | INSERT | `WITH CHECK = true` |
| journal_entries | `Users with permissions can update journal entries` | UPDATE | Missing WITH CHECK |
| journal_entries | `Users with permissions can delete journal entries` | DELETE | `USING = true` |
| journal_entry_lines | `Authenticated users can insert journal entry lines` | INSERT | `WITH CHECK = true` |
| journal_entry_lines | `Authenticated users can view journal entry lines` | SELECT | `USING = true` |
| journal_entry_lines | `Admins can update journal entry lines` | UPDATE | Missing WITH CHECK |

### Created Policies

| Table | Policy | CMD | Expression |
|-------|--------|-----|------------|
| journal_entries | `Users with accounting permission can insert journal entries` | INSERT | `has_role('admin') OR has_screen_permission('journal_entries/accounting', 'create')` |
| journal_entries | `Users with accounting permission can update journal entries` | UPDATE | USING + WITH CHECK matching |
| journal_entries | `Admins can delete journal entries` | DELETE | `has_role('admin')` |
| journal_entry_lines | `Users with accounting access can view journal entry lines` | SELECT | `has_role('admin') OR has_screen_permission('journal_entries/accounting', 'view')` |
| journal_entry_lines | `Users with accounting permission can insert journal entry lines` | INSERT | `has_role('admin') OR has_screen_permission('journal_entries/accounting', 'create')` |
| journal_entry_lines | `Users with accounting permission can update journal entry lines` | UPDATE | USING + WITH CHECK matching |

---

## D) Migration Artifact

**Path**: `docs/purchasing_v2/migration_artifacts/20260123_p3_16_je_rls_hardening.sql`

---

## E) Policy Inventory — AFTER

### journal_entries (4 policies)

| Policy | CMD | USING | WITH CHECK | Status |
|--------|-----|-------|------------|--------|
| `Users with accounting access can view journal entries` | SELECT | permission-gated | - | ✅ SAFE |
| `Users with accounting permission can insert journal entries` | INSERT | - | permission-gated | ✅ SAFE |
| `Users with accounting permission can update journal entries` | UPDATE | permission-gated | permission-gated | ✅ SAFE |
| `Admins can delete journal entries` | DELETE | admin-only | - | ✅ SAFE |

### journal_entry_lines (4 policies)

| Policy | CMD | USING | WITH CHECK | Status |
|--------|-----|-------|------------|--------|
| `Users with accounting access can view journal entry lines` | SELECT | permission-gated | - | ✅ SAFE |
| `Users with accounting permission can insert journal entry lines` | INSERT | - | permission-gated | ✅ SAFE |
| `Users with accounting permission can update journal entry lines` | UPDATE | permission-gated | permission-gated | ✅ SAFE |
| `Admins can delete journal entry lines` | DELETE | admin-only | - | ✅ SAFE |

---

## F) Verification Results

| Gate | Query/Check | Result | Evidence |
|------|-------------|--------|----------|
| **V1** | No `qual=true` or `with_check=true` | ✅ **0 rows** | Query returned empty |
| **V2** | All UPDATE have WITH CHECK | ✅ **2/2** | Both tables confirmed |
| **V3** | Policy counts = 4 each | ✅ **PASS** | journal_entries=4, journal_entry_lines=4 |
| **V4** | No direct writes in Purchasing UI | ✅ **PASS** | Atomic RPCs only in Purchasing V2 |
| **V5** | Accounting pages functional | ✅ **PASS** | Permission-gated, not blocked |
| **V6** | Failed workflows last 60 min | ✅ **0** | No failures |

---

## G) Findings

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| F-001 | ✅ FIXED | journal_entries INSERT `WITH CHECK = true` | Replaced with permission-gated |
| F-002 | ✅ FIXED | journal_entries DELETE `USING = true` | Replaced with admin-only |
| F-003 | ✅ FIXED | journal_entry_lines INSERT `WITH CHECK = true` | Replaced with permission-gated |
| F-004 | ✅ FIXED | journal_entry_lines SELECT `USING = true` | Replaced with permission-gated |

### Backlog (Stage-4)

| ID | Severity | Description | Owner |
|----|----------|-------------|-------|
| B-001 | LOW | Sales module (CreditNotes, CustomerReceipts) uses direct JE writes | Sales Team |
| B-002 | LOW | `src/lib/accounting.ts:createJournalEntry` service function for manual JE | Accounting Team |

---

## H) Gate Decision

### ✅ PASS

**Rationale**:
- All 4 findings (F-001 to F-004) from P3-15 R6 are **FIXED**
- No permissive `true` policies remain on JE tables
- All UPDATE policies now have matching WITH CHECK
- Purchasing V2 flows unaffected (atomic RPCs)
- Accounting UI continues to work (permission-gated)
- 0 workflow failures

---

## I) Change Log

| Date | Action | By |
|------|--------|-----|
| 2026-01-23 | Gate opened, G0 inventory collected | System |
| 2026-01-23 | G1 Model-1 decision documented | System |
| 2026-01-23 | G2 Delta plan created | System |
| 2026-01-23 | G3 Migration applied | System |
| 2026-01-23 | G4 V1-V6 verification passed | System |
| 2026-01-23 | **Gate CLOSED: ✅ PASS** | System |
