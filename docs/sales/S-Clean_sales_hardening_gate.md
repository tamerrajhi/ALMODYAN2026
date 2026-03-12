# S-Clean Sales Hardening Gates

**Date**: 2026-01-24  
**Status**: ✅ S-Clean-1 COMPLETE

---

## S-Clean-1: POS Piece Returns Atomic RPC — Evidence Pack

### Step A: Schema Confirmation ✅

| Table | Expected Columns | Actual | Match |
|-------|------------------|--------|-------|
| `returns` | id, return_code, sale_id, branch_id, status, client_request_id, post_return_status | ✅ All present | ✅ |
| `return_items` | id, return_id, item_id, sale_item_id, return_price | ✅ All present | ✅ |
| `jewelry_items` | id, item_code, sale_status, sold_at, sale_id, branch_id, is_available_for_sale | ✅ All present | ✅ |
| `item_movements` | id, item_id, movement_type, reference_type, reference_id, return_id, cost | ✅ All present | ✅ |
| `customer_credits` | id, customer_id, branch_id, credit_amount, return_id, credit_type, balance_after | ✅ All present | ✅ |
| `invoices` | id, invoice_number, invoice_type, return_id, branch_id, customer_id, status | ✅ All present | ✅ |

**sale_status constraint**: `CHECK ((sale_status = ANY (ARRAY['available', 'sold', 'reserved', 'returned', 'inspection'])))`

---

### Step B: RPC Created ✅

**Function**: `public.complete_pos_piece_return_atomic(p_payload jsonb)`

**Features**:
- ✅ SECURITY DEFINER
- ✅ Idempotency via `client_request_id` check
- ✅ Atomic transaction (all-or-nothing)
- ✅ Creates return header + items
- ✅ Updates jewelry_items status
- ✅ Creates item_movements
- ✅ Handles customer_credits (store_credit)
- ✅ Creates journal entry with lines
- ✅ Optional invoice creation (`create_invoice: true`)

---

### Step C: Grants Hardening ✅

**Executed**:
```sql
REVOKE ALL ON FUNCTION public.complete_pos_piece_return_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_pos_piece_return_atomic(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_pos_piece_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pos_piece_return_atomic(jsonb) TO service_role;
```

**Also secured existing RPCs**:
- `complete_pos_return_atomic` — anon revoked ✅
- `complete_pos_sales_return_atomic` — anon revoked ✅

---

### Step D: Gate Queries — Evidence ✅

#### G1: Function exists + SECURITY DEFINER
```
proname                          | prosecdef
---------------------------------|----------
complete_pos_piece_return_atomic | true
```
✅ PASS

#### G2: Privileges on new RPC
```
role          | can_execute
--------------|------------
anon          | false
authenticated | true
service_role  | true
```
✅ PASS

#### G3: Idempotency index exists
```
indexname                           | indexdef
------------------------------------|--------------------------------------------------
idx_returns_client_request_id_unique| CREATE UNIQUE INDEX ... WHERE (client_request_id IS NOT NULL)
```
✅ PASS

#### G4: Existing RPC secured
```
role          | can_execute
--------------|------------
anon          | false
authenticated | true
```
✅ PASS — `complete_pos_return_atomic` now blocks anon

---

### Deliverables

| Artifact | Path | Status |
|----------|------|--------|
| Migration SQL | `docs/sales/migration_artifacts/20260124_s_clean_1_pos_piece_return_atomic.sql` | ✅ |
| Evidence Pack | `docs/sales/S-Clean_sales_hardening_gate.md` | ✅ |

---

### Next Steps (NO UI CHANGES IN THIS TASK)

1. **S-Clean-2**: Migrate `CustomersPage.tsx` to use `complete_pos_piece_return_atomic` RPC
2. **S-Clean-3**: Migrate `pos-return-workflow.ts` to use RPC instead of direct writes
3. **S-Clean-4**: RLS hardening for `jewelry_items` and `item_movements`
