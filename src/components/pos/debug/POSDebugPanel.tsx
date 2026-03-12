/**
 * POS Debug Panel (Admin-only + ?posDebug=1)
 * 
 * Provides runtime proof of idempotency and payload mismatch handling.
 * 
 * Tests:
 * - B1: Replay SAME request → idempotent=true, same IDs
 * - C1: Replay MISMATCH request → CONFLICT_PAYLOAD_MISMATCH error
 * - (Optional) Double-submit → one succeeds, one CONFLICT_IN_PROGRESS
 */

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  Bug, 
  Play, 
  RefreshCcw, 
  AlertTriangle, 
  Copy, 
  Check, 
  Loader2,
  Zap,
  ShieldAlert
} from 'lucide-react';
import * as dataGateway from '@/lib/dataGateway';
import { 
  logPosAttemptStart, 
  logPosAttemptFail 
} from '@/lib/posRequestLogger';
import { toast } from 'sonner';
type Json = Record<string, any> | string | number | boolean | null;

// Test result type
interface TestResult {
  mode: 'SAME' | 'MISMATCH' | 'DOUBLE';
  timestamp: Date;
  clientRequestId: string;
  success: boolean;
  idempotent?: boolean;
  saleId?: string;
  journalEntryId?: string;
  invoiceId?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: unknown;
}

// Last successful payload capture type
export interface CapturedSalePayload {
  clientRequestId: string;
  payload: Json;
  saleId?: string;
  invoiceId?: string;
  journalEntryId?: string;
  timestamp: Date;
}

interface POSDebugPanelProps {
  lastCapturedPayload: CapturedSalePayload | null;
}

export default function POSDebugPanel({ lastCapturedPayload }: POSDebugPanelProps) {
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [copiedSql, setCopiedSql] = useState<string | null>(null);

  // Add a test result to the list
  const addTestResult = useCallback((result: TestResult) => {
    setTestResults(prev => [result, ...prev].slice(0, 10)); // Keep last 10
  }, []);

  // B1: Replay SAME request (idempotent success expected)
  const runSameReplayTest = async () => {
    if (!lastCapturedPayload) {
      toast.error('لا يوجد طلب سابق للإعادة - قم بإتمام بيع أولاً');
      return;
    }

    setIsRunning(true);
    const startTime = Date.now();

    try {
      // Log attempt with debug workflow type
      await logPosAttemptStart({
        clientRequestId: lastCapturedPayload.clientRequestId,
        workflowType: 'pos_sale',
        payload: lastCapturedPayload.payload,
      });

      // Execute RPC with exact same payload
      const { data: rpcResult, error: rpcError } = await dataGateway.rpc('complete_pos_sale_atomic', {
        p_payload: lastCapturedPayload.payload
      });

      const result = rpcResult as Record<string, unknown> | null;

      if (rpcError) {
        await logPosAttemptFail({
          clientRequestId: lastCapturedPayload.clientRequestId,
          errorCode: 'RPC_ERROR',
          errorMessage: rpcError.message,
        });

        addTestResult({
          mode: 'SAME',
          timestamp: new Date(),
          clientRequestId: lastCapturedPayload.clientRequestId,
          success: false,
          errorCode: 'RPC_ERROR',
          errorMessage: rpcError.message,
          rawResponse: rpcError,
        });
      } else if (result?.success) {
        addTestResult({
          mode: 'SAME',
          timestamp: new Date(),
          clientRequestId: lastCapturedPayload.clientRequestId,
          success: true,
          idempotent: Boolean(result.idempotent),
          saleId: result.sale_id as string | undefined,
          journalEntryId: result.journal_entry_id as string | undefined,
          invoiceId: result.invoice_id as string | undefined,
          rawResponse: result,
        });

        if (result.idempotent) {
          toast.success('✅ B1 PASS: Idempotent replay confirmed');
        } else {
          toast.warning('⚠️ B1: Success but not marked idempotent');
        }
      } else {
        addTestResult({
          mode: 'SAME',
          timestamp: new Date(),
          clientRequestId: lastCapturedPayload.clientRequestId,
          success: false,
          errorCode: result?.error_code as string | undefined,
          errorMessage: result?.error as string | undefined,
          rawResponse: result,
        });
      }
    } catch (err) {
      console.error('[Debug] SAME replay error:', err);
      addTestResult({
        mode: 'SAME',
        timestamp: new Date(),
        clientRequestId: lastCapturedPayload.clientRequestId,
        success: false,
        errorCode: 'EXCEPTION',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsRunning(false);
      console.log(`[Debug] SAME replay completed in ${Date.now() - startTime}ms`);
    }
  };

  // C1: Replay MISMATCH request (CONFLICT_PAYLOAD_MISMATCH expected)
  const runMismatchTest = async () => {
    if (!lastCapturedPayload) {
      toast.error('لا يوجد طلب سابق للإعادة - قم بإتمام بيع أولاً');
      return;
    }

    setIsRunning(true);
    const startTime = Date.now();

    try {
      // Clone payload and modify one value - ensure proper typing
      const originalPayload = lastCapturedPayload.payload;
      const modifiedPayload = JSON.parse(JSON.stringify(originalPayload)) as Record<string, Json>;
      
      // Modify items[0].unit_price by +0.01 if items exist
      const items = modifiedPayload.items as Array<Record<string, Json>> | undefined;
      if (items && items.length > 0) {
        const unitPrice = items[0].unit_price;
        items[0].unit_price = (typeof unitPrice === 'number' ? unitPrice : 0) + 0.01;
      }
      // Also adjust cash_amount to match
      const cashAmount = modifiedPayload.cash_amount;
      if (typeof cashAmount === 'number') {
        modifiedPayload.cash_amount = cashAmount + 0.01;
      }

      // Log attempt
      await logPosAttemptStart({
        clientRequestId: lastCapturedPayload.clientRequestId,
        workflowType: 'pos_sale',
        payload: modifiedPayload as Json,
      });

      // Execute RPC with modified payload but same client_request_id
      const { data: rpcResult, error: rpcError } = await dataGateway.rpc('complete_pos_sale_atomic', {
        p_payload: modifiedPayload as Json
      });

      const result = rpcResult as Record<string, unknown> | null;

      if (rpcError) {
        const isConflict = rpcError.message?.includes('CONFLICT_PAYLOAD_MISMATCH') ||
                          rpcError.message?.includes('payload mismatch');

        await logPosAttemptFail({
          clientRequestId: lastCapturedPayload.clientRequestId,
          errorCode: isConflict ? 'CONFLICT_PAYLOAD_MISMATCH' : 'RPC_ERROR',
          errorMessage: rpcError.message,
        });

        addTestResult({
          mode: 'MISMATCH',
          timestamp: new Date(),
          clientRequestId: lastCapturedPayload.clientRequestId,
          success: false,
          errorCode: isConflict ? 'CONFLICT_PAYLOAD_MISMATCH' : 'RPC_ERROR',
          errorMessage: rpcError.message,
          rawResponse: rpcError,
        });

        if (isConflict) {
          toast.success('✅ C1 PASS: Payload mismatch correctly rejected');
        }
      } else if (result?.success === false) {
        const errorCode = result.error_code as string | undefined;
        const errorMsg = result.error as string | undefined;
        const isConflict = errorCode?.includes('CONFLICT_PAYLOAD_MISMATCH') ||
                          errorMsg?.includes('payload mismatch');

        addTestResult({
          mode: 'MISMATCH',
          timestamp: new Date(),
          clientRequestId: lastCapturedPayload.clientRequestId,
          success: false,
          errorCode: errorCode,
          errorMessage: errorMsg,
          rawResponse: result,
        });

        if (isConflict) {
          toast.success('✅ C1 PASS: Payload mismatch correctly rejected');
        } else {
          toast.warning('⚠️ C1: Failed but not with expected conflict error');
        }
      } else {
        // Unexpected success - this is a FAIL for C1
        addTestResult({
          mode: 'MISMATCH',
          timestamp: new Date(),
          clientRequestId: lastCapturedPayload.clientRequestId,
          success: true,
          errorCode: 'UNEXPECTED_SUCCESS',
          errorMessage: 'Mismatch test should have failed but succeeded',
          rawResponse: result,
        });
        toast.error('❌ C1 FAIL: Mismatch request should have been rejected');
      }
    } catch (err) {
      console.error('[Debug] MISMATCH test error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const isConflict = errorMsg.includes('CONFLICT_PAYLOAD_MISMATCH') || 
                        errorMsg.includes('payload mismatch');

      addTestResult({
        mode: 'MISMATCH',
        timestamp: new Date(),
        clientRequestId: lastCapturedPayload.clientRequestId,
        success: false,
        errorCode: isConflict ? 'CONFLICT_PAYLOAD_MISMATCH' : 'EXCEPTION',
        errorMessage: errorMsg,
      });

      if (isConflict) {
        toast.success('✅ C1 PASS: Payload mismatch correctly rejected');
      }
    } finally {
      setIsRunning(false);
      console.log(`[Debug] MISMATCH test completed in ${Date.now() - startTime}ms`);
    }
  };

  // Optional: Double-submit test
  const runDoubleSubmitTest = async () => {
    if (!lastCapturedPayload) {
      toast.error('لا يوجد طلب سابق للإعادة - قم بإتمام بيع أولاً');
      return;
    }

    setIsRunning(true);
    const startTime = Date.now();

    try {
      // Execute same request twice in parallel
      const [result1, result2] = await Promise.all([
        dataGateway.rpc('complete_pos_sale_atomic', { p_payload: lastCapturedPayload.payload }),
        dataGateway.rpc('complete_pos_sale_atomic', { p_payload: lastCapturedPayload.payload }),
      ]);

      const res1 = result1.data as Record<string, unknown> | null;
      const res2 = result2.data as Record<string, unknown> | null;

      // Log both results
      console.log('[Debug] Double submit results:', { result1, result2 });

      // Check if one succeeded/idempotent and one got conflict
      const r1Success = Boolean(res1?.success) || Boolean(res1?.idempotent);
      const r2Success = Boolean(res2?.success) || Boolean(res2?.idempotent);
      const r1Conflict = result1.error?.message?.includes('CONFLICT') || 
                        (res1?.error_code as string)?.includes('CONFLICT');
      const r2Conflict = result2.error?.message?.includes('CONFLICT') || 
                        (res2?.error_code as string)?.includes('CONFLICT');

      addTestResult({
        mode: 'DOUBLE',
        timestamp: new Date(),
        clientRequestId: lastCapturedPayload.clientRequestId,
        success: (r1Success || r2Success) && (r1Conflict || r2Conflict || Boolean(res1?.idempotent) || Boolean(res2?.idempotent)),
        idempotent: Boolean(res1?.idempotent || res2?.idempotent),
        saleId: (res1?.sale_id || res2?.sale_id) as string | undefined,
        errorCode: r1Conflict ? 'CONFLICT_DETECTED_R1' : (r2Conflict ? 'CONFLICT_DETECTED_R2' : undefined),
        errorMessage: `R1: ${res1?.success ? 'success' : res1?.error_code || result1.error?.message || 'unknown'}, R2: ${res2?.success ? 'success' : res2?.error_code || result2.error?.message || 'unknown'}`,
        rawResponse: { result1: res1 || result1.error, result2: res2 || result2.error },
      });

      toast.info('Double submit test completed - check results');
    } catch (err) {
      console.error('[Debug] DOUBLE submit error:', err);
      addTestResult({
        mode: 'DOUBLE',
        timestamp: new Date(),
        clientRequestId: lastCapturedPayload.clientRequestId,
        success: false,
        errorCode: 'EXCEPTION',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsRunning(false);
      console.log(`[Debug] DOUBLE submit completed in ${Date.now() - startTime}ms`);
    }
  };

  // Copy SQL to clipboard
  const copySql = (sqlType: string, sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedSql(sqlType);
    setTimeout(() => setCopiedSql(null), 2000);
    toast.success('تم نسخ الاستعلام');
  };

  // Generate SQL queries based on captured data
  const generateSqlQueries = () => {
    if (!lastCapturedPayload) return null;

    const saleId = lastCapturedPayload.saleId || '<SALE_ID>';
    const requestId = lastCapturedPayload.clientRequestId;

    return {
      salesCount: `SELECT COUNT(*) FROM public.sales WHERE id = '${saleId}';`,
      movementsCount: `SELECT COUNT(*) AS sale_movements_count, COUNT(DISTINCT item_id) AS distinct_items
FROM public.item_movements
WHERE movement_type='SALE' AND reference_type='sale' AND reference_id='${saleId}';`,
      workflowStatus: `SELECT client_request_id, status, payload_hash, sale_id, invoice_id, journal_entry_id, created_at, completed_at
FROM public.pos_sale_requests
WHERE client_request_id='${requestId}';`,
    };
  };

  const sqlQueries = generateSqlQueries();

  return (
    <Card className="border-amber-500/50 bg-amber-50/30 dark:bg-amber-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <Bug className="w-5 h-5" />
          POS Debug Panel
          <Badge variant="outline" className="ml-auto text-xs">Admin-only</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Captured Payload Status */}
        <div className="p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-2 text-sm font-medium mb-2">
            <ShieldAlert className="w-4 h-4" />
            آخر طلب ملتقط
          </div>
          {lastCapturedPayload ? (
            <div className="space-y-1 text-xs font-mono">
              <div><span className="text-muted-foreground">Request ID:</span> {lastCapturedPayload.clientRequestId}</div>
              <div><span className="text-muted-foreground">Sale ID:</span> {lastCapturedPayload.saleId || 'N/A'}</div>
              <div><span className="text-muted-foreground">Time:</span> {lastCapturedPayload.timestamp.toLocaleTimeString('ar-SA')}</div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">لا يوجد طلب ملتقط - قم بإتمام بيع أولاً</p>
          )}
        </div>

        <Separator />

        {/* Test Buttons */}
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={runSameReplayTest}
            disabled={isRunning || !lastCapturedPayload}
            className="flex-col h-auto py-2"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
            <span className="text-xs mt-1">B1: SAME</span>
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={runMismatchTest}
            disabled={isRunning || !lastCapturedPayload}
            className="flex-col h-auto py-2"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
            <span className="text-xs mt-1">C1: MISMATCH</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={runDoubleSubmitTest}
            disabled={isRunning || !lastCapturedPayload}
            className="flex-col h-auto py-2"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            <span className="text-xs mt-1">DOUBLE</span>
          </Button>
        </div>

        <Separator />

        {/* Test Results */}
        {testResults.length > 0 && (
          <div>
            <div className="text-sm font-medium mb-2 flex items-center gap-2">
              <Play className="w-4 h-4" />
              نتائج الاختبارات
            </div>
            <ScrollArea className="h-48">
              <div className="space-y-2">
                {testResults.map((result, idx) => (
                  <Alert 
                    key={idx} 
                    variant={result.success && result.idempotent ? 'default' : 
                             result.errorCode?.includes('CONFLICT') ? 'default' : 'destructive'}
                    className="py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <AlertTitle className="text-xs flex items-center gap-2">
                          <Badge variant={result.mode === 'SAME' ? 'secondary' : result.mode === 'MISMATCH' ? 'outline' : 'default'}>
                            {result.mode}
                          </Badge>
                          <span className="text-muted-foreground">
                            {result.timestamp.toLocaleTimeString('ar-SA')}
                          </span>
                        </AlertTitle>
                        <AlertDescription className="mt-1 text-xs font-mono space-y-0.5">
                          <div><span className="text-muted-foreground">rid:</span> {result.clientRequestId.slice(0, 8)}...</div>
                          {result.idempotent !== undefined && (
                            <div><span className="text-muted-foreground">idempotent:</span> {result.idempotent ? '✅ true' : 'false'}</div>
                          )}
                          {result.saleId && <div><span className="text-muted-foreground">sale_id:</span> {result.saleId.slice(0, 8)}...</div>}
                          {result.errorCode && <div><span className="text-muted-foreground">error_code:</span> {result.errorCode}</div>}
                          {result.errorMessage && <div className="truncate"><span className="text-muted-foreground">msg:</span> {result.errorMessage}</div>}
                        </AlertDescription>
                      </div>
                      {result.success && result.idempotent && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                      {result.errorCode?.includes('CONFLICT') && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                    </div>
                  </Alert>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <Separator />

        {/* SQL Queries for Manual Verification */}
        {sqlQueries && (
          <div>
            <div className="text-sm font-medium mb-2">استعلامات SQL للتحقق اليدوي</div>
            <div className="space-y-2">
              {Object.entries(sqlQueries).map(([key, sql]) => (
                <div key={key} className="flex items-start gap-2 p-2 bg-muted rounded text-xs font-mono">
                  <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-all">{sql}</pre>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0"
                    onClick={() => copySql(key, sql)}
                  >
                    {copiedSql === key ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
