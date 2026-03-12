# Migration Baseline Snapshot

## Date/Time
2026-02-06 (auto-generated baseline)

## Current HEAD
```
53c2ee1dae46f3ddba5d1afd49e473a4e2359ab1
```

## Milestone Hashes (from git log)

| Milestone | Hash | Commit Message |
|---|---|---|
| a) Gate-1 Safety Switch + Toggle UI | `9ed56e1` | Add a backend selection toggle and system status indicator |
| b) /api/table-read hardening + orderBy strict | `fae4942` | Improve API security by validating data sorting parameters |
| c) Supplier alias fix | `71dd8fc` | Improve supplier data handling and error logging for API requests |
| d) Latest RPC batch (Stage-2K-Batch-RPC-DIALOGS) | `ab45444` | Update data fetching to use a new gateway service |

## Recent Commit History (last 20)
```
53c2ee1 Saved progress at the end of the loop
6ae39cd Update purchasing filters to use new data gateway
6533c36 Transitioned from Plan to Build mode
9033a8f Replace direct database calls with a data gateway abstraction
52948f1 Update journal entry page to use data gateway for invoice lookups
ab45444 Update data fetching to use a new gateway service
2b4346e Update employee code generation to use new data gateway
1f8b73a Update sales returns process to use a new data gateway for RPC calls
518ce61 Update customer and product pages to use a new data gateway for remote procedure calls
ea18299 Saved progress at the end of the loop
6e9380f Update system to use new data gateway for remote procedure calls
7d95581 Transitioned from Plan to Build mode
82e0517 Saved progress at the end of the loop
5858184 Update database tests to use data gateway for RPC calls
30b524d Migrate legacy cleanup dialog to use data gateway for RPC calls
f25a768 Update receipt creation and voiding to use data gateway
49ac91d Migrate sales return RPC calls to data gateway
c219a3f Migrate credit note atomic RPC calls to data gateway
451c6f9 Update point of sale returns to use data gateway for RPC calls
2d92d4f Update credit notes page to use data gateway for RPC calls
```

## Remaining Supabase Usage Summary

### supabase.from() — 6 files, 23 calls
| File | Count | Type |
|---|---|---|
| PerformanceTests.tsx | 18 | Health tests (optional) |
| TransfersCenterPage.tsx | 1 | Production |
| TransferDetailsDialog.tsx | 1 | Production |
| TransferReceipt.tsx | 1 | Production |
| TransferHistoryReport.tsx | 1 | Production |
| atomicWriteGuard.ts | 1 | Infrastructure |

### supabase.rpc() — 5 files, 9 calls
| File | Count | Type |
|---|---|---|
| POSDebugPanel.tsx | 4 | Production |
| AuthenticationTests.tsx | 2 | Health tests |
| AuthContext.tsx | 1 | Auth (stays) |
| QuickActionsBar.tsx | 1 | Production |
| SecurityTests.tsx | 1 | Health tests |

### supabase.functions.invoke() — 13 files, ~30 calls
Edge Functions (ZATCA, auth, admin) — stays on Supabase by decision.

### supabase.auth — 16 files, ~34 calls
Auth — stays until session-based auth implemented.

### supabase.storage — 1 file
SupplierDocuments.tsx — stays temporarily.

### Production files needing migration: 7 files, 10 calls
1. TransfersCenterPage.tsx (1 .from)
2. TransferDetailsDialog.tsx (1 .from)
3. TransferReceipt.tsx (1 .from)
4. TransferHistoryReport.tsx (1 .from)
5. atomicWriteGuard.ts (1 .from)
6. POSDebugPanel.tsx (4 .rpc)
7. QuickActionsBar.tsx (1 .rpc)
