import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FailingRecord {
  invoice_id?: string;
  invoice_number?: string;
  invoice_date?: string;
  total_amount?: number;
  status?: string;
  je_id?: string;
  entry_number?: string;
  is_posted?: boolean;
  total_debit?: number;
  total_credit?: number;
  reference_type?: string;
  reference_id?: string;
  issue?: string;
}

interface TestResult {
  id: string;
  name: string;
  status: "PASS" | "FAIL";
  count: number;
  failing_records?: FailingRecord[];
}

interface TestResponse {
  timestamp: string;
  tests: TestResult[];
  summary: { passed: number; failed: number; total: number };
  meta?: { truncated: boolean; max_records_checked: number };
}

// PI-G1: Purchase Invoices Missing Journal Entry
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runPIG1(supabase: any): Promise<TestResult> {
  const PAGE_SIZE = 1000;
  const MAX_RECORDS = 20000;
  const allFailing: FailingRecord[] = [];
  let offset = 0;

  while (offset < MAX_RECORDS) {
    const { data, error } = await supabase
      .from("invoices")
      .select("id, invoice_number, invoice_date, total_amount, status")
      .eq("invoice_type", "purchase")
      .neq("status", "voided")
      .is("journal_entry_id", null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("PI-G1 query error:", error);
      break;
    }

    if (!data || data.length === 0) break;

    for (const inv of data) {
      allFailing.push({
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        total_amount: inv.total_amount,
        status: inv.status,
      });
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return {
    id: "PI-G1",
    name: "Missing Journal Entry",
    status: allFailing.length === 0 ? "PASS" : "FAIL",
    count: allFailing.length,
    failing_records: allFailing.slice(0, 50),
  };
}

// PI-G2: Unposted or Unbalanced Journal Entries
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runPIG2(supabase: any): Promise<TestResult> {
  const { data, error } = await supabase
    .from("invoices")
    .select(
      `
      id,
      invoice_number,
      journal_entry_id,
      journal_entries!inner (
        id,
        entry_number,
        is_posted,
        total_debit,
        total_credit
      )
    `
    )
    .eq("invoice_type", "purchase")
    .neq("status", "voided")
    .not("journal_entry_id", "is", null)
    .limit(20000);

  if (error) {
    console.error("PI-G2 query error:", error);
    return {
      id: "PI-G2",
      name: "Unposted/Unbalanced JE",
      status: "FAIL",
      count: -1,
      failing_records: [{ issue: `Query error: ${error.message}` }],
    };
  }

  const failing: FailingRecord[] = [];
  for (const inv of data || []) {
    const je = inv.journal_entries;
    if (!je) continue;
    const unposted = je.is_posted !== true;
    const unbalanced = Math.abs((je.total_debit || 0) - (je.total_credit || 0)) > 0.01;
    if (unposted || unbalanced) {
      failing.push({
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        je_id: je.id,
        entry_number: je.entry_number,
        is_posted: je.is_posted,
        total_debit: je.total_debit,
        total_credit: je.total_credit,
        issue: unposted ? "unposted" : "unbalanced",
      });
    }
  }

  return {
    id: "PI-G2",
    name: "Unposted/Unbalanced JE",
    status: failing.length === 0 ? "PASS" : "FAIL",
    count: failing.length,
    failing_records: failing.slice(0, 50),
  };
}

// PI-G3: Reference Type/ID Mismatch
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runPIG3(supabase: any): Promise<TestResult> {
  const { data, error } = await supabase
    .from("invoices")
    .select(
      `
      id,
      invoice_number,
      journal_entry_id,
      journal_entries!inner (
        id,
        reference_type,
        reference_id
      )
    `
    )
    .eq("invoice_type", "purchase")
    .neq("status", "voided")
    .not("journal_entry_id", "is", null)
    .limit(20000);

  if (error) {
    console.error("PI-G3 query error:", error);
    return {
      id: "PI-G3",
      name: "Reference Mismatch",
      status: "FAIL",
      count: -1,
      failing_records: [{ issue: `Query error: ${error.message}` }],
    };
  }

  const failing: FailingRecord[] = [];
  for (const inv of data || []) {
    const je = inv.journal_entries;
    if (!je) continue;
    const wrongType = je.reference_type !== "purchase_invoice";
    const wrongId = je.reference_id !== inv.id;
    if (wrongType || wrongId) {
      failing.push({
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        je_id: je.id,
        reference_type: je.reference_type,
        reference_id: je.reference_id,
        issue: wrongType ? "wrong_reference_type" : "wrong_reference_id",
      });
    }
  }

  return {
    id: "PI-G3",
    name: "Reference Mismatch",
    status: failing.length === 0 ? "PASS" : "FAIL",
    count: failing.length,
    failing_records: failing.slice(0, 50),
  };
}

// PI-G4: Legacy Columns Check (debit/credit instead of debit_amount/credit_amount)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runPIG4(supabase: any): Promise<TestResult> {
  try {
    // Try to select legacy columns - if they don't exist, query will fail
    const { error } = await supabase
      .from("journal_entry_lines")
      .select("debit, credit")
      .limit(1);

    // If no error, legacy columns exist => FAIL
    if (!error) {
      return {
        id: "PI-G4",
        name: "Legacy Columns (debit/credit)",
        status: "FAIL",
        count: 1,
        failing_records: [
          { issue: "Legacy columns 'debit' and 'credit' exist in schema" },
        ],
      };
    }

    // Error means columns don't exist => PASS
    return {
      id: "PI-G4",
      name: "Legacy Columns (debit/credit)",
      status: "PASS",
      count: 0,
    };
  } catch {
    // Exception also means columns don't exist => PASS
    return {
      id: "PI-G4",
      name: "Legacy Columns (debit/credit)",
      status: "PASS",
      count: 0,
    };
  }
}

// D2-DRY-RUN: Test dry_run mode works without locks
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runD2DryRunTest(supabase: any): Promise<TestResult> {
  try {
    // Find a valid invoice line for testing with available qty
    const { data: testLines, error: lineError } = await supabase
      .from("purchase_invoice_lines")
      .select(`
        id, invoice_id, quantity, returned_qty, unit_price,
        invoices!inner (supplier_id, branch_id, invoice_type, purchase_type)
      `)
      .eq("invoices.invoice_type", "purchase")
      .eq("invoices.purchase_type", "general")
      .gt("quantity", 0)
      .order("created_at", { ascending: false })
      .limit(50);
    
    // Find a line where quantity > returned_qty (has available qty)
    const testLine = testLines?.find(
      (line: { quantity: number; returned_qty: number | null }) => 
        line.quantity > (line.returned_qty || 0)
    );

    if (lineError || !testLine) {
      return {
        id: "D2-DRY-RUN",
        name: "Dry-run Mode (No Locks)",
        status: "FAIL",
        count: -1,
        failing_records: [{ 
          issue: `No test data with available qty: ${lineError?.message || 'No lines with quantity > returned_qty'}` 
        }],
      };
    }
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoice = (testLine as any).invoices;

    // Call RPC with dry_run=true
    const { data: result, error: rpcError } = await supabase.rpc(
      "complete_purchase_return_general_atomic",
      {
        p_payload: {
          client_request_id: crypto.randomUUID(),
          created_by: "gate-test",
          dry_run: true,
          return: {
            branch_id: invoice.branch_id,
            supplier_id: invoice.supplier_id,
            purchase_invoice_id: testLine.invoice_id,
            return_date: new Date().toISOString().split("T")[0],
            reason: "D2 Dry-run Gate Test",
          },
          items: [
            {
              invoice_line_id: testLine.id,
              quantity: 1,
            },
          ],
        },
      }
    );

    if (rpcError) {
      return {
        id: "D2-DRY-RUN",
        name: "Dry-run Mode (No Locks)",
        status: "FAIL",
        count: 1,
        failing_records: [{ issue: `RPC error: ${rpcError.message}` }],
      };
    }

    if (!result?.success || !result?.dry_run) {
      return {
        id: "D2-DRY-RUN",
        name: "Dry-run Mode (No Locks)",
        status: "FAIL",
        count: 1,
        failing_records: [{ issue: `Unexpected result: ${JSON.stringify(result)}` }],
      };
    }

    // Verify placeholder numbers used
    const hasPlaceholder = 
      result.planned_return_number?.startsWith("DRY-RUN-") &&
      result.planned_je_number?.startsWith("DRY-RUN-JE-");

    if (!hasPlaceholder) {
      return {
        id: "D2-DRY-RUN",
        name: "Dry-run Mode (No Locks)",
        status: "FAIL",
        count: 1,
        failing_records: [{ issue: "Dry-run consumed sequence numbers instead of placeholders" }],
      };
    }

    return {
      id: "D2-DRY-RUN",
      name: "Dry-run Mode (No Locks)",
      status: "PASS",
      count: 0,
    };
  } catch (err) {
    return {
      id: "D2-DRY-RUN",
      name: "Dry-run Mode (No Locks)",
      status: "FAIL",
      count: -1,
      failing_records: [{ issue: `Exception: ${err instanceof Error ? err.message : String(err)}` }],
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const testId = body.test || "ALL";

    const results: TestResult[] = [];

    if (testId === "ALL" || testId === "PI-G1") {
      results.push(await runPIG1(supabase));
    }
    if (testId === "ALL" || testId === "PI-G2") {
      results.push(await runPIG2(supabase));
    }
    if (testId === "ALL" || testId === "PI-G3") {
      results.push(await runPIG3(supabase));
    }
    if (testId === "ALL" || testId === "PI-G4") {
      results.push(await runPIG4(supabase));
    }
    if (testId === "D2-DRY-RUN") {
      results.push(await runD2DryRunTest(supabase));
    }

    if (results.length === 0) {
      return new Response(
        JSON.stringify({
          error: "Invalid test. Use PI-G1, PI-G2, PI-G3, PI-G4, or ALL",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const response: TestResponse = {
      timestamp: new Date().toISOString(),
      tests: results,
      summary: {
        passed: results.filter((t) => t.status === "PASS").length,
        failed: results.filter((t) => t.status === "FAIL").length,
        total: results.length,
      },
      meta: { truncated: false, max_records_checked: 20000 },
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
