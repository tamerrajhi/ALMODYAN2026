import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Database, Trash2, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import MainLayout from '@/components/layout/MainLayout';

interface SeedStats {
  deletedInvoices: number;
  deletedJournalEntries: number;
  deletedPayments: number;
  createdSalesInvoices: number;
  createdPurchaseInvoices: number;
  createdReturns: number;
  createdReceipts: number;
  createdPaymentVouchers: number;
  createdJournalEntries: number;
}

interface SeedResult {
  success: boolean;
  message: string;
  stats: SeedStats;
  errors: string[];
}

export default function TestDataSeederPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);
  const [isSeedingSellers, setIsSeedingSellers] = useState(false);
  const [sellerSeedResult, setSellerSeedResult] = useState<any>(null);

  const handleSeedData = async () => {
    if (!confirm('⚠️ تحذير: هذه العملية ستحذف جميع البيانات المالية الحالية وتنشئ بيانات اختبارية جديدة.\n\nهل أنت متأكد من المتابعة؟')) {
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/admin/seed-test-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const { data, error } = await res.json();

      if (error) {
        throw new Error(error.message);
      }

      setResult(data as SeedResult);

      if (data.success) {
        toast.success('تم تهيئة بيانات الاختبار بنجاح');
      } else {
        toast.error('فشلت عملية التهيئة');
      }
    } catch (error: any) {
      console.error('Seed error:', error);
      toast.error('حدث خطأ أثناء التهيئة: ' + (error.message || 'خطأ غير معروف'));
      setResult({
        success: false,
        message: error.message || 'حدث خطأ غير متوقع',
        stats: {
          deletedInvoices: 0,
          deletedJournalEntries: 0,
          deletedPayments: 0,
          createdSalesInvoices: 0,
          createdPurchaseInvoices: 0,
          createdReturns: 0,
          createdReceipts: 0,
          createdPaymentVouchers: 0,
          createdJournalEntries: 0,
        },
        errors: [error.message],
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <MainLayout>
      <div className="container mx-auto py-6 space-y-6" dir="rtl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">تهيئة بيانات الاختبار</h1>
            <p className="text-muted-foreground">إنشاء بيانات محاسبية للاختبار والتطوير</p>
          </div>
          <Badge variant="destructive" className="text-sm">
            بيئة اختبار فقط
          </Badge>
        </div>

        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>تحذير مهم</AlertTitle>
          <AlertDescription>
            هذه العملية ستحذف جميع البيانات المالية الحالية بما في ذلك الفواتير، القيود اليومية، المدفوعات، والمرتجعات.
            سيتم الحفاظ على شجرة الحسابات، العملاء، الموردين، والمخزون.
          </AlertDescription>
        </Alert>

        <div className="grid gap-6 md:grid-cols-2">
          {/* What will be deleted */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <Trash2 className="h-5 w-5" />
                سيتم حذفه
              </CardTitle>
              <CardDescription>البيانات التي ستُمسح من النظام</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive" />
                  فواتير المبيعات والمشتريات
                </li>
                <li className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive" />
                  مرتجعات المبيعات والمشتريات
                </li>
                <li className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive" />
                  سندات القبض والصرف
                </li>
                <li className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive" />
                  القيود اليومية
                </li>
                <li className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive" />
                  نتائج Health Check السابقة
                </li>
                <li className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive" />
                  أرصدة الحسابات والعملاء والموردين
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* What will be created */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-primary">
                <FileSpreadsheet className="h-5 w-5" />
                سيتم إنشاؤه
              </CardTitle>
              <CardDescription>البيانات الاختبارية الجديدة</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  10 فواتير مبيعات (مدفوعة، جزئية، معلقة)
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  8 فواتير مشتريات
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  3 مرتجعات مبيعات + 3 مرتجعات مشتريات
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  5 سندات قبض من عملاء
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  5 سندات صرف لموردين
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  قيود يومية تلقائية لكل عملية
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Action Button */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <Button
                size="lg"
                variant="destructive"
                onClick={handleSeedData}
                disabled={isLoading}
                className="gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    جاري التهيئة...
                  </>
                ) : (
                  <>
                    <Database className="h-5 w-5" />
                    بدء تهيئة بيانات الاختبار
                  </>
                )}
              </Button>
              <p className="text-sm text-muted-foreground">
                ⏱️ قد تستغرق العملية بضع ثوانٍ
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {result && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {result.success ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-destructive" />
                )}
                نتيجة التهيئة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant={result.success ? 'default' : 'destructive'}>
                <AlertDescription>{result.message}</AlertDescription>
              </Alert>

              {result.success && (
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-lg border p-4">
                    <h4 className="font-medium mb-2 text-destructive">تم الحذف</h4>
                    <ul className="text-sm space-y-1">
                      <li>الفواتير: {result.stats.deletedInvoices}</li>
                      <li>القيود: {result.stats.deletedJournalEntries}</li>
                      <li>المدفوعات: {result.stats.deletedPayments}</li>
                    </ul>
                  </div>

                  <div className="rounded-lg border p-4">
                    <h4 className="font-medium mb-2 text-primary">تم الإنشاء</h4>
                    <ul className="text-sm space-y-1">
                      <li>فواتير مبيعات: {result.stats.createdSalesInvoices}</li>
                      <li>فواتير مشتريات: {result.stats.createdPurchaseInvoices}</li>
                      <li>مرتجعات: {result.stats.createdReturns}</li>
                    </ul>
                  </div>

                  <div className="rounded-lg border p-4">
                    <h4 className="font-medium mb-2 text-primary">السندات والقيود</h4>
                    <ul className="text-sm space-y-1">
                      <li>سندات قبض: {result.stats.createdReceipts}</li>
                      <li>سندات صرف: {result.stats.createdPaymentVouchers}</li>
                      <li>قيود يومية: {result.stats.createdJournalEntries}</li>
                    </ul>
                  </div>
                </div>
              )}

              {result.errors.length > 0 && (
                <div className="rounded-lg border border-destructive p-4">
                  <h4 className="font-medium mb-2 text-destructive">الأخطاء</h4>
                  <ul className="text-sm space-y-1">
                    {result.errors.map((error, i) => (
                      <li key={i} className="text-destructive">{error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.success && (
                <div className="flex gap-2 pt-4">
                  <Button variant="outline" onClick={() => window.location.href = '/accounting/health-check'}>
                    <RefreshCw className="h-4 w-4 ml-2" />
                    تشغيل فحص الصحة المحاسبية
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {/* Seed Sellers Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              تهيئة البائعين لكل فرع (DEV)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              يقوم بتعيين المستخدمين النشطين الحاليين كبائعين في الفروع التي لا يوجد بها بائعون كافون.
              هذه العملية آمنة ولا تحذف أي بيانات.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={async () => {
                  setIsSeedingSellers(true);
                  setSellerSeedResult(null);
                  try {
                    const res = await fetch('/api/admin/dev/seed-sellers', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                    });
                    const json = await res.json();
                    if (json.error) throw new Error(json.error.message);
                    setSellerSeedResult(json.data);
                    toast.success(json.data?.message || 'تم تعيين البائعين');
                  } catch (e: any) {
                    toast.error(e.message);
                    setSellerSeedResult({ error: e.message });
                  } finally {
                    setIsSeedingSellers(false);
                  }
                }}
                disabled={isSeedingSellers}
                data-testid="button-seed-sellers"
              >
                {isSeedingSellers ? (
                  <>
                    <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                    جاري التعيين...
                  </>
                ) : (
                  <>
                    <Database className="h-4 w-4 ml-2" />
                    تعيين بائعين للفروع
                  </>
                )}
              </Button>
            </div>
            {sellerSeedResult && !sellerSeedResult.error && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  تمت المعالجة: {sellerSeedResult.branchesProcessed} فرع، تم تعيين {sellerSeedResult.assignmentsCreated} بائع جديد
                </AlertDescription>
              </Alert>
            )}
            {sellerSeedResult?.error && (
              <Alert variant="destructive">
                <AlertDescription>{sellerSeedResult.error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
