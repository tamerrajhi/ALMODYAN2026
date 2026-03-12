# 📋 مخطط النظام الشامل — الإصدار الثاني (V2 Blueprint)

**التاريخ:** 2026-01-28  
**الغرض:** وثيقة مرجعية لبناء نظام ERP متكامل للمجوهرات يتفادى مشاكل V1

---

## 🎯 الجزء الأول: نظرة عامة على النظام

### 1.1 ماهية النظام
نظام ERP متكامل لإدارة محلات المجوهرات يشمل:
- **نقاط البيع (POS)**: بيع القطع الفريدة + المرتجعات
- **المشتريات**: فواتير شراء عامة + استيراد قطع فريدة
- **المخزون**: تتبع القطع الفريدة (jewelry_items) + المنتجات العامة (products)
- **المحاسبة**: قيود يومية متوازنة + دليل حسابات
- **الخزائن**: النقدية + الذهب
- **الموارد البشرية**: الموظفين والرواتب
- **التقارير**: تقارير مالية ومخزنية

### 1.2 الفروع والمستخدمين
- نظام متعدد الفروع (Multi-Branch)
- صلاحيات مبنية على الأدوار (RBAC)
- كل مستخدم مرتبط بفرع أو أكثر

### 1.3 العملات والضرائب
- العملة الأساسية: ريال سعودي (SAR)
- ضريبة القيمة المضافة: 15%
- تخزين نسبة الضريبة كـ percentage (15) وليس fraction (0.15)

---

## 🏗️ الجزء الثاني: البنية المعمارية

### 2.1 المبادئ الأساسية (Core Principles)

```
┌─────────────────────────────────────────────────────────────┐
│                    GOLDEN RULES                              │
├─────────────────────────────────────────────────────────────┤
│ 1. RPC-Only Model: لا direct writes من UI للجداول المالية   │
│ 2. Idempotency: كل عملية لها client_request_id فريد        │
│ 3. Atomic Transactions: الكل أو لا شيء                      │
│ 4. Balanced JEs: Dr = Cr دائماً                             │
│ 5. Posted Lock: منع التعديل بعد الترحيل                     │
│ 6. Audit Trail: تسجيل كل التغييرات                          │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 طبقات النظام (System Layers)

```
┌─────────────────────────────────────────────────────────────┐
│                         UI Layer                             │
│  React + TypeScript + TailwindCSS + shadcn/ui               │
├─────────────────────────────────────────────────────────────┤
│                      Domain Layer                            │
│  DTOs + Commands + Validators + Mappers + Policies          │
├─────────────────────────────────────────────────────────────┤
│                     Service Layer                            │
│  Read Services + Write Services (RPC Calls Only)            │
├─────────────────────────────────────────────────────────────┤
│                    Database Layer                            │
│  Supabase: Tables + RLS + Triggers + Functions              │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 نمط الـ Atomic RPC

```sql
-- كل RPC يتبع هذا النمط:
CREATE OR REPLACE FUNCTION complete_xxx_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id text;
  v_result jsonb;
BEGIN
  -- 1. Idempotency Gate
  v_request_id := p_payload->>'client_request_id';
  PERFORM begin_workflow_request(v_request_id::uuid, 'workflow_type');
  
  -- 2. Validations
  IF some_condition THEN
    PERFORM fail_workflow_request(v_request_id::uuid, 'ERROR_CODE', 'message');
    RETURN jsonb_build_object('success', false, 'error', 'ERROR_CODE');
  END IF;
  
  -- 3. Lock rows (FOR UPDATE NOWAIT)
  
  -- 4. Business Logic
  
  -- 5. Create Journal Entry (balanced)
  
  -- 6. Update Inventory
  
  -- 7. Success
  PERFORM succeed_workflow_request(v_request_id::uuid, entity_id, result);
  
  RETURN jsonb_build_object('success', true, 'data', v_result);
  
EXCEPTION WHEN OTHERS THEN
  PERFORM fail_workflow_request(v_request_id::uuid, 'UNEXPECTED', SQLERRM);
  RAISE;
END;
$$;
```

---

## 📊 الجزء الثالث: نموذج البيانات (Data Model)

### 3.1 الجداول الأساسية

#### A. جداول الأطراف (Parties)
```sql
-- العملاء
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  vat_number TEXT,
  account_id UUID REFERENCES chart_of_accounts(id), -- حساب العميل في دليل الحسابات
  total_purchases NUMERIC(18,2) DEFAULT 0,
  loyalty_points INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- الموردين
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_code TEXT NOT NULL UNIQUE,
  supplier_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  vat_number TEXT,
  account_id UUID REFERENCES chart_of_accounts(id), -- حساب المورد
  current_balance NUMERIC(18,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### B. جداول المخزون (Inventory)
```sql
-- القطع الفريدة (للمجوهرات)
CREATE TABLE jewelry_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code TEXT NOT NULL UNIQUE,
  description TEXT,
  category_id UUID REFERENCES categories(id),
  
  -- المواصفات
  gold_color TEXT, -- أصفر، أبيض، وردي
  karat INTEGER CHECK (karat IN (18, 21, 22, 24)),
  weight_grams NUMERIC(10,4) NOT NULL,
  
  -- التكلفة والسعر
  cost NUMERIC(18,2) NOT NULL,
  selling_price NUMERIC(18,2),
  
  -- الموقع والحالة
  branch_id UUID REFERENCES branches(id),
  sale_status TEXT NOT NULL DEFAULT 'available' 
    CHECK (sale_status IN ('available', 'sold', 'reserved', 'returned', 'inspection')),
  is_available_for_sale BOOLEAN DEFAULT true,
  
  -- روابط البيع
  sale_id UUID REFERENCES sales(id),
  sold_at TIMESTAMPTZ,
  
  -- التتبع
  batch_id UUID REFERENCES batches(id),
  supplier_id UUID REFERENCES suppliers(id),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- المنتجات العامة (غير فريدة)
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  description TEXT,
  category_id UUID REFERENCES categories(id),
  unit_id UUID REFERENCES units(id),
  
  -- الحسابات
  inventory_account_id UUID REFERENCES chart_of_accounts(id),
  revenue_account_id UUID REFERENCES chart_of_accounts(id),
  cogs_account_id UUID REFERENCES chart_of_accounts(id),
  
  -- الأسعار
  default_cost NUMERIC(18,2),
  default_price NUMERIC(18,2),
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- أرصدة المنتجات (per branch)
CREATE TABLE product_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  average_cost NUMERIC(18,4),
  last_movement_at TIMESTAMPTZ,
  UNIQUE(product_id, branch_id)
);
```

#### C. جداول المستندات (Documents)

```sql
-- ========================================
-- نمط موحد للمستندات (Unified Document Pattern)
-- ========================================

-- الفواتير (مبيعات + مشتريات)
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- النوع
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('purchase', 'sales')),
  purchase_type TEXT CHECK (purchase_type IN ('general', 'import')), -- للمشتريات فقط
  
  -- الأطراف
  supplier_id UUID REFERENCES suppliers(id),
  customer_id UUID REFERENCES customers(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  
  -- المبالغ
  subtotal NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  
  -- المرتجعات والمدفوعات
  total_returned_amount NUMERIC(18,2) DEFAULT 0,
  paid_amount NUMERIC(18,2) DEFAULT 0,
  remaining_amount NUMERIC(18,2) GENERATED ALWAYS AS 
    (total_amount - COALESCE(total_returned_amount, 0) - COALESCE(paid_amount, 0)) STORED,
  
  -- الحالة
  status TEXT NOT NULL DEFAULT 'draft' 
    CHECK (status IN ('draft', 'pending', 'confirmed', 'posted', 'partial', 'paid', 'voided', 'cancelled')),
  
  -- الربط المحاسبي
  journal_entry_id UUID REFERENCES journal_entries(id),
  
  -- الإلغاء
  voided_at TIMESTAMPTZ,
  voided_by UUID,
  void_reason TEXT,
  
  -- التدقيق
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Constraints
  CONSTRAINT valid_party CHECK (
    (invoice_type = 'purchase' AND supplier_id IS NOT NULL) OR
    (invoice_type = 'sales' AND customer_id IS NOT NULL)
  )
);

-- سطور فواتير المشتريات (منتجات عامة)
CREATE TABLE purchase_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  
  -- المنتج
  product_id UUID REFERENCES products(id),
  product_code TEXT,
  description TEXT NOT NULL,
  
  -- الكميات
  quantity NUMERIC(18,4) NOT NULL,
  returned_qty NUMERIC(18,4) DEFAULT 0,
  
  -- الأسعار
  unit_price NUMERIC(18,4) NOT NULL,
  discount_amount NUMERIC(18,2) DEFAULT 0,
  subtotal NUMERIC(18,2) NOT NULL,
  tax_rate NUMERIC(5,2) DEFAULT 15, -- نسبة مئوية
  tax_amount NUMERIC(18,2) DEFAULT 0,
  total_amount NUMERIC(18,2) NOT NULL,
  
  -- نوع السطر
  item_type TEXT DEFAULT 'product' CHECK (item_type IN ('product', 'cost', 'service')),
  gl_account_id UUID REFERENCES chart_of_accounts(id),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(invoice_id, line_number)
);

-- القطع المستوردة (فواتير استيراد)
CREATE TABLE purchase_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  jewelry_item_id UUID NOT NULL REFERENCES jewelry_items(id),
  return_cost NUMERIC(18,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### D. جداول المرتجعات

```sql
-- مرتجعات المشتريات (General Track)
CREATE TABLE purchase_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number TEXT NOT NULL UNIQUE,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- الربط بالفاتورة الأصلية
  purchase_invoice_id UUID NOT NULL REFERENCES invoices(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  
  -- النوع
  purchase_type TEXT NOT NULL CHECK (purchase_type IN ('general', 'import')),
  
  -- المبالغ
  subtotal NUMERIC(18,2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  
  -- الحالة
  status TEXT NOT NULL DEFAULT 'draft' 
    CHECK (status IN ('draft', 'confirmed', 'posted', 'voided', 'cancelled')),
  
  -- المحاسبة
  journal_entry_id UUID REFERENCES journal_entries(id),
  
  -- الإلغاء
  voided_at TIMESTAMPTZ,
  voided_by UUID,
  void_reason TEXT,
  
  -- التدقيق
  reason TEXT,
  notes TEXT,
  processed_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- سطور مرتجعات المشتريات
CREATE TABLE purchase_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  invoice_line_id UUID NOT NULL REFERENCES purchase_invoice_lines(id),
  
  -- المنتج (denormalized for performance)
  item_id UUID REFERENCES products(id),
  description TEXT,
  
  -- الكميات
  quantity NUMERIC(18,4) NOT NULL,
  unit_cost NUMERIC(18,4) NOT NULL,
  
  -- الضريبة
  vat_rate NUMERIC(5,2) DEFAULT 15,
  vat_amount NUMERIC(18,2) DEFAULT 0,
  
  -- الإجمالي
  total_amount NUMERIC(18,2) NOT NULL,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- مرتجعات المبيعات
CREATE TABLE returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number TEXT NOT NULL UNIQUE,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- الربط
  sale_id UUID REFERENCES sales(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  
  -- المبالغ
  total_amount NUMERIC(18,2) NOT NULL,
  
  -- الحالة
  status TEXT NOT NULL DEFAULT 'completed',
  post_return_status TEXT CHECK (post_return_status IN ('available', 'inspection')),
  
  -- المحاسبة
  journal_entry_id UUID REFERENCES journal_entries(id),
  
  -- التدقيق
  reason TEXT,
  processed_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- قطع مرتجعات المبيعات
CREATE TABLE return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  jewelry_item_id UUID NOT NULL REFERENCES jewelry_items(id),
  return_price NUMERIC(18,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### E. جداول المحاسبة

```sql
-- دليل الحسابات
CREATE TABLE chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code TEXT NOT NULL UNIQUE,
  account_name TEXT NOT NULL,
  account_name_en TEXT,
  account_type TEXT NOT NULL CHECK (account_type IN (
    'asset', 'liability', 'equity', 'revenue', 'expense'
  )),
  parent_id UUID REFERENCES chart_of_accounts(id),
  current_balance NUMERIC(18,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false, -- حسابات النظام لا تحذف
  created_at TIMESTAMPTZ DEFAULT now()
);

-- القيود اليومية
CREATE TABLE journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number TEXT NOT NULL UNIQUE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- الوصف
  description TEXT,
  
  -- المرجع
  reference_type TEXT, -- 'purchase', 'sale', 'payment', 'receipt', etc.
  reference_id UUID,
  
  -- الفرع
  branch_id UUID REFERENCES branches(id),
  
  -- الحالة
  is_posted BOOLEAN DEFAULT true, -- القيود تُرحّل مباشرة
  is_reversed BOOLEAN DEFAULT false,
  reversed_by_entry_id UUID REFERENCES journal_entries(id),
  
  -- التدقيق
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- سطور القيود
CREATE TABLE journal_entry_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  
  account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
  description TEXT,
  
  debit_amount NUMERIC(18,2) DEFAULT 0,
  credit_amount NUMERIC(18,2) DEFAULT 0,
  
  -- مركز التكلفة (اختياري)
  cost_center_id UUID REFERENCES cost_centers(id),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(journal_entry_id, line_number),
  CHECK (
    (debit_amount > 0 AND credit_amount = 0) OR
    (credit_amount > 0 AND debit_amount = 0) OR
    (debit_amount = 0 AND credit_amount = 0)
  )
);

-- Trigger للتأكد من توازن القيد
CREATE OR REPLACE FUNCTION check_journal_balance()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT ABS(SUM(debit_amount) - SUM(credit_amount)) > 0.01
    FROM journal_entry_lines
    WHERE journal_entry_id = COALESCE(NEW.journal_entry_id, OLD.journal_entry_id)
  ) THEN
    RAISE EXCEPTION 'UNBALANCED_JE: Journal entry is not balanced';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

#### F. جداول المدفوعات

```sql
-- المدفوعات
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number TEXT NOT NULL UNIQUE,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- النوع
  payment_type TEXT NOT NULL CHECK (payment_type IN ('supplier', 'customer', 'expense')),
  
  -- الأطراف
  supplier_id UUID REFERENCES suppliers(id),
  customer_id UUID REFERENCES customers(id),
  
  -- المبلغ
  amount NUMERIC(18,2) NOT NULL,
  payment_method TEXT DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank', 'card', 'check')),
  
  -- المحاسبة
  journal_entry_id UUID REFERENCES journal_entries(id),
  
  -- الفرع
  branch_id UUID NOT NULL REFERENCES branches(id),
  
  -- الحالة
  status TEXT DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'voided')),
  
  -- الإلغاء
  voided_at TIMESTAMPTZ,
  voided_by UUID,
  void_reason TEXT,
  
  -- التدقيق
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- توزيع المدفوعات على الفواتير
CREATE TABLE payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  amount NUMERIC(18,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(payment_id, invoice_id)
);

-- Trigger لتحديث الفاتورة بعد التوزيع
CREATE OR REPLACE FUNCTION update_invoice_paid_amount()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE invoices
  SET paid_amount = (
    SELECT COALESCE(SUM(amount), 0)
    FROM payment_allocations
    WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)
  )
  WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

#### G. جداول حركة المخزون

```sql
-- حركات القطع الفريدة
CREATE TABLE item_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES jewelry_items(id),
  
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'purchase', 'purchase_return', 'sale', 'sale_return', 
    'transfer_in', 'transfer_out', 'adjustment', 'void_reversal'
  )),
  
  -- المرجع
  reference_type TEXT,
  reference_id UUID,
  purchase_return_id UUID REFERENCES purchase_returns(id),
  sale_id UUID REFERENCES sales(id),
  return_id UUID REFERENCES returns(id),
  transfer_id UUID REFERENCES transfers(id),
  
  -- الفروع
  from_branch_id UUID REFERENCES branches(id),
  to_branch_id UUID REFERENCES branches(id),
  
  -- القيمة
  cost NUMERIC(18,2),
  
  -- التدقيق
  performed_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- حركات المنتجات العامة
CREATE TABLE raw_material_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'purchase_invoice', 'purchase_return', 'sale', 'sale_return',
    'transfer_in', 'transfer_out', 'adjustment', 'void_reversal'
  )),
  
  -- المرجع
  reference_type TEXT,
  reference_id UUID,
  invoice_id UUID REFERENCES invoices(id),
  return_id UUID REFERENCES purchase_returns(id),
  
  -- الفرع والكمية
  branch_id UUID NOT NULL REFERENCES branches(id),
  quantity NUMERIC(18,4) NOT NULL, -- موجب للدخول، سالب للخروج
  unit_cost NUMERIC(18,4),
  
  -- التدقيق
  performed_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### H. جداول الدعم

```sql
-- الفروع
CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_code TEXT NOT NULL UNIQUE,
  branch_name TEXT NOT NULL,
  branch_type TEXT DEFAULT 'retail',
  address TEXT,
  phone TEXT,
  manager_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ربط المستخدمين بالفروع
CREATE TABLE user_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  branch_id UUID NOT NULL REFERENCES branches(id),
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, branch_id)
);

-- أدوار المستخدمين
CREATE TYPE app_role AS ENUM ('admin', 'manager', 'accountant', 'cashier', 'viewer');

CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, role)
);

-- إعدادات الحسابات حسب الفرع
CREATE TABLE branch_accounting_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id), -- NULL = global default
  config_key TEXT NOT NULL, -- 'inventory', 'vat_input', 'vat_output', 'ap_supplier', 'ar_customer'
  account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(branch_id, config_key)
);

-- سجل طلبات العمليات (Idempotency)
CREATE TABLE workflow_requests (
  client_request_id UUID PRIMARY KEY,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' 
    CHECK (status IN ('in_progress', 'succeeded', 'failed', 'conflict')),
  
  payload_hash TEXT, -- MD5 of payload for conflict detection
  request_payload JSONB,
  result_payload JSONB,
  
  error_code TEXT,
  error_message TEXT,
  
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- سجل التدقيق
CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  entity_number TEXT,
  action TEXT NOT NULL,
  
  actor_id UUID,
  branch_id UUID,
  
  payload JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 الـ Triggers الأساسية

```sql
-- ========================================
-- 1. Posted Lock Trigger
-- ========================================
CREATE OR REPLACE FUNCTION guard_posted_document()
RETURNS TRIGGER AS $$
BEGIN
  -- السماح بتغيير status إلى voided
  IF NEW.status = 'voided' AND OLD.status = 'posted' THEN
    RETURN NEW;
  END IF;
  
  -- منع تغيير الحقول المالية بعد الترحيل
  IF OLD.status = 'posted' THEN
    IF NEW.total_amount != OLD.total_amount OR
       NEW.tax_amount != OLD.tax_amount OR
       NEW.subtotal != OLD.subtotal THEN
      RAISE EXCEPTION 'POSTED_LOCKED: Cannot modify financial fields after posting';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_posted_invoice
BEFORE UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION guard_posted_document();

-- ========================================
-- 2. Sync Returned Qty Trigger
-- ========================================
CREATE OR REPLACE FUNCTION sync_returned_qty()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE purchase_invoice_lines pil
  SET returned_qty = (
    SELECT COALESCE(SUM(prl.quantity), 0)
    FROM purchase_return_lines prl
    JOIN purchase_returns pr ON pr.id = prl.return_id
    WHERE prl.invoice_line_id = pil.id
      AND pr.status NOT IN ('voided', 'cancelled')
  )
  WHERE id = COALESCE(NEW.invoice_line_id, OLD.invoice_line_id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 3. Auto-generate Numbers
-- ========================================
CREATE OR REPLACE FUNCTION generate_document_number(
  p_prefix TEXT,
  p_sequence_name TEXT
)
RETURNS TEXT AS $$
DECLARE
  v_number INTEGER;
BEGIN
  -- Get next value from sequence
  EXECUTE format('SELECT nextval(%L)', p_sequence_name) INTO v_number;
  
  RETURN p_prefix || '-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || 
         lpad(v_number::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Sequences
CREATE SEQUENCE IF NOT EXISTS purchase_invoice_seq;
CREATE SEQUENCE IF NOT EXISTS sales_invoice_seq;
CREATE SEQUENCE IF NOT EXISTS purchase_return_seq;
CREATE SEQUENCE IF NOT EXISTS sales_return_seq;
CREATE SEQUENCE IF NOT EXISTS journal_entry_seq;
CREATE SEQUENCE IF NOT EXISTS payment_seq;
```

---

## 🖥️ الجزء الرابع: الشاشات (Screens Specifications)

### 4.1 موديول نقاط البيع (POS Module)

#### شاشة POS الرئيسية
```yaml
Screen: POSPage
Route: /pos
Purpose: بيع القطع الفريدة للعملاء

Components:
  - BranchSelector: اختيار الفرع
  - SellerSelector: اختيار البائع (إجباري)
  - CustomerSearch: البحث عن العميل (اختياري لـ Cash/Card)
  - ItemScanner: مسح الباركود أو البحث
  - CartPanel: سلة المشتريات
  - PaymentPanel: طرق الدفع (Cash/Card/Credit/Split)
  - DiscountPanel: الخصومات

Business Rules:
  - العميل إجباري فقط لـ Credit payment
  - البائع إجباري دائماً (Admin fallback if no sellers)
  - القطع المتاحة فقط (sale_status = 'available')
  - لا يمكن إضافة نفس القطعة مرتين

Atomic RPC: complete_pos_sale_atomic
  Input:
    - client_request_id: UUID
    - branch_id: UUID
    - seller_id: UUID
    - customer_id: UUID | null
    - payment_method: 'cash' | 'card' | 'credit' | 'split'
    - items: [{jewelry_item_id, sale_price}]
    - discount: {type, value}
    - split_details: {cash, card, credit} | null
  
  Process:
    1. Validate branch access
    2. Lock jewelry_items (FOR UPDATE)
    3. Verify all items available
    4. Create sale record
    5. Create sale_items
    6. Update jewelry_items (sale_status='sold', sale_id, sold_at)
    7. Create item_movements
    8. Resolve GL accounts (branch_pos_account_mappings)
    9. Create balanced JE:
       Dr: Cash/Bank/AR (based on payment)
       Dr: COGS
       Cr: Sales Revenue
       Cr: VAT Payable
       Cr: Inventory
    10. Link sale.journal_entry_id
    11. Update customer totals if applicable
  
  Output:
    - sale_id
    - sale_number
    - journal_entry_id
    - receipt_url

UI State Machine:
  idle → scanning → reviewing → payment → processing → success/error
```

#### شاشة مرتجعات POS
```yaml
Screen: POSReturnPage
Route: /pos/return

Purpose: إرجاع قطع مباعة من العميل

Components:
  - SaleSearch: البحث بالباركود أو رقم الفاتورة
  - SoldItemsList: عرض القطع المباعة
  - ReturnReasonInput: سبب الإرجاع
  - PostReturnStatusSelect: حالة القطعة بعد الإرجاع (متاح/فحص)

Business Rules:
  - يمكن إرجاع قطع sold فقط
  - اختيار حالة ما بعد الإرجاع إجباري
  - الإرجاع ينشئ رصيد للعميل (customer_credits)

Atomic RPC: complete_pos_piece_return_atomic
  Process:
    1. Validate item is sold
    2. Create return header
    3. Create return_items
    4. Update jewelry_item (sale_status='available'|'inspection', sale_id=null)
    5. Create item_movement (sale_return)
    6. Create reversal JE:
       Dr: Sales Returns (Revenue contra)
       Dr: Inventory
       Cr: Cash/AR
       Cr: COGS (reversal)
    7. Create customer_credit if applicable
    8. Link return.journal_entry_id
```

### 4.2 موديول المبيعات (Sales Module)

#### قائمة فواتير المبيعات
```yaml
Screen: SalesInvoicesPage
Route: /sales/invoices

Purpose: عرض وإدارة فواتير المبيعات

Features:
  - DataTable with filters (date, status, customer, branch)
  - Search by invoice number
  - Status badges (draft, posted, paid, voided)
  - Quick actions (view, void)
  - Export to Excel/PDF
```

#### إنشاء فاتورة مبيعات
```yaml
Screen: CreateSalesInvoicePage
Route: /sales/invoices/new

Purpose: إنشاء فاتورة مبيعات جديدة (ERP mode)

Components:
  - CustomerSelect
  - BranchSelect
  - DatePicker
  - JewelryItemScanner
  - LineItemsTable
  - TotalsPanel
  - NotesInput

Atomic RPC: complete_sales_invoice_atomic
  Similar to POS but for B2B/Credit sales
```

#### عرض فاتورة المبيعات
```yaml
Screen: SalesInvoiceViewPage
Route: /sales/invoices/:id/view

Purpose: عرض تفاصيل الفاتورة

Sections:
  - HeaderInfo (number, date, customer, status)
  - ItemsTable (with images)
  - TotalsBreakdown
  - PaymentHistory
  - LinkedDocuments (returns, receipts)
  - JournalEntryPreview
  - ActionButtons (void, print, email)

Void Flow:
  - Show void reason dialog
  - Call void_sales_invoice_atomic
  - Creates reversal JE
  - Updates inventory (restore items)
```

### 4.3 موديول المشتريات (Purchases Module)

#### قائمة فواتير المشتريات
```yaml
Screen: PurchaseInvoicesPage
Route: /purchasing/invoices

Purpose: عرض وإدارة فواتير المشتريات

Filters:
  - purchase_type: 'general' | 'import'
  - status
  - date range
  - supplier
  - branch

Actions:
  - New General Invoice
  - New Import Invoice
  - View/Edit
  - Create Return
```

#### إنشاء فاتورة مشتريات عامة
```yaml
Screen: PurchaseInvoiceFormPage
Route: /purchasing/invoices/new?type=general

Purpose: إنشاء فاتورة شراء منتجات/خدمات

Components:
  - SupplierSelect
  - BranchSelect
  - InvoiceDatePicker
  - LineItemsEditor:
    - ProductSelect | ManualEntry
    - Quantity
    - UnitPrice
    - TaxRate (default 15%)
    - GLAccountSelect
  - TotalsPanel
  - NotesInput

Atomic RPC: purchase_invoice_create_atomic
  Input:
    - client_request_id
    - invoice_date
    - supplier_id
    - branch_id
    - purchase_type: 'general'
    - lines: [{product_id, description, quantity, unit_price, tax_rate, gl_account_id}]
    - notes
  
  Process:
    1. Generate invoice_number
    2. Create invoice header
    3. Create purchase_invoice_lines
    4. Update product_inventory (increase)
    5. Create raw_material_movements
    6. Resolve GL accounts:
       - Inventory: from product or branch_accounting_config
       - VAT Input: config key 'vat_input'
       - AP Supplier: supplier.account_id or config 'ap_supplier'
    7. Create balanced JE:
       Dr: Inventory
       Dr: VAT Input
       Cr: Accounts Payable (Supplier)
    8. Link invoice.journal_entry_id

Validations:
  - tax_rate must be >= 0 and <= 100 (percentage)
  - quantity > 0
  - unit_price >= 0
  - At least one line required
```

#### إنشاء فاتورة استيراد
```yaml
Screen: PurchaseInvoiceFormPage
Route: /purchasing/invoices/new?type=import

Purpose: إنشاء فاتورة استيراد قطع مجوهرات

Special Features:
  - Linked to Batch
  - Creates jewelry_items
  - Item-level tracking

Components:
  - BatchSelect | CreateNewBatch
  - SupplierSelect
  - JewelryItemsEditor:
    - ItemCode (auto or manual)
    - Description
    - Category
    - Karat
    - Weight
    - Cost
    - SellingPrice
  - ImportCostsSection (shipping, customs, etc.)
```

#### مركز المرتجعات (Returns Hub)
```yaml
Screen: ReturnsHubPage
Route: /purchasing/returns-hub

Purpose: إدارة جميع مرتجعات المشتريات

Views:
  - Unified list from v_returns_hub view
  - Tabs: All | General | Import
  - Status badges
  - Integrity indicators (drift detection)

Actions:
  - View Details
  - Void Return
  - Print
```

#### تفاصيل مرتجع عام
```yaml
Screen: ReturnsHubDetailsPage
Route: /purchasing/returns-hub/general/:id

Purpose: عرض تفاصيل مرتجع مشتريات عام

Sections:
  - HeaderInfo (return number, date, linked invoice, supplier)
  - LinesTable (products, quantities, costs)
  - TotalsBreakdown
  - IntegrityPanel (movement count, balance check)
  - JournalEntryPreview
  - ActionButtons (void, print)
```

#### إنشاء مرتجع عام
```yaml
Screen: PurchaseReturnGeneralPage
Route: /purchasing/returns/new?type=general&invoiceId=xxx

Purpose: إنشاء مرتجع مشتريات عام

Flow:
  1. Load invoice and lines
  2. Show available quantities (quantity - returned_qty)
  3. User selects items and return quantities
  4. Validates: return_qty <= available_qty
  5. Preview totals
  6. Submit

Atomic RPC: complete_purchase_return_general_atomic
  Input:
    - client_request_id
    - invoice_id
    - return_date
    - reason
    - lines: [{invoice_line_id, quantity, unit_cost, vat_rate}]
  
  Process:
    1. Validate invoice exists and is purchase type
    2. Validate quantities (no over-return)
    3. Lock invoice lines (FOR UPDATE)
    4. Create purchase_returns header
    5. Create purchase_return_lines
    6. Update purchase_invoice_lines.returned_qty (via trigger)
    7. Update product_inventory (decrease)
    8. Create raw_material_movements (purchase_return)
    9. Resolve GL accounts
    10. Create balanced JE:
        Dr: Accounts Payable (Supplier)
        Cr: Inventory
        Cr: VAT Input
    11. Link return.journal_entry_id
    12. Update invoice.total_returned_amount (via trigger)

Validations:
  - return_qty <= (quantity - returned_qty) per line
  - Invoice not voided
  - Posted returns cannot be modified
```

#### إنشاء مرتجع قطع فريدة
```yaml
Screen: PurchaseReturnUniquePage
Route: /purchasing/returns/new?type=unique&invoiceId=xxx

Purpose: إرجاع قطع مجوهرات للمورد

Components:
  - InvoiceInfo (readonly)
  - JewelryItemsSelector (from batch/invoice)
  - ReasonInput

Atomic RPC: complete_purchase_return_unique_items_atomic
  Process:
    1. Validate items belong to invoice/batch
    2. Validate items are available
    3. Create purchase_returns header
    4. Create purchase_return_items (jewelry linking)
    5. Update jewelry_items (branch_id=null, sale_status='returned')
    6. Create item_movements (purchase_return)
    7. Create balanced JE
    8. Link return.journal_entry_id
```

### 4.4 موديول المدفوعات (Payments Module)

#### سندات صرف الموردين
```yaml
Screen: PaymentVouchersPage
Route: /purchasing/payment-vouchers

Purpose: إنشاء وإدارة سندات صرف للموردين

Features:
  - List with filters
  - Create new payment
  - Allocate to invoices
  - Void payment

Create Flow:
  1. Select supplier
  2. Enter amount
  3. Select payment method (cash/bank/check)
  4. Allocate to invoices (required by default)
  5. Submit

Atomic RPC: payment_voucher_atomic
  Input:
    - client_request_id
    - supplier_id
    - amount
    - payment_method
    - payment_date
    - allocations: [{invoice_id, amount}]
    - notes
  
  Process:
    1. Validate supplier exists
    2. Validate allocations sum <= amount
    3. Create payment record
    4. Create payment_allocations
    5. Update invoice.paid_amount (via trigger)
    6. Create balanced JE:
       Dr: Accounts Payable
       Cr: Cash/Bank
    7. Link payment.journal_entry_id

Hard Block (SET-HB):
  - By default, unallocated payments are blocked
  - Override requires admin permission
```

#### سندات قبض العملاء
```yaml
Screen: CustomerReceiptsPage
Route: /sales/customer-receipts

Purpose: تسجيل المقبوضات من العملاء

Similar to PaymentVouchersPage but:
  - Party: Customer instead of Supplier
  - JE: Dr Cash/Bank, Cr Accounts Receivable

Atomic RPC: create_customer_receipt_atomic
```

### 4.5 موديول المحاسبة (Accounting Module)

#### دفتر اليومية
```yaml
Screen: JournalEntriesPage
Route: /accounting/journal-entries

Purpose: عرض جميع القيود اليومية

Features:
  - List with search and filters
  - Drill-down to source document
  - Balance verification
  - Manual entry (admin only)

Columns:
  - Entry Number
  - Date
  - Description
  - Reference
  - Total Debit
  - Total Credit
  - Status (posted/reversed)
```

#### دليل الحسابات
```yaml
Screen: ChartOfAccountsPage
Route: /accounting/chart-of-accounts

Purpose: إدارة شجرة الحسابات

Features:
  - Tree view with expandable nodes
  - Account types color coded
  - Balance display
  - Create/Edit (non-system accounts)
  - Disable/Enable
```

#### تقرير ميزان المراجعة
```yaml
Screen: TrialBalancePage
Route: /accounting/trial-balance

Purpose: عرض ميزان المراجعة

Features:
  - Date range filter
  - Branch filter
  - Debit/Credit totals
  - Drill-down to account transactions
  - Export to Excel
```

### 4.6 موديول المخزون (Inventory Module)

#### قائمة القطع
```yaml
Screen: JewelryItemsPage
Route: /inventory/jewelry-items

Purpose: عرض وإدارة القطع الفريدة

Filters:
  - Branch
  - Category
  - Status (available, sold, returned, inspection)
  - Karat
  - Price range

Actions:
  - View details
  - Transfer between branches
  - Adjust status (admin)
  - Print barcode
```

#### التحويلات
```yaml
Screen: TransfersPage
Route: /inventory/transfers

Purpose: تحويل القطع بين الفروع

Create Flow:
  1. Select source branch
  2. Select destination branch
  3. Scan/Select items
  4. Submit

Atomic RPC: create_transfer_atomic
  Process:
    1. Validate items in source branch
    2. Create transfer header
    3. Create transfer_items
    4. Update jewelry_items.branch_id
    5. Create item_movements (transfer_out + transfer_in)
    6. Create balanced JE if inter-company
```

---

## 🔒 الجزء الخامس: الأمان والصلاحيات

### 5.1 Row Level Security (RLS)

```sql
-- ========================================
-- نمط RLS الموحد
-- ========================================

-- 1. Function للتحقق من الدور
CREATE OR REPLACE FUNCTION has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 2. Function للتحقق من الفرع
CREATE OR REPLACE FUNCTION has_branch_access(_user_id UUID, _branch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_branches
    WHERE user_id = _user_id AND branch_id = _branch_id
  )
  OR has_role(_user_id, 'admin')
$$;

-- 3. تطبيق RLS على الجداول
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- SELECT: branch-scoped
CREATE POLICY invoices_select ON invoices
FOR SELECT TO authenticated
USING (has_branch_access(auth.uid(), branch_id));

-- INSERT: branch-scoped with check
CREATE POLICY invoices_insert ON invoices
FOR INSERT TO authenticated
WITH CHECK (has_branch_access(auth.uid(), branch_id));

-- UPDATE: branch-scoped with check (prevents escalation)
CREATE POLICY invoices_update ON invoices
FOR UPDATE TO authenticated
USING (has_branch_access(auth.uid(), branch_id))
WITH CHECK (has_branch_access(auth.uid(), branch_id));

-- DELETE: admin only
CREATE POLICY invoices_delete ON invoices
FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'));
```

### 5.2 نمط RLS للجداول التابعة

```sql
-- للجداول المرتبطة بجدول أب (مثل invoice_lines)
-- استخدم EXISTS للتحقق من الوصول للأب

CREATE POLICY invoice_lines_select ON purchase_invoice_lines
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = invoice_id
    AND has_branch_access(auth.uid(), i.branch_id)
  )
);
```

### 5.3 SECURITY DEFINER للـ RPCs

```sql
-- جميع RPCs المالية يجب أن تكون SECURITY DEFINER
-- هذا يسمح لها بتجاوز RLS مع التحقق اليدوي

CREATE OR REPLACE FUNCTION complete_xxx_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER  -- يتجاوز RLS
SET search_path = public
AS $$
BEGIN
  -- التحقق اليدوي من الصلاحيات
  IF NOT has_branch_access(auth.uid(), (p_payload->>'branch_id')::uuid) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: No access to this branch';
  END IF;
  
  -- باقي المنطق...
END;
$$;

-- إلغاء الوصول من anon و public
REVOKE ALL ON FUNCTION complete_xxx_atomic FROM anon, public;
GRANT EXECUTE ON FUNCTION complete_xxx_atomic TO authenticated, service_role;
```

---

## 📐 الجزء السادس: أنماط الكود (Code Patterns)

### 6.1 هيكل Domain Layer

```
src/domain/
├── purchasing/
│   ├── dto/
│   │   ├── invoiceDTO.ts          # Data Transfer Objects
│   │   └── returnDTO.ts
│   ├── commands/
│   │   ├── createInvoiceCommand.ts # Command objects
│   │   └── createReturnCommand.ts
│   ├── validation/
│   │   ├── invoiceValidation.ts   # Zod schemas
│   │   └── returnValidation.ts
│   ├── mappers/
│   │   ├── invoiceMappers.ts      # DB ↔ DTO mapping
│   │   └── returnMappers.ts
│   ├── policy/
│   │   └── invoicePolicy.ts       # Business rules
│   ├── purchasingReadService.ts   # Read operations
│   ├── purchasingWriteService.ts  # RPC calls
│   └── index.ts                   # Public exports
```

### 6.2 نمط الـ DTO

```typescript
// src/domain/purchasing/dto/invoiceDTO.ts

export interface PurchaseInvoiceLineDTO {
  id?: string;
  lineNumber: number;
  productId: string | null;
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;  // percentage (15)
  discountAmount: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  glAccountId: string;
}

export interface PurchaseInvoiceDTO {
  id?: string;
  invoiceNumber?: string;
  invoiceDate: string;
  supplierId: string;
  supplierName?: string;
  branchId: string;
  branchName?: string;
  purchaseType: 'general' | 'import';
  status: 'draft' | 'pending' | 'posted' | 'voided';
  
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  
  lines: PurchaseInvoiceLineDTO[];
  
  journalEntryId?: string;
  notes?: string;
  
  createdAt?: string;
  createdBy?: string;
}
```

### 6.3 نمط الـ Validation

```typescript
// src/domain/purchasing/validation/invoiceValidation.ts
import { z } from 'zod';

export const invoiceLineSchema = z.object({
  productId: z.string().uuid().nullable(),
  productCode: z.string().min(1),
  description: z.string().min(1),
  quantity: z.number().positive('Quantity must be positive'),
  unitPrice: z.number().nonnegative('Price cannot be negative'),
  taxRate: z.number()
    .min(0, 'Tax rate cannot be negative')
    .max(100, 'Tax rate cannot exceed 100%')
    .refine(
      val => val >= 1 || val === 0,
      'Tax rate should be percentage (e.g., 15), not fraction (e.g., 0.15)'
    ),
  glAccountId: z.string().uuid('GL Account is required'),
});

export const createInvoiceSchema = z.object({
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplierId: z.string().uuid(),
  branchId: z.string().uuid(),
  purchaseType: z.enum(['general', 'import']),
  lines: z.array(invoiceLineSchema).min(1, 'At least one line is required'),
  notes: z.string().optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
```

### 6.4 نمط الـ Write Service

```typescript
// src/domain/purchasing/purchasingWriteService.ts
import { supabase } from '@/integrations/supabase/client';
import { CreateInvoiceInput, createInvoiceSchema } from './validation';

export interface CreateInvoiceResult {
  success: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  journalEntryId?: string;
  error?: string;
  errorCode?: string;
}

export async function createPurchaseInvoice(
  input: CreateInvoiceInput,
  clientRequestId: string
): Promise<CreateInvoiceResult> {
  // 1. Validate input
  const validation = createInvoiceSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors[0].message,
      errorCode: 'VALIDATION_ERROR',
    };
  }

  // 2. Guard against fractional tax rates
  const hasFractionalTax = input.lines.some(
    line => line.taxRate > 0 && line.taxRate < 1
  );
  if (hasFractionalTax) {
    return {
      success: false,
      error: 'Tax rate must be percentage (e.g., 15), not fraction',
      errorCode: 'INVALID_TAX_RATE',
    };
  }

  // 3. Call atomic RPC
  const { data, error } = await supabase.rpc('purchase_invoice_create_atomic', {
    p_payload: {
      client_request_id: clientRequestId,
      invoice_date: input.invoiceDate,
      supplier_id: input.supplierId,
      branch_id: input.branchId,
      purchase_type: input.purchaseType,
      lines: input.lines.map((line, idx) => ({
        line_number: idx + 1,
        product_id: line.productId,
        product_code: line.productCode,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        tax_rate: line.taxRate,
        gl_account_id: line.glAccountId,
      })),
      notes: input.notes,
    },
  });

  if (error) {
    // Parse structured error
    const match = error.message.match(/^(\w+):\s*(.+)$/);
    return {
      success: false,
      error: match ? match[2] : error.message,
      errorCode: match ? match[1] : 'RPC_ERROR',
    };
  }

  return {
    success: true,
    invoiceId: data.invoice_id,
    invoiceNumber: data.invoice_number,
    journalEntryId: data.journal_entry_id,
  };
}
```

### 6.5 نمط الـ React Hook

```typescript
// src/hooks/usePurchaseInvoiceCreate.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useCallback } from 'react';
import { createPurchaseInvoice, CreateInvoiceInput } from '@/domain/purchasing';
import { toast } from 'sonner';

export function usePurchaseInvoiceCreate() {
  const queryClient = useQueryClient();
  const clientRequestIdRef = useRef<string | null>(null);

  // Generate fresh ID for each attempt
  const generateRequestId = useCallback(() => {
    clientRequestIdRef.current = crypto.randomUUID();
    return clientRequestIdRef.current;
  }, []);

  // Reset after success
  const resetRequestId = useCallback(() => {
    clientRequestIdRef.current = null;
  }, []);

  const mutation = useMutation({
    mutationFn: async (input: CreateInvoiceInput) => {
      const requestId = clientRequestIdRef.current || generateRequestId();
      return createPurchaseInvoice(input, requestId);
    },
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`تم إنشاء الفاتورة ${result.invoiceNumber}`);
        queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
        resetRequestId();
      } else {
        toast.error(result.error);
      }
    },
    onError: (error) => {
      toast.error('حدث خطأ غير متوقع');
      console.error(error);
    },
  });

  return {
    createInvoice: mutation.mutate,
    isLoading: mutation.isPending,
    generateRequestId,
    resetRequestId,
  };
}
```

### 6.6 نمط الـ UI Component

```typescript
// src/pages/purchasing/PurchaseInvoiceFormPage.tsx
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePurchaseInvoiceCreate } from '@/hooks/usePurchaseInvoiceCreate';
import { CreateInvoiceInput } from '@/domain/purchasing';

export default function PurchaseInvoiceFormPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const purchaseType = searchParams.get('type') as 'general' | 'import' || 'general';
  
  const {
    createInvoice,
    isLoading,
    generateRequestId,
  } = usePurchaseInvoiceCreate();

  const [formData, setFormData] = useState<Partial<CreateInvoiceInput>>({
    purchaseType,
    lines: [],
  });

  // Generate request ID on mount
  useEffect(() => {
    generateRequestId();
  }, [generateRequestId]);

  const handleSubmit = async () => {
    // Validate locally first
    if (!formData.supplierId) {
      toast.error('يجب اختيار المورد');
      return;
    }
    if (!formData.lines?.length) {
      toast.error('يجب إضافة سطر واحد على الأقل');
      return;
    }

    createInvoice(formData as CreateInvoiceInput, {
      onSuccess: (result) => {
        if (result.success) {
          navigate(`/purchasing/invoices/${result.invoiceId}/view`);
        }
      },
    });
  };

  return (
    <div className="container mx-auto p-6">
      {/* Form UI */}
      <Button 
        onClick={handleSubmit} 
        disabled={isLoading}
      >
        {isLoading ? 'جاري الحفظ...' : 'حفظ الفاتورة'}
      </Button>
    </div>
  );
}
```

---

## ⚠️ الجزء السابع: الدروس المستفادة (Lessons Learned)

### 7.1 المشاكل التي واجهناها وحلولها

| المشكلة | السبب | الحل |
|---------|-------|------|
| Direct Writes تسبب orphan records | UI يكتب مباشرة للجداول | RPC-Only Model |
| Duplicate transactions | لا idempotency | client_request_id + workflow_requests |
| Unbalanced JEs | لا validation trigger | check_journal_balance trigger |
| Status drift in jewelry_items | Multiple code paths | Single atomic RPC per operation |
| Tax miscalculations | Fraction vs percentage confusion | Standardize on percentage, guard in service layer |
| Over-return quantities | Missing validation | FOR UPDATE + trigger sync |
| Modified posted documents | No lock | guard_posted_document trigger |
| RLS recursion errors | Query referencing same table | SECURITY DEFINER functions |
| Missing WITH CHECK | Allows branch escalation | Always add WITH CHECK to UPDATE policies |

### 7.2 Anti-Patterns to Avoid

```typescript
// ❌ WRONG: Direct database writes
const { error } = await supabase
  .from('invoices')
  .insert({ ... });

// ✅ CORRECT: Use atomic RPC
const { data, error } = await supabase.rpc('create_invoice_atomic', {
  p_payload: { ... }
});
```

```typescript
// ❌ WRONG: Calculating tax with fraction
const taxAmount = subtotal * 0.15;

// ✅ CORRECT: Tax rate is percentage
const taxRate = 15; // stored as-is
const taxAmount = subtotal * (taxRate / 100);
```

```typescript
// ❌ WRONG: Client-side balance calculation
const remaining = invoice.total - payments.reduce((sum, p) => sum + p.amount, 0);

// ✅ CORRECT: Use computed column from DB
const remaining = invoice.remaining_amount; // GENERATED ALWAYS AS
```

```typescript
// ❌ WRONG: Reusing same request ID
const requestId = useRef(crypto.randomUUID());

// ✅ CORRECT: Fresh ID per attempt
const requestId = crypto.randomUUID(); // inside submit handler
```

### 7.3 Testing Checklist

```markdown
## Before Production:

□ All RPCs have idempotency via workflow_requests
□ All JEs are balanced (trigger verified)
□ Posted lock triggers active on all financial tables
□ RLS policies have WITH CHECK on UPDATE
□ No direct writes in UI for financial tables
□ Tax rates stored as percentage, not fraction
□ Void creates reversal JE, not delete
□ Remaining amounts use computed columns
□ Orphan checks pass (no lines without headers)
□ Quantity guards prevent over-return
□ Branch access enforced in all RPCs
```

---

## 📚 الجزء الثامن: ملحقات

### 8.1 قائمة الـ RPCs الأساسية

| RPC Name | Purpose | Workflow Type |
|----------|---------|---------------|
| complete_pos_sale_atomic | بيع POS | pos_sale |
| complete_pos_piece_return_atomic | مرتجع POS | pos_return |
| complete_sales_invoice_atomic | فاتورة مبيعات ERP | sales_invoice |
| void_sales_invoice_atomic | إلغاء فاتورة مبيعات | sales_invoice_void |
| purchase_invoice_create_atomic | فاتورة مشتريات | purchase_invoice_create |
| purchase_invoice_update_v2_atomic | تعديل فاتورة مشتريات | purchase_invoice_update_v2 |
| complete_purchase_return_general_atomic | مرتجع مشتريات عام | purchase_return_general |
| complete_purchase_return_unique_items_atomic | مرتجع قطع فريدة | purchase_return_unique |
| void_purchase_return_atomic | إلغاء مرتجع مشتريات | purchase_return_void |
| payment_voucher_atomic | سند صرف مورد | payment_voucher |
| create_customer_receipt_atomic | سند قبض عميل | customer_receipt |
| void_customer_receipt_atomic | إلغاء سند قبض | customer_receipt_void |
| create_transfer_atomic | تحويل مخزني | transfer |

### 8.2 خريطة الحسابات القياسية

| Config Key | Account Code | Account Name |
|------------|--------------|--------------|
| inventory | 1103 | المخزون |
| imported_inventory | 110307 | مخزون القطع المستوردة |
| vat_input | 2105 | ضريبة مدخلات |
| vat_output | 2106 | ضريبة مخرجات |
| ap_supplier | 2101 | ذمم موردين |
| ar_customer | 1201 | ذمم عملاء |
| sales_revenue | 4101 | إيرادات المبيعات |
| cogs | 5101 | تكلفة البضاعة المباعة |
| cash | 1101 | الصندوق |
| bank | 1102 | البنك |

### 8.3 أنماط القيود المحاسبية

```
=== فاتورة مشتريات ===
Dr: Inventory          (قيمة البضاعة)
Dr: VAT Input          (الضريبة)
Cr: AP Supplier        (الإجمالي)

=== مرتجع مشتريات ===
Dr: AP Supplier        (الإجمالي)
Cr: Inventory          (قيمة البضاعة)
Cr: VAT Input          (الضريبة)

=== سند صرف مورد ===
Dr: AP Supplier        (المبلغ)
Cr: Cash/Bank          (المبلغ)

=== بيع POS ===
Dr: Cash/Bank/AR       (الإجمالي)
Dr: COGS               (التكلفة)
Cr: Sales Revenue      (صافي المبيعات)
Cr: VAT Output         (الضريبة)
Cr: Inventory          (التكلفة)

=== مرتجع مبيعات ===
Dr: Sales Returns      (صافي)
Dr: Inventory          (التكلفة)
Cr: Cash/AR            (الإجمالي)
Cr: COGS               (التكلفة - عكس)

=== سند قبض عميل ===
Dr: Cash/Bank          (المبلغ)
Cr: AR Customer        (المبلغ)
```

---

## ✅ الخلاصة

هذه الوثيقة تغطي:
1. **البنية المعمارية**: RPC-Only، Atomic، Idempotent
2. **نموذج البيانات**: جداول موحدة مع triggers للحماية
3. **الشاشات**: وصف تفصيلي لكل شاشة مع الـ flows
4. **الأمان**: RLS + SECURITY DEFINER RPCs
5. **أنماط الكود**: DTOs, Validation, Services, Hooks
6. **الدروس المستفادة**: ما يجب تجنبه وما يجب اتباعه

**للبناء من الصفر:**
1. ابدأ بإنشاء الجداول الأساسية (parties, accounts, branches)
2. أضف الـ triggers الأساسية (balance check, posted lock, sync)
3. أنشئ الـ workflow_requests للـ idempotency
4. ابنِ الـ RPCs واحدة تلو الأخرى مع الاختبار
5. طبّق RLS على كل جدول
6. ابنِ الـ Domain Layer (DTOs, Validation, Services)
7. ابنِ الـ UI باستخدام الـ hooks

**القاعدة الذهبية:** كل عملية مالية تمر عبر RPC واحد atomic مع idempotency key.
