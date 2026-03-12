import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { test } = await req.json();
    
    // Test data from user's specifications
    const testData = {
      supplier_id: "4781cebc-c067-4bd8-91c8-ea6a8749b468",
      branch_id: "0dfd6b76-2c40-451b-9a08-de3d073f1452",
      invoice_id: "6b8d752d-7d7d-4424-8874-9c042f7e7f60",
      performed_by: "62137817-7fe3-4f09-98c0-7e91cb8a4a14",
    };

    if (test === "G2") {
      // G2: Create payment with allocation
      const clientRequestId = crypto.randomUUID();
      
      const { data, error } = await supabase.rpc("payment_voucher_atomic", {
        p_payload: {
          client_request_id: clientRequestId,
          allow_unallocated: false,
          payment: {
            payment_type: "payment",
            payment_date: new Date().toISOString().split("T")[0],
            amount: 200,
            payment_method: "cash",
            supplier_id: testData.supplier_id,
            branch_id: testData.branch_id,
            notes: "PV3 G2: create with allocation",
            performed_by: testData.performed_by,
          },
          allocations: [
            {
              invoice_id: testData.invoice_id,
              amount: 200,
            },
          ],
        },
      });

      return new Response(
        JSON.stringify({
          test: "G2",
          client_request_id: clientRequestId,
          result: data,
          error: error?.message,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (test === "G3") {
      // G3: Idempotency test - call twice with same client_request_id
      const clientRequestId = crypto.randomUUID();
      
      const payload = {
        client_request_id: clientRequestId,
        allow_unallocated: false,
        payment: {
          payment_type: "payment",
          payment_date: new Date().toISOString().split("T")[0],
          amount: 150,
          payment_method: "cash",
          supplier_id: testData.supplier_id,
          branch_id: testData.branch_id,
          notes: "PV3 G3: idempotency test",
          performed_by: testData.performed_by,
        },
        allocations: [
          {
            invoice_id: testData.invoice_id,
            amount: 150,
          },
        ],
      };

      // First call
      const { data: result1, error: error1 } = await supabase.rpc("payment_voucher_atomic", {
        p_payload: payload,
      });

      // Second call with SAME client_request_id
      const { data: result2, error: error2 } = await supabase.rpc("payment_voucher_atomic", {
        p_payload: payload,
      });

      // Check idempotency
      const idempotent = result1?.payment_id === result2?.payment_id;

      return new Response(
        JSON.stringify({
          test: "G3",
          client_request_id: clientRequestId,
          call1: { result: result1, error: error1?.message },
          call2: { result: result2, error: error2?.message },
          idempotent,
          pass: idempotent && result1?.success && result2?.success,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (test === "G5") {
      // G5: Verify accounting integrity
      const clientRequestId = crypto.randomUUID();
      
      const { data: createResult, error: createError } = await supabase.rpc("payment_voucher_atomic", {
        p_payload: {
          client_request_id: clientRequestId,
          allow_unallocated: false,
          payment: {
            payment_type: "payment",
            payment_date: new Date().toISOString().split("T")[0],
            amount: 100,
            payment_method: "bank_transfer",
            supplier_id: testData.supplier_id,
            branch_id: testData.branch_id,
            notes: "PV3 G5: accounting verification",
            performed_by: testData.performed_by,
          },
          allocations: [
            {
              invoice_id: testData.invoice_id,
              amount: 100,
            },
          ],
        },
      });

      if (!createResult?.success) {
        return new Response(
          JSON.stringify({
            test: "G5",
            pass: false,
            error: createError?.message || createResult?.error,
            createResult,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify journal entry
      const { data: jeData } = await supabase
        .from("journal_entries")
        .select("id, reference_type, is_posted, total_debit, total_credit")
        .eq("id", createResult.journal_entry_id)
        .single();

      // Verify journal entry lines balance
      const { data: jelData } = await supabase
        .from("journal_entry_lines")
        .select("debit_amount, credit_amount")
        .eq("journal_entry_id", createResult.journal_entry_id);

      const totalDebit = jelData?.reduce((sum, l) => sum + (l.debit_amount || 0), 0) || 0;
      const totalCredit = jelData?.reduce((sum, l) => sum + (l.credit_amount || 0), 0) || 0;

      // Verify payment record
      const { data: paymentData } = await supabase
        .from("payments")
        .select("id, amount, journal_entry_id")
        .eq("id", createResult.payment_id)
        .single();

      // Verify allocations
      const { data: allocData } = await supabase
        .from("supplier_payment_allocations")
        .select("id, amount, invoice_id")
        .eq("payment_id", createResult.payment_id);

      const checks = {
        je_exists: !!jeData,
        je_reference_type: jeData?.reference_type === "payment_voucher",
        je_is_posted: jeData?.is_posted === true,
        je_balanced: Math.abs(totalDebit - totalCredit) < 0.01,
        je_totals_match: jeData?.total_debit === jeData?.total_credit,
        payment_exists: !!paymentData,
        payment_linked_to_je: paymentData?.journal_entry_id === createResult.journal_entry_id,
        allocations_created: (allocData?.length || 0) > 0,
      };

      const allPassed = Object.values(checks).every(Boolean);

      return new Response(
        JSON.stringify({
          test: "G5",
          client_request_id: clientRequestId,
          payment_id: createResult.payment_id,
          journal_entry_id: createResult.journal_entry_id,
          checks,
          pass: allPassed,
          details: {
            journalEntry: jeData,
            linesBalance: { totalDebit, totalCredit },
            payment: paymentData,
            allocations: allocData,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid test. Use G2, G3, or G5" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
