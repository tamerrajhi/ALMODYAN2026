import { pgTable, text, uuid, timestamp, boolean, numeric, integer, pgEnum, jsonb } from "drizzle-orm/pg-core";

export const accountTypeEnum = pgEnum('account_type', ['asset', 'liability', 'equity', 'revenue', 'expense']);
export const appRoleEnum = pgEnum('app_role', ['admin', 'purchases_clerk']);
export const batchStatusEnum = pgEnum('batch_status', ['DRAFT', 'VALIDATED', 'IMPORTED', 'FAILED']);
export const labelJobStatusEnum = pgEnum('label_job_status', ['CREATED', 'GENERATED', 'PRINTED', 'FAILED']);
export const labelJobTypeEnum = pgEnum('label_job_type', ['ITEM', 'SET', 'BATCH_ITEMS', 'BATCH_SETS', 'BATCH_ALL']);

export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  name_en: text('name_en'),
  address: text('address'),
  phone: text('phone'),
  is_active: boolean('is_active').default(true),
  is_main: boolean('is_main').default(false),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplier_code: text('supplier_code').unique(),
  name: text('name').notNull(),
  name_en: text('name_en'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  tax_number: text('tax_number'),
  contact_person: text('contact_person'),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  customer_code: text('customer_code').unique(),
  name: text('name').notNull(),
  name_en: text('name_en'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  tax_number: text('tax_number'),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const chartOfAccounts = pgTable('chart_of_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  account_code: text('account_code').notNull().unique(),
  account_name: text('account_name').notNull(),
  account_name_en: text('account_name_en'),
  account_type: accountTypeEnum('account_type').notNull(),
  parent_id: uuid('parent_id'),
  is_active: boolean('is_active').default(true),
  is_system: boolean('is_system').default(false),
  balance: numeric('balance', { precision: 15, scale: 2 }).default('0'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  entry_number: text('entry_number').notNull().unique(),
  entry_date: timestamp('entry_date', { withTimezone: true }).notNull(),
  description: text('description'),
  reference_type: text('reference_type'),
  reference_id: uuid('reference_id'),
  is_posted: boolean('is_posted').default(false),
  posted_at: timestamp('posted_at', { withTimezone: true }),
  posted_by: uuid('posted_by'),
  branch_id: uuid('branch_id'),
  total_debit: numeric('total_debit', { precision: 15, scale: 2 }).default('0'),
  total_credit: numeric('total_credit', { precision: 15, scale: 2 }).default('0'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
});

export const journalEntryLines = pgTable('journal_entry_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  journal_entry_id: uuid('journal_entry_id').notNull(),
  account_id: uuid('account_id').notNull(),
  debit_amount: numeric('debit_amount', { precision: 15, scale: 2 }).default('0'),
  credit_amount: numeric('credit_amount', { precision: 15, scale: 2 }).default('0'),
  description: text('description'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const purchaseBatches = pgTable('purchase_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  batch_no: text('batch_no').notNull().unique(),
  status: batchStatusEnum('status').default('DRAFT'),
  supplier_id: uuid('supplier_id'),
  branch_id: uuid('branch_id'),
  invoice_id: uuid('invoice_id'),
  uploaded_file_name: text('uploaded_file_name'),
  total_items: integer('total_items').default(0),
  total_weight: numeric('total_weight', { precision: 15, scale: 3 }).default('0'),
  total_cost: numeric('total_cost', { precision: 15, scale: 2 }).default('0'),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
});

export const jewelrySets = pgTable('jewelry_sets', {
  id: uuid('id').primaryKey().defaultRandom(),
  set_code: text('set_code').unique(),
  name: text('name'),
  name_en: text('name_en'),
  category: text('category'),
  total_pieces: integer('total_pieces').default(0),
  total_weight: numeric('total_weight', { precision: 10, scale: 3 }).default('0'),
  batch_id: uuid('batch_id'),
  branch_id: uuid('branch_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const jewelryItems = pgTable('jewelry_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  item_code: text('item_code').notNull().unique(),
  barcode: text('barcode'),
  name: text('name').notNull(),
  name_en: text('name_en'),
  category: text('category'),
  karat: text('karat'),
  weight_grams: numeric('weight_grams', { precision: 10, scale: 3 }),
  unit_cost: numeric('unit_cost', { precision: 15, scale: 2 }),
  selling_price: numeric('selling_price', { precision: 15, scale: 2 }),
  status: text('status').default('available'),
  branch_id: uuid('branch_id'),
  batch_id: uuid('batch_id'),
  set_id: uuid('set_id'),
  supplier_id: uuid('supplier_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  product_code: text('product_code').notNull().unique(),
  barcode: text('barcode'),
  sku: text('sku'),
  name_ar: text('name_ar').notNull(),
  name_en: text('name_en'),
  description: text('description'),
  product_type: text('product_type').default('general'),
  product_sub_type: text('product_sub_type'),
  category: text('category'),
  unit: text('unit').default('piece'),
  karat: text('karat'),
  metal: text('metal'),
  weight_grams: numeric('weight_grams', { precision: 10, scale: 3 }),
  cost_price: numeric('cost_price', { precision: 15, scale: 2 }).default('0'),
  selling_price: numeric('selling_price', { precision: 15, scale: 2 }).default('0'),
  min_price: numeric('min_price', { precision: 15, scale: 2 }),
  tax_rate: numeric('tax_rate', { precision: 5, scale: 2 }).default('15'),
  is_tax_inclusive: boolean('is_tax_inclusive').default(false),
  is_active: boolean('is_active').default(true),
  is_service: boolean('is_service').default(false),
  service_duration_minutes: integer('service_duration_minutes'),
  inventory_account_id: uuid('inventory_account_id'),
  expense_account_id: uuid('expense_account_id'),
  default_warehouse_id: uuid('default_warehouse_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const costCenters = pgTable('cost_centers', {
  id: uuid('id').primaryKey().defaultRandom(),
  center_code: text('center_code').notNull().unique(),
  center_name: text('center_name').notNull(),
  center_name_en: text('center_name_en'),
  description: text('description'),
  parent_id: uuid('parent_id'),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const costEntries = pgTable('cost_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  cost_code: text('cost_code').notNull().unique(),
  name_ar: text('name_ar').notNull(),
  name_en: text('name_en'),
  description: text('description'),
  cost_type: text('cost_type').notNull(),
  gl_account_id: uuid('gl_account_id').notNull(),
  cost_center_id: uuid('cost_center_id'),
  tax_rate: numeric('tax_rate', { precision: 5, scale: 2 }).default('15'),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoice_number: text('invoice_number').notNull().unique(),
  invoice_type: text('invoice_type').notNull(),
  invoice_date: timestamp('invoice_date', { withTimezone: true }).notNull(),
  due_date: timestamp('due_date', { withTimezone: true }),
  status: text('status').default('draft'),
  customer_id: uuid('customer_id'),
  supplier_id: uuid('supplier_id'),
  branch_id: uuid('branch_id'),
  batch_id: uuid('batch_id'),
  subtotal: numeric('subtotal', { precision: 15, scale: 2 }).default('0'),
  tax_amount: numeric('tax_amount', { precision: 15, scale: 2 }).default('0'),
  discount_amount: numeric('discount_amount', { precision: 15, scale: 2 }).default('0'),
  total_amount: numeric('total_amount', { precision: 15, scale: 2 }).default('0'),
  notes: text('notes'),
  journal_entry_id: uuid('journal_entry_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
});

export const purchaseInvoiceLines = pgTable('purchase_invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoice_id: uuid('invoice_id').notNull(),
  item_id: uuid('item_id'),
  description: text('description'),
  quantity: integer('quantity').default(1),
  unit_price: numeric('unit_price', { precision: 15, scale: 2 }).default('0'),
  total_price: numeric('total_price', { precision: 15, scale: 2 }).default('0'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const itemMovements = pgTable('item_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  item_id: uuid('item_id').notNull(),
  movement_type: text('movement_type').notNull(),
  from_branch_id: uuid('from_branch_id'),
  to_branch_id: uuid('to_branch_id'),
  reference_type: text('reference_type'),
  reference_id: uuid('reference_id'),
  unit_cost: numeric('unit_cost', { precision: 15, scale: 2 }),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
});

export const sales = pgTable('sales', {
  id: uuid('id').primaryKey().defaultRandom(),
  sale_number: text('sale_number').unique(),
  sale_date: timestamp('sale_date', { withTimezone: true }).defaultNow(),
  customer_id: uuid('customer_id'),
  branch_id: uuid('branch_id'),
  subtotal: numeric('subtotal', { precision: 15, scale: 2 }).default('0'),
  tax_amount: numeric('tax_amount', { precision: 15, scale: 2 }).default('0'),
  discount_amount: numeric('discount_amount', { precision: 15, scale: 2 }).default('0'),
  total_amount: numeric('total_amount', { precision: 15, scale: 2 }).default('0'),
  status: text('status').default('completed'),
  notes: text('notes'),
  journal_entry_id: uuid('journal_entry_id'),
  invoice_id: uuid('invoice_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
});

export const saleItems = pgTable('sale_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  sale_id: uuid('sale_id').notNull(),
  item_id: uuid('item_id'),
  quantity: integer('quantity').default(1),
  unit_price: numeric('unit_price', { precision: 15, scale: 2 }).default('0'),
  total_price: numeric('total_price', { precision: 15, scale: 2 }).default('0'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const returns = pgTable('returns', {
  id: uuid('id').primaryKey().defaultRandom(),
  return_number: text('return_number').unique(),
  return_type: text('return_type').notNull(),
  return_date: timestamp('return_date', { withTimezone: true }).defaultNow(),
  original_invoice_id: uuid('original_invoice_id'),
  original_sale_id: uuid('original_sale_id'),
  customer_id: uuid('customer_id'),
  supplier_id: uuid('supplier_id'),
  branch_id: uuid('branch_id'),
  subtotal: numeric('subtotal', { precision: 15, scale: 2 }).default('0'),
  tax_amount: numeric('tax_amount', { precision: 15, scale: 2 }).default('0'),
  total_amount: numeric('total_amount', { precision: 15, scale: 2 }).default('0'),
  status: text('status').default('pending'),
  notes: text('notes'),
  journal_entry_id: uuid('journal_entry_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
});

export const returnItems = pgTable('return_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  return_id: uuid('return_id').notNull(),
  item_id: uuid('item_id'),
  quantity: integer('quantity').default(1),
  unit_price: numeric('unit_price', { precision: 15, scale: 2 }).default('0'),
  total_price: numeric('total_price', { precision: 15, scale: 2 }).default('0'),
  reason: text('reason'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const transfers = pgTable('transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  transfer_number: text('transfer_number').unique(),
  from_branch_id: uuid('from_branch_id'),
  to_branch_id: uuid('to_branch_id'),
  status: text('status').default('pending'),
  transfer_date: timestamp('transfer_date', { withTimezone: true }).defaultNow(),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
});

export const transferItems = pgTable('transfer_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  transfer_id: uuid('transfer_id').notNull(),
  item_id: uuid('item_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const transferRequests = pgTable('transfer_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  request_number: text('request_number').unique(),
  from_branch_id: uuid('from_branch_id'),
  to_branch_id: uuid('to_branch_id'),
  status: text('status').default('pending'),
  requested_at: timestamp('requested_at', { withTimezone: true }).defaultNow(),
  approved_at: timestamp('approved_at', { withTimezone: true }),
  approved_by: uuid('approved_by'),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
});

export const transferRequestItems = pgTable('transfer_request_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  request_id: uuid('request_id').notNull(),
  item_id: uuid('item_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  payment_number: text('payment_number').unique(),
  payment_type: text('payment_type').notNull(),
  payment_date: timestamp('payment_date', { withTimezone: true }).defaultNow(),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  payment_method: text('payment_method'),
  reference_type: text('reference_type'),
  reference_id: uuid('reference_id'),
  customer_id: uuid('customer_id'),
  supplier_id: uuid('supplier_id'),
  branch_id: uuid('branch_id'),
  journal_entry_id: uuid('journal_entry_id'),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
  invoice_id: uuid('invoice_id'),
  status: text('status'),
  void_reason: text('void_reason'),
  voided_at: timestamp('voided_at', { withTimezone: true }),
  seller_profile_id: uuid('seller_profile_id'),
});

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').unique(),
  username: text('username').unique(),
  full_name: text('full_name'),
  email: text('email'),
  avatar_url: text('avatar_url'),
  default_branch_id: uuid('default_branch_id'),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const customRoles = pgTable('custom_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  role_name: text('role_name').notNull(),
  role_name_en: text('role_name_en'),
  description: text('description'),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const userRoles = pgTable('user_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  role: appRoleEnum('role').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const userCustomRoles = pgTable('user_custom_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  role_id: uuid('role_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const userBranches = pgTable('user_branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  branch_id: uuid('branch_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const screens = pgTable('screens', {
  id: uuid('id').primaryKey().defaultRandom(),
  screen_key: text('screen_key').notNull().unique(),
  screen_name: text('screen_name').notNull(),
  screen_name_en: text('screen_name_en'),
  module: text('module'),
  description: text('description'),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  role_id: uuid('role_id').notNull(),
  screen_id: uuid('screen_id').notNull(),
  can_view: boolean('can_view').default(false),
  can_create: boolean('can_create').default(false),
  can_edit: boolean('can_edit').default(false),
  can_delete: boolean('can_delete').default(false),
  custom_permissions: jsonb('custom_permissions').default({}),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  screen_id: uuid('screen_id'),
  can_view: boolean('can_view').default(false),
  can_create: boolean('can_create').default(false),
  can_edit: boolean('can_edit').default(false),
  can_delete: boolean('can_delete').default(false),
  custom_permissions: jsonb('custom_permissions').default({}),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  value_type: text('value_type').notNull(),
  scope: text('scope').notNull(),
  description: text('description'),
  is_editable: boolean('is_editable').default(true),
  is_sensitive: boolean('is_sensitive').default(false),
  is_system: boolean('is_system').default(false),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const goldKarats = pgTable('gold_karats', {
  id: uuid('id').primaryKey().defaultRandom(),
  karat: text('karat').notNull().unique(),
  purity: numeric('purity', { precision: 5, scale: 4 }).notNull(),
  name: text('name'),
  name_en: text('name_en'),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const goldPrices = pgTable('gold_prices', {
  id: uuid('id').primaryKey().defaultRandom(),
  karat: text('karat').notNull(),
  price_per_gram: numeric('price_per_gram', { precision: 15, scale: 2 }).notNull(),
  effective_date: timestamp('effective_date', { withTimezone: true }).notNull(),
  is_current: boolean('is_current').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
});

export const goldScrap = pgTable('gold_scrap', {
  id: uuid('id').primaryKey().defaultRandom(),
  scrap_code: text('scrap_code').unique(),
  description: text('description'),
  karat: text('karat'),
  weight_grams: numeric('weight_grams', { precision: 10, scale: 3 }),
  price_per_gram: numeric('price_per_gram', { precision: 15, scale: 2 }),
  total_value: numeric('total_value', { precision: 15, scale: 2 }),
  branch_id: uuid('branch_id'),
  customer_id: uuid('customer_id'),
  supplier_id: uuid('supplier_id'),
  status: text('status').default('available'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
});

export const fiscalYears = pgTable('fiscal_years', {
  id: uuid('id').primaryKey().defaultRandom(),
  year_name: text('year_name').notNull(),
  start_date: timestamp('start_date', { withTimezone: true }).notNull(),
  end_date: timestamp('end_date', { withTimezone: true }).notNull(),
  is_closed: boolean('is_closed').default(false),
  is_current: boolean('is_current').default(false),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const importRowErrors = pgTable('import_row_errors', {
  id: uuid('id').primaryKey().defaultRandom(),
  batch_id: uuid('batch_id'),
  row_number: integer('row_number'),
  field_name: text('field_name'),
  error_message: text('error_message'),
  raw_value: text('raw_value'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const inventoryCounts = pgTable('inventory_counts', {
  id: uuid('id').primaryKey().defaultRandom(),
  count_number: text('count_number').unique(),
  branch_id: uuid('branch_id'),
  status: text('status').default('in_progress'),
  started_at: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
});

export const inventoryCountReadings = pgTable('inventory_count_readings', {
  id: uuid('id').primaryKey().defaultRandom(),
  count_id: uuid('count_id').notNull(),
  item_id: uuid('item_id'),
  barcode_scanned: text('barcode_scanned'),
  found: boolean('found').default(false),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const inventoryCountResults = pgTable('inventory_count_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  count_id: uuid('count_id').notNull(),
  total_expected: integer('total_expected').default(0),
  total_found: integer('total_found').default(0),
  total_missing: integer('total_missing').default(0),
  total_extra: integer('total_extra').default(0),
  details: jsonb('details').default({}),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  entity_type: text('entity_type').notNull(),
  entity_id: uuid('entity_id'),
  entity_code: text('entity_code'),
  action_type: text('action_type').notNull(),
  description: text('description'),
  old_value: jsonb('old_value'),
  new_value: jsonb('new_value'),
  metadata: jsonb('metadata'),
  user_id: uuid('user_id'),
  user_name: text('user_name'),
  user_role: text('user_role'),
  branch_id: uuid('branch_id'),
  branch_name: text('branch_name'),
  ip_address: text('ip_address'),
  channel: text('channel'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const atomicWorkflowRequests = pgTable('atomic_workflow_requests', {
  client_request_id: text('client_request_id').primaryKey(),
  workflow_type: text('workflow_type').notNull(),
  status: text('status').default('pending'),
  request_payload: jsonb('request_payload'),
  result_payload: jsonb('result_payload'),
  payload_hash: text('payload_hash'),
  error_code: text('error_code'),
  error_message: text('error_message'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
  completed_at: timestamp('completed_at', { withTimezone: true }),
});

export const labelPrintJobs = pgTable('label_print_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  job_type: labelJobTypeEnum('job_type').notNull(),
  status: labelJobStatusEnum('status').default('CREATED'),
  batch_id: uuid('batch_id'),
  printer_name: text('printer_name'),
  copies: integer('copies').default(1),
  label_data: jsonb('label_data'),
  error_message: text('error_message'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  created_by: uuid('created_by'),
  completed_at: timestamp('completed_at', { withTimezone: true }),
});

export const branchAccountingConfig = pgTable('branch_accounting_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  branch_id: uuid('branch_id'),
  config_key: text('config_key').notNull(),
  account_id: uuid('account_id'),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const accountingConfigKeys = pgTable('accounting_config_keys', {
  key: text('key').primaryKey(),
  description: text('description'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const accountingHealthCheckRuns = pgTable('accounting_health_check_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  run_number: text('run_number').notNull(),
  status: text('status').default('running'),
  mode: text('mode'),
  total_checks: integer('total_checks').default(0),
  passed_checks: integer('passed_checks').default(0),
  warning_checks: integer('warning_checks').default(0),
  critical_checks: integer('critical_checks').default(0),
  health_score: numeric('health_score', { precision: 5, scale: 2 }),
  summary: jsonb('summary'),
  started_at: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  started_by: uuid('started_by'),
  started_by_name: text('started_by_name'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const accountingHealthCheckResults = pgTable('accounting_health_check_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  run_id: text('run_id').notNull(),
  issue_code: text('issue_code').notNull(),
  category: text('category').notNull(),
  severity: text('severity').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  details: jsonb('details'),
  affected_records: integer('affected_records'),
  affected_amount: numeric('affected_amount', { precision: 15, scale: 2 }),
  can_auto_fix: boolean('can_auto_fix').default(false),
  auto_fix_function: text('auto_fix_function'),
  fix_status: text('fix_status'),
  fix_notes: text('fix_notes'),
  fixed_at: timestamp('fixed_at', { withTimezone: true }),
  fixed_by: text('fixed_by'),
  run_date: timestamp('run_date', { withTimezone: true }).defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  related_module: text('related_module').notNull(),
  related_record_id: text('related_record_id').notNull(),
  attachment_type: text('attachment_type').notNull(),
  file_name: text('file_name').notNull(),
  file_size: integer('file_size'),
  mime_type: text('mime_type'),
  storage_bucket: text('storage_bucket'),
  storage_path: text('storage_path'),
  google_file_id: text('google_file_id'),
  uploaded_at: timestamp('uploaded_at', { withTimezone: true }).defaultNow(),
  uploaded_by_user_id: uuid('uploaded_by_user_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type Branch = typeof branches.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type ChartOfAccount = typeof chartOfAccounts.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type JournalEntryLine = typeof journalEntryLines.$inferSelect;
export type PurchaseBatch = typeof purchaseBatches.$inferSelect;
export type JewelrySet = typeof jewelrySets.$inferSelect;
export type JewelryItem = typeof jewelryItems.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type PurchaseInvoiceLine = typeof purchaseInvoiceLines.$inferSelect;
export type ItemMovement = typeof itemMovements.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type SaleItem = typeof saleItems.$inferSelect;
export type Return = typeof returns.$inferSelect;
export type ReturnItem = typeof returnItems.$inferSelect;
export type Transfer = typeof transfers.$inferSelect;
export type TransferItem = typeof transferItems.$inferSelect;
export type TransferRequest = typeof transferRequests.$inferSelect;
export type TransferRequestItem = typeof transferRequestItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type CustomRole = typeof customRoles.$inferSelect;
export type UserRole = typeof userRoles.$inferSelect;
export type UserCustomRole = typeof userCustomRoles.$inferSelect;
export type UserBranch = typeof userBranches.$inferSelect;
export type Screen = typeof screens.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type GoldKarat = typeof goldKarats.$inferSelect;
export type GoldPrice = typeof goldPrices.$inferSelect;
export type GoldScrap = typeof goldScrap.$inferSelect;
export type FiscalYear = typeof fiscalYears.$inferSelect;
export type ImportRowError = typeof importRowErrors.$inferSelect;
export type InventoryCount = typeof inventoryCounts.$inferSelect;
export type InventoryCountReading = typeof inventoryCountReadings.$inferSelect;
export type InventoryCountResult = typeof inventoryCountResults.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type AtomicWorkflowRequest = typeof atomicWorkflowRequests.$inferSelect;
export type LabelPrintJob = typeof labelPrintJobs.$inferSelect;
export type BranchAccountingConfig = typeof branchAccountingConfig.$inferSelect;
export type AccountingConfigKey = typeof accountingConfigKeys.$inferSelect;
export type AccountingHealthCheckRun = typeof accountingHealthCheckRuns.$inferSelect;
export type AccountingHealthCheckResult = typeof accountingHealthCheckResults.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type Product = typeof products.$inferSelect;
export type CostCenter = typeof costCenters.$inferSelect;
export type CostEntry = typeof costEntries.$inferSelect;
