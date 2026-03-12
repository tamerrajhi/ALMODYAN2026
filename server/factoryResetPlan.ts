import { Pool } from "pg";

export const truncateTables: string[] = [
  "purchase_correction_artifacts",
  "purchase_correction_actions",
  "purchase_correction_groups",
  "unique_purchase_return_items",
  "unique_purchase_invoice_items",
  "unique_item_movements",
  "transfer_items",
  "transfer_request_items",
  "return_items",
  "sale_items",
  "sales_invoice_items",
  "purchase_return_items",
  "purchase_return_lines",
  "purchase_invoice_lines",
  "purchase_order_items",
  "purchase_order_receipts",
  "purchase_requisition_lines",
  "purchase_requisition_items",
  "supplier_payment_allocations",
  "import_row_errors",
  "label_print_jobs",
  "credit_notes",
  "journal_entry_lines",
  "inventory_count_readings",
  "inventory_count_results",
  "item_movements",
  "cost_entries",
  "accounting_audit_logs",
  "accounting_health_check_results",
  "unique_purchase_returns",
  "unique_items",
  "unique_purchase_invoices",
  "unique_purchase_batches",
  "purchase_returns",
  "returns",
  "sales",
  "invoices",
  "payments",
  "journal_entries",
  "transfers",
  "transfer_requests",
  "purchase_batches",
  "purchase_orders",
  "purchase_requisitions",
  "inventory_counts",
  "jewelry_items",
  "jewelry_sets",
  "gold_scrap",
  "finished_goods_showroom",
  "pos_workflow_requests",
  "atomic_workflow_requests",
  "backup_logs",
  "accounting_health_check_runs",
  "attachments",
  "gold_prices",
  "fiscal_years",
  "products",
  "serial_counters",
];

export const keepTables: string[] = [
  "profiles",
  "auth_sessions",
  "user_branches",
  "user_custom_roles",
  "custom_roles",
  "role_permissions",
  "role_modules",
  "modules",
  "screens",
  "branches",
  "suppliers",
  "customers",
  "chart_of_accounts",
  "branch_coa_accounts",
  "coa_account_templates",
  "branch_accounting_config",
  "branch_inventory_accounts",
  "payment_account_settings",
  "production_account_settings",
  "accounting_config_keys",
  "app_settings",
  "gold_karats",
  "cash_vaults",
  "gold_vaults",
  "cost_centers",
  "departments",
  "employees",
  "pr_approval_thresholds",
  "workflow_types",
];

export async function discoverResetSequences(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query(`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S'
      AND n.nspname = 'public'
      AND c.relname LIKE '%\\_doc\\_seq' ESCAPE '\\'
    ORDER BY c.relname
  `);
  return rows.map((r: any) => r.relname);
}

export function buildFactoryResetSQL(seqs: string[]): string {
  const lines: string[] = [];

  lines.push("BEGIN;");
  lines.push("");

  const tablesWithoutSerial = truncateTables.filter(t => t !== "serial_counters");
  lines.push(`TRUNCATE TABLE ${tablesWithoutSerial.map(t => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE;`);
  lines.push("");

  lines.push(`TRUNCATE TABLE "serial_counters";`);
  lines.push(`INSERT INTO serial_counters (prefix, next_seq) VALUES`);
  lines.push(`  ('FSETN', 1),`);
  lines.push(`  ('FSETE', 1),`);
  lines.push(`  ('FSETR', 1),`);
  lines.push(`  ('FSETB', 1);`);
  lines.push("");

  for (const seq of seqs) {
    lines.push(`ALTER SEQUENCE public."${seq}" RESTART WITH 1;`);
  }
  lines.push("");

  lines.push("COMMIT;");

  return lines.join("\n");
}
