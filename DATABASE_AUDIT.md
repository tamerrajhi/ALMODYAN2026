# Database Audit Report — المودان للمجوهرات ERP
**تاريخ التقرير:** 2026-02-17  
**قاعدة البيانات:** Neon PostgreSQL  
**Schema:** public

---

## Section A: الجداول التي تحتوي بيانات (مرتبة تنازلياً)

| # | الجدول | عدد الصفوف (تقديري) | النوع |
|---|---|---|---|
| 1 | `unique_item_movements` | 12,017 | تشغيلي |
| 2 | `unique_purchase_invoice_items` | 8,964 | تشغيلي |
| 3 | `unique_items` | 8,964 | تشغيلي |
| 4 | `unique_purchase_return_items` | 1,938 | تشغيلي |
| 5 | `transfer_items` | 1,091 | تشغيلي |
| 6 | `role_permissions` | 84 | مرجعي/أمني |
| 7 | `screens` | 84 | مرجعي |
| 8 | `chart_of_accounts` | 42 | مرجعي |
| 9 | `branch_coa_accounts` | 24 | مرجعي |
| 10 | `auth_sessions` | 17 | أمني |
| 11 | `coa_account_templates` | 8 | مرجعي |
| 12 | `invoices` | 8 | تشغيلي |
| 13 | `accounting_config_keys` | 8 | مرجعي |
| 14 | `sales` | 8 | تشغيلي |
| 15 | `custom_roles` | 5 | مرجعي/أمني |
| 16 | `app_settings` | 5 | مرجعي |
| 17 | `serial_counters` | 4 | مرجعي (sequences) |
| 18 | `journal_entry_lines` | 4 | تشغيلي |
| 19 | `gold_karats` | 3 | مرجعي |
| 20 | `branches` | 3 | مرجعي |
| 21 | `user_branches` | 2 | مرجعي/أمني |
| 22 | `payment_account_settings` | 1 | مرجعي |
| 23 | `user_roles` | 1 | مرجعي/أمني |
| 24 | `profiles` | 1 | مرجعي/أمني |

**الجداول الفارغة (0 صفوف):** باقي الـ 67 جدول فارغة حالياً.

---

## Section B: FK Map (العلاقات — child → parent)

### الجداول الأب الأكثر اعتماداً عليها

| Parent | عدد FKs | أهم الأبناء |
|---|---|---|
| `branches` | 34 | كل الجداول التشغيلية تقريباً |
| `chart_of_accounts` | 13 | journal_entry_lines, cash_vaults, gold_vaults, branch configs |
| `unique_items` | 7 | movements, invoice_items, return_items, transfer_items, corrections, sales_invoice_items |
| `unique_purchase_invoices` | 5 | unique_items, correction_groups, purchase_returns, invoice_items |
| `invoices` | 6 | credit_notes, purchase_invoice/return_lines, sales, sales_invoice_items |
| `journal_entries` | 7 | invoices, payments, purchase_returns, returns, sales, unique_purchase_* |
| `suppliers` | 8 | invoices, jewelry_items, payments, purchase_batches/returns, unique_* |
| `customers` | 5 | credit_notes, gold_scrap, invoices, payments, sales |
| `jewelry_items` | 5 | inventory_count_readings, item_movements, purchase_return_items, sale_items |

### جميع العلاقات (FK Edges)

| Child Table | Child Column | Parent Table | Parent Column |
|---|---|---|---|
| `audit_logs` | `branch_id` | `branches` | `id` |
| `branch_accounting_config` | `branch_id` | `branches` | `id` |
| `branch_coa_accounts` | `branch_id` | `branches` | `id` |
| `branch_inventory_accounts` | `branch_id` | `branches` | `id` |
| `cash_vaults` | `branch_id` | `branches` | `id` |
| `credit_notes` | `branch_id` | `branches` | `id` |
| `gold_scrap` | `branch_id` | `branches` | `id` |
| `gold_vaults` | `branch_id` | `branches` | `id` |
| `inventory_counts` | `branch_id` | `branches` | `id` |
| `invoices` | `branch_id` | `branches` | `id` |
| `item_movements` | `from_branch_id` | `branches` | `id` |
| `item_movements` | `to_branch_id` | `branches` | `id` |
| `jewelry_items` | `branch_id` | `branches` | `id` |
| `jewelry_sets` | `branch_id` | `branches` | `id` |
| `journal_entries` | `branch_id` | `branches` | `id` |
| `payment_account_settings` | `branch_id` | `branches` | `id` |
| `payments` | `branch_id` | `branches` | `id` |
| `production_account_settings` | `branch_id` | `branches` | `id` |
| `profiles` | `default_branch_id` | `branches` | `id` |
| `purchase_batches` | `branch_id` | `branches` | `id` |
| `purchase_returns` | `branch_id` | `branches` | `id` |
| `returns` | `branch_id` | `branches` | `id` |
| `sales` | `branch_id` | `branches` | `id` |
| `transfer_requests` | `from_branch_id` | `branches` | `id` |
| `transfer_requests` | `to_branch_id` | `branches` | `id` |
| `transfers` | `from_branch_id` | `branches` | `id` |
| `transfers` | `to_branch_id` | `branches` | `id` |
| `unique_item_movements` | `from_branch_id` | `branches` | `id` |
| `unique_item_movements` | `to_branch_id` | `branches` | `id` |
| `unique_items` | `branch_id` | `branches` | `id` |
| `unique_purchase_batches` | `branch_id` | `branches` | `id` |
| `unique_purchase_invoices` | `branch_id` | `branches` | `id` |
| `unique_purchase_returns` | `branch_id` | `branches` | `id` |
| `user_branches` | `branch_id` | `branches` | `id` |
| `branch_accounting_config` | `account_id` | `chart_of_accounts` | `id` |
| `branch_coa_accounts` | `account_id` | `chart_of_accounts` | `id` |
| `branch_inventory_accounts` | `general_inventory_account_id` | `chart_of_accounts` | `id` |
| `branch_inventory_accounts` | `imported_pieces_account_id` | `chart_of_accounts` | `id` |
| `cash_vaults` | `account_id` | `chart_of_accounts` | `id` |
| `chart_of_accounts` | `parent_id` | `chart_of_accounts` | `id` |
| `gold_vaults` | `account_id` | `chart_of_accounts` | `id` |
| `journal_entry_lines` | `account_id` | `chart_of_accounts` | `id` |
| `payment_account_settings` | `bank_transfer_account_id` | `chart_of_accounts` | `id` |
| `payment_account_settings` | `card_account_id` | `chart_of_accounts` | `id` |
| `payment_account_settings` | `check_account_id` | `chart_of_accounts` | `id` |
| `payment_account_settings` | `cash_account_id` | `chart_of_accounts` | `id` |
| `production_account_settings` | `finished_goods_account_id` | `chart_of_accounts` | `id` |
| `production_account_settings` | `scrap_loss_account_id` | `chart_of_accounts` | `id` |
| `production_account_settings` | `wip_account_id` | `chart_of_accounts` | `id` |
| `production_account_settings` | `raw_material_account_id` | `chart_of_accounts` | `id` |
| `branch_coa_accounts` | `template_code` | `coa_account_templates` | `template_code` |
| `coa_account_templates` | `parent_template_code` | `coa_account_templates` | `template_code` |
| `role_modules` | `role_id` | `custom_roles` | `id` |
| `role_permissions` | `role_id` | `custom_roles` | `id` |
| `user_custom_roles` | `role_id` | `custom_roles` | `id` |
| `credit_notes` | `customer_id` | `customers` | `id` |
| `gold_scrap` | `customer_id` | `customers` | `id` |
| `invoices` | `customer_id` | `customers` | `id` |
| `payments` | `customer_id` | `customers` | `id` |
| `returns` | `customer_id` | `customers` | `id` |
| `sales` | `customer_id` | `customers` | `id` |
| `inventory_count_readings` | `count_id` | `inventory_counts` | `id` |
| `inventory_count_results` | `count_id` | `inventory_counts` | `id` |
| `credit_notes` | `invoice_id` | `invoices` | `id` |
| `purchase_invoice_lines` | `invoice_id` | `invoices` | `id` |
| `purchase_return_lines` | `invoice_id` | `invoices` | `id` |
| `returns` | `original_invoice_id` | `invoices` | `id` |
| `sales` | `invoice_id` | `invoices` | `id` |
| `sales_invoice_items` | `invoice_id` | `invoices` | `id` |
| `supplier_payment_allocations` | `invoice_id` | `invoices` | `id` |
| `inventory_count_readings` | `item_id` | `jewelry_items` | `id` |
| `item_movements` | `item_id` | `jewelry_items` | `id` |
| `purchase_return_items` | `jewelry_item_id` | `jewelry_items` | `id` |
| `sale_items` | `item_id` | `jewelry_items` | `id` |
| `transfer_request_items` | `item_id` | `jewelry_items` | `id` |
| `jewelry_items` | `set_id` | `jewelry_sets` | `id` |
| `invoices` | `journal_entry_id` | `journal_entries` | `id` |
| `journal_entry_lines` | `journal_entry_id` | `journal_entries` | `id` |
| `payments` | `journal_entry_id` | `journal_entries` | `id` |
| `purchase_returns` | `journal_entry_id` | `journal_entries` | `id` |
| `returns` | `journal_entry_id` | `journal_entries` | `id` |
| `sales` | `journal_entry_id` | `journal_entries` | `id` |
| `unique_purchase_invoices` | `journal_entry_id` | `journal_entries` | `id` |
| `unique_purchase_returns` | `journal_entry_id` | `journal_entries` | `id` |
| `role_modules` | `module_key` | `modules` | `module_key` |
| `screens` | `module_key` | `modules` | `module_key` |
| `supplier_payment_allocations` | `payment_id` | `payments` | `id` |
| `auth_sessions` | `user_id` | `profiles` | `user_id` |
| `import_row_errors` | `batch_id` | `purchase_batches` | `id` |
| `invoices` | `batch_id` | `purchase_batches` | `id` |
| `jewelry_items` | `batch_id` | `purchase_batches` | `id` |
| `jewelry_sets` | `batch_id` | `purchase_batches` | `id` |
| `label_print_jobs` | `batch_id` | `purchase_batches` | `id` |
| `purchase_correction_artifacts` | `action_id` | `purchase_correction_actions` | `id` |
| `purchase_correction_actions` | `group_id` | `purchase_correction_groups` | `id` |
| `purchase_correction_artifacts` | `group_id` | `purchase_correction_groups` | `id` |
| `purchase_order_items` | `po_id` | `purchase_orders` | `id` |
| `purchase_order_receipts` | `po_id` | `purchase_orders` | `id` |
| `purchase_requisition_lines` | `pr_id` | `purchase_requisitions` | `id` |
| `purchase_return_items` | `return_id` | `purchase_returns` | `id` |
| `purchase_return_lines` | `return_id` | `purchase_returns` | `id` |
| `return_items` | `return_id` | `returns` | `id` |
| `returns` | `original_sale_id` | `sales` | `id` |
| `sale_items` | `sale_id` | `sales` | `id` |
| `role_permissions` | `screen_path` | `screens` | `screen_path` |
| `gold_scrap` | `supplier_id` | `suppliers` | `id` |
| `invoices` | `supplier_id` | `suppliers` | `id` |
| `jewelry_items` | `supplier_id` | `suppliers` | `id` |
| `payments` | `supplier_id` | `suppliers` | `id` |
| `purchase_batches` | `supplier_id` | `suppliers` | `id` |
| `purchase_returns` | `supplier_id` | `suppliers` | `id` |
| `returns` | `supplier_id` | `suppliers` | `id` |
| `supplier_payment_allocations` | `supplier_id` | `suppliers` | `id` |
| `unique_items` | `supplier_id` | `suppliers` | `id` |
| `unique_purchase_batches` | `supplier_id` | `suppliers` | `id` |
| `unique_purchase_invoices` | `supplier_id` | `suppliers` | `id` |
| `unique_purchase_returns` | `supplier_id` | `suppliers` | `id` |
| `transfer_request_items` | `request_id` | `transfer_requests` | `id` |
| `transfer_items` | `transfer_id` | `transfers` | `id` |
| `purchase_correction_actions` | `source_unique_item_id` | `unique_items` | `id` |
| `return_items` | `item_id` | `unique_items` | `id` |
| `sales_invoice_items` | `jewelry_item_id` | `unique_items` | `id` |
| `transfer_items` | `unique_item_id` | `unique_items` | `id` |
| `unique_item_movements` | `unique_item_id` | `unique_items` | `id` |
| `unique_purchase_invoice_items` | `unique_item_id` | `unique_items` | `id` |
| `unique_purchase_return_items` | `unique_item_id` | `unique_items` | `id` |
| `unique_items` | `batch_id` | `unique_purchase_batches` | `id` |
| `unique_purchase_invoices` | `batch_id` | `unique_purchase_batches` | `id` |
| `purchase_correction_groups` | `parent_unique_invoice_id` | `unique_purchase_invoices` | `id` |
| `purchase_returns` | `purchase_invoice_id` | `unique_purchase_invoices` | `id` |
| `unique_items` | `unique_invoice_id` | `unique_purchase_invoices` | `id` |
| `unique_purchase_invoice_items` | `unique_invoice_id` | `unique_purchase_invoices` | `id` |
| `unique_purchase_returns` | `unique_invoice_id` | `unique_purchase_invoices` | `id` |
| `unique_purchase_return_items` | `unique_return_id` | `unique_purchase_returns` | `id` |

---

## Section C: Factory Reset Plan

### قائمة TRUNCATE المقترحة (جداول تشغيلية) — بترتيب آمن

```sql
-- ═══════════════════════════════════════════════════════════
-- FACTORY RESET — Operational Tables Only
-- ═══════════════════════════════════════════════════════════

-- الطبقة 1: أبناء الأبناء (leaf tables)
TRUNCATE TABLE purchase_correction_artifacts CASCADE;
TRUNCATE TABLE purchase_correction_actions CASCADE;
TRUNCATE TABLE purchase_correction_groups CASCADE;
TRUNCATE TABLE unique_purchase_return_items CASCADE;
TRUNCATE TABLE unique_purchase_invoice_items CASCADE;
TRUNCATE TABLE unique_item_movements CASCADE;
TRUNCATE TABLE transfer_items CASCADE;
TRUNCATE TABLE transfer_request_items CASCADE;
TRUNCATE TABLE return_items CASCADE;
TRUNCATE TABLE sale_items CASCADE;
TRUNCATE TABLE sales_invoice_items CASCADE;
TRUNCATE TABLE purchase_return_items CASCADE;
TRUNCATE TABLE purchase_return_lines CASCADE;
TRUNCATE TABLE purchase_invoice_lines CASCADE;
TRUNCATE TABLE purchase_order_items CASCADE;
TRUNCATE TABLE purchase_order_receipts CASCADE;
TRUNCATE TABLE purchase_requisition_lines CASCADE;
TRUNCATE TABLE purchase_requisition_items CASCADE;
TRUNCATE TABLE supplier_payment_allocations CASCADE;
TRUNCATE TABLE import_row_errors CASCADE;
TRUNCATE TABLE label_print_jobs CASCADE;
TRUNCATE TABLE credit_notes CASCADE;
TRUNCATE TABLE journal_entry_lines CASCADE;
TRUNCATE TABLE inventory_count_readings CASCADE;
TRUNCATE TABLE inventory_count_results CASCADE;
TRUNCATE TABLE item_movements CASCADE;
TRUNCATE TABLE cost_entries CASCADE;
TRUNCATE TABLE accounting_audit_logs CASCADE;
TRUNCATE TABLE accounting_health_check_results CASCADE;

-- الطبقة 2: جداول وسطى
TRUNCATE TABLE unique_purchase_returns CASCADE;
TRUNCATE TABLE unique_items CASCADE;
TRUNCATE TABLE unique_purchase_invoices CASCADE;
TRUNCATE TABLE unique_purchase_batches CASCADE;
TRUNCATE TABLE purchase_returns CASCADE;
TRUNCATE TABLE returns CASCADE;
TRUNCATE TABLE sales CASCADE;
TRUNCATE TABLE invoices CASCADE;
TRUNCATE TABLE payments CASCADE;
TRUNCATE TABLE journal_entries CASCADE;
TRUNCATE TABLE transfers CASCADE;
TRUNCATE TABLE transfer_requests CASCADE;
TRUNCATE TABLE purchase_batches CASCADE;
TRUNCATE TABLE purchase_orders CASCADE;
TRUNCATE TABLE purchase_requisitions CASCADE;
TRUNCATE TABLE inventory_counts CASCADE;
TRUNCATE TABLE jewelry_items CASCADE;
TRUNCATE TABLE jewelry_sets CASCADE;
TRUNCATE TABLE gold_scrap CASCADE;
TRUNCATE TABLE finished_goods_showroom CASCADE;

-- الطبقة 3: جداول مساعدة/نظامية
TRUNCATE TABLE pos_workflow_requests CASCADE;
TRUNCATE TABLE atomic_workflow_requests CASCADE;
TRUNCATE TABLE backup_logs CASCADE;
TRUNCATE TABLE accounting_health_check_runs CASCADE;
TRUNCATE TABLE attachments CASCADE;
TRUNCATE TABLE gold_prices CASCADE;
TRUNCATE TABLE fiscal_years CASCADE;
TRUNCATE TABLE products CASCADE;

-- الطبقة 4: إعادة تعيين العدادات
TRUNCATE TABLE serial_counters CASCADE;
-- ثم إعادة إدراج العدادات:
-- INSERT INTO serial_counters (prefix, current_val) VALUES
--   ('FSETN', 0), ('FSETE', 0), ('FSETR', 0), ('FSETB', 0);

-- إعادة تعيين الـ Document Sequences:
ALTER SEQUENCE upb_doc_seq RESTART WITH 1;
ALTER SEQUENCE uinv_doc_seq RESTART WITH 1;
ALTER SEQUENCE je_uimp_doc_seq RESTART WITH 1;
ALTER SEQUENCE je_doc_seq RESTART WITH 1;
ALTER SEQUENCE upr_doc_seq RESTART WITH 1;
ALTER SEQUENCE ucor_doc_seq RESTART WITH 1;
```

### قائمة KEEP (الجداول المرجعية — لا تُمسح)

| الجدول | السبب |
|---|---|
| `profiles` | حسابات المستخدمين |
| `auth_sessions` | جلسات تسجيل الدخول (يمكن مسحها اختيارياً) |
| `user_roles` | ربط المستخدمين بالأدوار |
| `user_branches` | ربط المستخدمين بالفروع |
| `user_custom_roles` | أدوار مخصصة للمستخدمين |
| `custom_roles` | تعريف الأدوار |
| `role_permissions` | صلاحيات الأدوار |
| `role_modules` | وحدات الأدوار |
| `modules` | وحدات النظام |
| `screens` | شاشات النظام |
| `branches` | الفروع |
| `suppliers` | الموردين |
| `customers` | العملاء |
| `chart_of_accounts` | شجرة الحسابات |
| `branch_coa_accounts` | حسابات الفروع |
| `coa_account_templates` | قوالب الحسابات |
| `branch_accounting_config` | إعدادات المحاسبة |
| `branch_inventory_accounts` | حسابات المخزون |
| `payment_account_settings` | إعدادات حسابات الدفع |
| `production_account_settings` | إعدادات الإنتاج |
| `accounting_config_keys` | مفاتيح الإعدادات |
| `app_settings` | إعدادات التطبيق |
| `gold_karats` | عيارات الذهب |
| `cash_vaults` | الخزن النقدية |
| `gold_vaults` | خزن الذهب |
| `cost_centers` | مراكز التكلفة |
| `departments` | الأقسام |
| `employees` | الموظفين |
| `pr_approval_thresholds` | حدود الموافقات |
| `workflow_types` | أنواع سير العمل |

---

## Section D: استخدام كل جدول تشغيلي

### جداول القطع الفريدة (Unique Items System)

| الجدول | الاستخدام |
|---|---|
| `unique_items` | الجدول الرئيسي للمخزون — كل قطعة مجوهرات فريدة بسيريال (FSETN/FSETE/FSETR/FSETB) |
| `unique_item_movements` | حركات القطع (شراء، تحويل، بيع، إرجاع) — سجل تتبع كامل |
| `unique_purchase_batches` | دفعات الشراء الفريدة (تجميع فواتير من نفس المورد) |
| `unique_purchase_invoices` | فواتير شراء القطع الفريدة |
| `unique_purchase_invoice_items` | بنود فواتير الشراء (ربط القطع بالفواتير) |
| `unique_purchase_returns` | مرتجعات شراء القطع الفريدة |
| `unique_purchase_return_items` | بنود المرتجعات (أي قطع تم إرجاعها) |

### جداول التصحيح (Purchase Corrections)

| الجدول | الاستخدام |
|---|---|
| `purchase_correction_groups` | مجموعات تصحيح مرتبطة بفاتورة شراء (UCOR-) |
| `purchase_correction_actions` | إجراءات التصحيح الفردية (تعديل وزن، سعر، إلخ) |
| `purchase_correction_artifacts` | المخرجات/الأثار الناتجة عن كل إجراء تصحيح |

### جداول المبيعات والمرتجعات

| الجدول | الاستخدام |
|---|---|
| `sales` | عمليات البيع |
| `sale_items` | بنود المبيعات (legacy — مرتبط بـ jewelry_items) |
| `sales_invoice_items` | بنود فواتير المبيعات (مرتبط بـ unique_items) |
| `invoices` | الفواتير (شراء/بيع) |
| `returns` | مرتجعات المبيعات |
| `return_items` | بنود مرتجعات المبيعات |
| `credit_notes` | إشعارات دائنة للعملاء |

### جداول المحاسبة

| الجدول | الاستخدام |
|---|---|
| `journal_entries` | القيود المحاسبية (JE) |
| `journal_entry_lines` | بنود القيود (مدين/دائن لكل حساب) |
| `payments` | المدفوعات (نقد، شيك، تحويل بنكي) |
| `supplier_payment_allocations` | توزيع المدفوعات على فواتير الموردين |
| `fiscal_years` | السنوات المالية |
| `cost_entries` | قيود التكاليف |
| `accounting_audit_logs` | سجل تدقيق المحاسبة |
| `accounting_health_check_runs` | عمليات فحص صحة المحاسبة |
| `accounting_health_check_results` | نتائج فحص الصحة |

### جداول التحويلات

| الجدول | الاستخدام |
|---|---|
| `transfers` | عمليات تحويل بين الفروع |
| `transfer_items` | بنود التحويل (القطع المنقولة) |
| `transfer_requests` | طلبات تحويل (قبل الموافقة) |
| `transfer_request_items` | بنود طلبات التحويل |

### جداول المشتريات العامة (غير فريدة)

| الجدول | الاستخدام |
|---|---|
| `purchase_batches` | دفعات شراء عامة (jewelry_items) |
| `purchase_invoice_lines` | بنود فواتير الشراء العامة |
| `purchase_returns` | مرتجعات شراء عامة |
| `purchase_return_items` | بنود مرتجعات الشراء (jewelry) |
| `purchase_return_lines` | بنود مرتجعات مرتبطة بفواتير |
| `purchase_orders` | أوامر الشراء |
| `purchase_order_items` | بنود أوامر الشراء |
| `purchase_order_receipts` | إيصالات استلام أوامر الشراء |
| `purchase_requisitions` | طلبات الشراء |
| `purchase_requisition_items` | بنود طلبات الشراء |
| `purchase_requisition_lines` | سطور طلبات الشراء |

### جداول المخزون العامة

| الجدول | الاستخدام |
|---|---|
| `jewelry_items` | قطع المجوهرات العامة (غير فريدة) |
| `jewelry_sets` | أطقم المجوهرات |
| `item_movements` | حركات القطع العامة |
| `inventory_counts` | عمليات الجرد |
| `inventory_count_readings` | قراءات الجرد الفردية |
| `inventory_count_results` | نتائج الجرد |
| `finished_goods_showroom` | المنتجات المعروضة في الصالة |

### جداول الذهب

| الجدول | الاستخدام |
|---|---|
| `gold_scrap` | خردة الذهب (كسر) |
| `gold_prices` | أسعار الذهب اليومية |

### جداول مساعدة/نظامية

| الجدول | الاستخدام |
|---|---|
| `serial_counters` | عدادات السيريالات (FSETN/FSETE/FSETR/FSETB) |
| `pos_workflow_requests` | طلبات نقاط البيع (idempotency) |
| `atomic_workflow_requests` | طلبات العمليات الذرية (idempotency) |
| `import_row_errors` | أخطاء استيراد البيانات |
| `label_print_jobs` | مهام طباعة الملصقات |
| `attachments` | المرفقات |
| `backup_logs` | سجل النسخ الاحتياطي |
| `products` | المنتجات (catalog) |

---

## Section E: Sequences النشطة

| Sequence | الاستخدام | ملاحظات |
|---|---|---|
| `upb_doc_seq` | أرقام دفعات الشراء UPB- | 6-digit padding |
| `uinv_doc_seq` | أرقام فواتير الشراء UINV- / UINV-COR- | 6-digit padding |
| `je_uimp_doc_seq` | قيود الاستيراد JE-UIMP- | 6-digit padding |
| `je_doc_seq` | قيود عامة JE-COR-R/A / JE-UPR / JE-VUPR | 6-digit padding |
| `upr_doc_seq` | مرتجعات الشراء UPR- / UPR-COR- | 6-digit padding |
| `ucor_doc_seq` | مجموعات التصحيح UCOR- | 6-digit padding |

**Sequences محذوفة (legacy):**
- `unique_serial_seq` — حُذف 2026-02-17
- `unique_invoice_seq` — حُذف 2026-02-17
- `unique_item_serial_seq` — حُذف 2026-02-17

---

## Section F: ملاحظات المخاطر

1. **`audit_logs`** — مرتبط بـ `branches` (FK) — تشغيلي لكن قد يُرغب الاحتفاظ به كسجل تاريخي.
2. **`serial_counters`** — يجب إعادة تعيينه (TRUNCATE + إعادة إدراج الـ 4 prefixes بقيمة 0) وإلا ستبدأ السيريالات من حيث توقفت.
3. **`auth_sessions`** — مرجعي/أمني لكن يمكن مسحه بأمان (سيُعاد تسجيل الدخول).
4. **Document Sequences** — يجب عمل `ALTER SEQUENCE ... RESTART WITH 1` بعد الـ TRUNCATE.
5. **`journal_entries` ↔ `invoices`** — علاقة دائرية (invoices.journal_entry_id → journal_entries) — `CASCADE` ضروري أو تعطيل FK مؤقتاً.
6. **البيانات التاريخية (Legacy):** 7,995 قطعة بسيريالات SN- القديمة ستُحذف عند الـ Factory Reset.
