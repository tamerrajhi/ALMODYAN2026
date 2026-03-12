import { useState, useCallback } from 'react';
import MainLayout from '@/components/layout/MainLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Copy,
  Check,
  RefreshCw,
  Activity,
} from 'lucide-react';
import { toast } from 'sonner';

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
  status: 'PASS' | 'FAIL';
  count: number;
  failing_records?: FailingRecord[];
}

interface GateTestResponse {
  timestamp: string;
  tests: TestResult[];
  summary: { passed: number; failed: number; total: number };
  meta?: { truncated: boolean; max_records_checked: number };
}

export default function PurchasingHealthCheckPage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const isAr = language === 'ar';

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GateTestResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const testLabels: Record<string, { en: string; ar: string }> = {
    'PI-G1': { en: 'Missing Journal Entry', ar: 'قيد محاسبي مفقود' },
    'PI-G2': { en: 'Unposted/Unbalanced JE', ar: 'قيد غير مرحل أو غير متوازن' },
    'PI-G3': { en: 'Reference Mismatch', ar: 'عدم تطابق المرجع' },
    'PI-G4': { en: 'Legacy Columns (debit/credit)', ar: 'أعمدة قديمة (مدين/دائن)' },
  };

  const runTests = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/purchasing/gate-tests-run');
      const result = await response.json();

      if (result.error) throw new Error(result.error.message);
      const data = result.data;

      setResults(data as GateTestResponse);

      // Save audit run - BLOCKED: Use atomic RPC instead
      forbidDirectWrite('insert', 'PurchasingHealthCheckPage.tsx:runTests');

      const summary = data.summary;
      if (summary.failed === 0) {
        toast.success(isAr ? 'جميع الاختبارات نجحت!' : 'All tests passed!');
      } else {
        toast.error(
          isAr
            ? `${summary.failed} اختبار(ات) فشلت`
            : `${summary.failed} test(s) failed`
        );
      }
    } catch (err) {
      console.error('Gate test error:', err);
      toast.error(isAr ? 'فشل في تشغيل الاختبارات' : 'Failed to run tests');
    } finally {
      setLoading(false);
    }
  }, [isAr, user?.id]);

  const copyToClipboard = useCallback(() => {
    if (!results) return;
    const lines = [
      'Test ID | Name | Status | Count',
      '--- | --- | --- | ---',
    ];
    for (const test of results.tests) {
      lines.push(`${test.id} | ${test.name} | ${test.status} | ${test.count}`);
    }
    lines.push('', `Summary: ${results.summary.passed} PASS, ${results.summary.failed} FAIL`);
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      toast.success(isAr ? 'تم النسخ!' : 'Copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    });
  }, [results, isAr]);

  const getStatusBadge = (status: 'PASS' | 'FAIL') => {
    if (status === 'PASS') {
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 gap-1">
          <CheckCircle className="h-3 w-3" />
          {isAr ? 'نجح' : 'PASS'}
        </Badge>
      );
    }
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        {isAr ? 'فشل' : 'FAIL'}
      </Badge>
    );
  };

  return (
    <MainLayout>
      <div className="space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {isAr ? 'فحص سلامة المشتريات' : 'Purchasing Health Check'}
            </h1>
            <p className="text-muted-foreground mt-1">
              {isAr
                ? 'اختبارات للتحقق من سلامة الربط المحاسبي لفواتير المشتريات'
                : 'Gate tests to verify purchase invoice accounting integrity'}
            </p>
          </div>

          <div className="flex gap-2">
            {results && (
              <Button variant="outline" size="sm" onClick={copyToClipboard}>
                {copied ? (
                  <Check className="h-4 w-4 mr-1" />
                ) : (
                  <Copy className="h-4 w-4 mr-1" />
                )}
                {isAr ? 'نسخ' : 'Copy'}
              </Button>
            )}
            <Button onClick={runTests} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-1" />
              )}
              {isAr ? (loading ? 'جاري التشغيل...' : 'تشغيل الاختبارات') : (loading ? 'Running...' : 'Run Tests')}
            </Button>
          </div>
        </div>

        {/* Mode Indicator */}
        <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
              <Activity className="w-5 h-5" />
              <span className="font-medium">
                {isAr
                  ? 'وضع القراءة فقط - لن يتم إجراء أي تعديلات'
                  : 'Read-Only Mode - No modifications will be made'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* No Results State */}
        {!results && !loading && (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <Activity className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {isAr ? 'لم يتم تشغيل أي اختبارات بعد' : 'No tests have been run yet'}
              </h3>
              <p className="text-muted-foreground mb-4">
                {isAr
                  ? 'اضغط على "تشغيل الاختبارات" لبدء الفحص'
                  : 'Click "Run Tests" to start the health check'}
              </p>
              <Button onClick={runTests}>
                <Play className="w-4 h-4 mr-1" />
                {isAr ? 'تشغيل الاختبارات' : 'Run Tests'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Loading State */}
        {loading && (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <Loader2 className="w-16 h-16 text-primary animate-spin mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {isAr ? 'جاري تشغيل الاختبارات...' : 'Running tests...'}
              </h3>
              <p className="text-muted-foreground">
                {isAr
                  ? 'يرجى الانتظار، قد يستغرق هذا بضع ثوان'
                  : 'Please wait, this may take a few seconds'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {results && !loading && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{isAr ? 'إجمالي الاختبارات' : 'Total Tests'}</CardDescription>
                </CardHeader>
                <CardContent>
                  <span className="text-3xl font-bold">{results.summary.total}</span>
                </CardContent>
              </Card>
              <Card className="bg-green-50 dark:bg-green-950/30 border-green-200">
                <CardHeader className="pb-2">
                  <CardDescription className="text-green-700 dark:text-green-300">
                    {isAr ? 'نجحت' : 'Passed'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                  <CheckCircle className="h-6 w-6 text-green-600" />
                  <span className="text-3xl font-bold text-green-700">{results.summary.passed}</span>
                </CardContent>
              </Card>
              <Card className={results.summary.failed > 0 ? 'bg-red-50 dark:bg-red-950/30 border-red-200' : ''}>
                <CardHeader className="pb-2">
                  <CardDescription className={results.summary.failed > 0 ? 'text-red-700 dark:text-red-300' : ''}>
                    {isAr ? 'فشلت' : 'Failed'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                  {results.summary.failed > 0 && <XCircle className="h-6 w-6 text-red-600" />}
                  <span className={`text-3xl font-bold ${results.summary.failed > 0 ? 'text-red-700' : ''}`}>
                    {results.summary.failed}
                  </span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{isAr ? 'وقت التشغيل' : 'Run Time'}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {new Date(results.timestamp).toLocaleString(isAr ? 'ar-SA' : 'en-US')}
                  </span>
                </CardContent>
              </Card>
            </div>

            {/* Truncation Warning */}
            {results.meta?.truncated && (
              <Card className="bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200">
                <CardContent className="py-3">
                  <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-300">
                    <AlertTriangle className="w-5 h-5" />
                    <span>
                      {isAr
                        ? `تم فحص ${results.meta.max_records_checked} سجل فقط - قد توجد سجلات أخرى`
                        : `Only ${results.meta.max_records_checked} records checked - more may exist`}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Test Results Table */}
            <Card>
              <CardHeader>
                <CardTitle>{isAr ? 'نتائج الاختبارات' : 'Test Results'}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{isAr ? 'رقم الاختبار' : 'Test ID'}</TableHead>
                      <TableHead>{isAr ? 'الاسم' : 'Name'}</TableHead>
                      <TableHead>{isAr ? 'الحالة' : 'Status'}</TableHead>
                      <TableHead className="text-center">{isAr ? 'العدد' : 'Count'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.tests.map((test) => (
                      <TableRow key={test.id}>
                        <TableCell className="font-mono">{test.id}</TableCell>
                        <TableCell>
                          {isAr
                            ? testLabels[test.id]?.ar || test.name
                            : testLabels[test.id]?.en || test.name}
                        </TableCell>
                        <TableCell>{getStatusBadge(test.status)}</TableCell>
                        <TableCell className="text-center">{test.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Failing Records (Expandable) */}
            {results.tests.some((t) => t.failing_records && t.failing_records.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>{isAr ? 'السجلات الفاشلة' : 'Failing Records'}</CardTitle>
                  <CardDescription>
                    {isAr ? 'أول 50 سجل لكل اختبار فاشل' : 'First 50 records for each failed test'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Accordion type="multiple" className="w-full">
                    {results.tests
                      .filter((t) => t.failing_records && t.failing_records.length > 0)
                      .map((test) => (
                        <AccordionItem key={test.id} value={test.id}>
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex items-center gap-2">
                              <span className="font-mono">{test.id}</span>
                              <span>-</span>
                              <span>
                                {isAr
                                  ? testLabels[test.id]?.ar || test.name
                                  : testLabels[test.id]?.en || test.name}
                              </span>
                              <Badge variant="secondary">{test.count}</Badge>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <ScrollArea className="h-[300px]">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    {test.failing_records?.[0]?.invoice_id && (
                                      <TableHead>{isAr ? 'رقم الفاتورة' : 'Invoice #'}</TableHead>
                                    )}
                                    {test.failing_records?.[0]?.invoice_date && (
                                      <TableHead>{isAr ? 'التاريخ' : 'Date'}</TableHead>
                                    )}
                                    {test.failing_records?.[0]?.total_amount !== undefined && (
                                      <TableHead>{isAr ? 'المبلغ' : 'Amount'}</TableHead>
                                    )}
                                    {test.failing_records?.[0]?.je_id && (
                                      <TableHead>{isAr ? 'القيد' : 'JE'}</TableHead>
                                    )}
                                    {test.failing_records?.[0]?.issue && (
                                      <TableHead>{isAr ? 'المشكلة' : 'Issue'}</TableHead>
                                    )}
                                    <TableHead>{isAr ? 'المعرف' : 'ID'}</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {test.failing_records?.map((record, idx) => (
                                    <TableRow key={idx}>
                                      {record.invoice_number && (
                                        <TableCell className="font-mono">{record.invoice_number}</TableCell>
                                      )}
                                      {record.invoice_date && (
                                        <TableCell>{record.invoice_date}</TableCell>
                                      )}
                                      {record.total_amount !== undefined && (
                                        <TableCell>{record.total_amount?.toLocaleString()}</TableCell>
                                      )}
                                      {record.je_id && (
                                        <TableCell className="font-mono text-xs">{record.entry_number || record.je_id?.slice(0, 8)}</TableCell>
                                      )}
                                      {record.issue && (
                                        <TableCell>
                                          <Badge variant="outline">{record.issue}</Badge>
                                        </TableCell>
                                      )}
                                      <TableCell className="font-mono text-xs text-muted-foreground">
                                        {record.invoice_id?.slice(0, 8)}...
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </ScrollArea>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                  </Accordion>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </MainLayout>
  );
}
