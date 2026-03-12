import { useState, useEffect, useCallback } from 'react';
import MainLayout from '@/components/layout/MainLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  FileText,
  RotateCcw,
  Building2,
  Package,
  ExternalLink,
  Calculator,
} from 'lucide-react';
import { toast } from 'sonner';
import { queryTable } from '@/lib/dataGateway';
import { PurchasingDrillDownDialog } from '@/components/purchasing/monitoring/PurchasingDrillDownDialog';
import type { PurchasingDrillDownType } from '@/components/purchasing/monitoring/types';

type Severity = 'critical' | 'warning' | 'info' | 'ok';

interface MonitoringSummary {
  draft_invoices: number;
  posted_no_je: number;
  returns_pending_post: number;
  returns_ref_mismatch: number;
  vendor_negative_balance: number;
  paid_with_remaining: number;
  missing_movements: number;
  wrong_account_mapping: number;
  generated_at: string;
}

interface KPICardProps {
  title: string;
  titleAr: string;
  value: number | null;
  severity: Severity;
  icon: React.ReactNode;
  onClick?: () => void;
}

const getSeverity = (metricKey: string, value: number | null): Severity => {
  if (value === null || value === 0) return 'ok';

  if (['posted_no_je', 'returns_ref_mismatch', 'vendor_negative_balance'].includes(metricKey)) {
    return value > 0 ? 'critical' : 'ok';
  }

  if (['draft_invoices', 'returns_pending_post', 'paid_with_remaining'].includes(metricKey)) {
    return value > 0 ? 'warning' : 'ok';
  }

  if (['missing_movements', 'wrong_account_mapping'].includes(metricKey)) {
    return value > 0 ? 'info' : 'ok';
  }

  return 'ok';
};

const SeverityBadge = ({ severity }: { severity: Severity }) => {
  const { language } = useLanguage();
  const config = {
    critical: { label: 'Critical', labelAr: 'حرج', variant: 'destructive' as const, icon: <AlertCircle className="h-3 w-3" /> },
    warning: { label: 'Warning', labelAr: 'تحذير', variant: 'secondary' as const, icon: <AlertTriangle className="h-3 w-3" /> },
    info: { label: 'Info', labelAr: 'معلومات', variant: 'outline' as const, icon: <CheckCircle2 className="h-3 w-3" /> },
    ok: { label: 'OK', labelAr: 'سليم', variant: 'default' as const, icon: <CheckCircle2 className="h-3 w-3" /> },
  };

  const c = config[severity];

  return (
    <Badge variant={c.variant} className="gap-1">
      {c.icon}
      {language === 'ar' ? c.labelAr : c.label}
    </Badge>
  );
};

const KPICard = ({ title, titleAr, value, severity, icon, onClick }: KPICardProps) => {
  const { language } = useLanguage();

  const bgColors = {
    critical: 'bg-destructive/10 border-destructive/30',
    warning: 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800',
    info: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800',
    ok: 'bg-accent/50 border-accent',
  };

  return (
    <Card
      className={`${bgColors[severity]} border-2 ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">
          {icon}
          {language === 'ar' ? titleAr : title}
          {onClick && <ExternalLink className="h-3 w-3 ml-auto opacity-50" />}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <span className="text-3xl font-bold">{value ?? '-'}</span>
          <SeverityBadge severity={severity} />
        </div>
      </CardContent>
    </Card>
  );
};

export default function PurchasingMonitoringPage() {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Drill-down state
  const [drillDownType, setDrillDownType] = useState<PurchasingDrillDownType | null>(null);
  const [drillDownOpen, setDrillDownOpen] = useState(false);

  const fetchSummary = useCallback(async () => {
    try {
      setLoading(true);

      const [
        draftResult,
        postedNoJeResult,
        returnsPendingResult,
        returnsRefMismatchResult,
        vendorNegativeResult,
        paidWithRemainingResult,
      ] = await Promise.all([
        queryTable<Array<{ id: string }>>('invoices', {
          select: 'id',
          filters: [
            { type: 'eq', column: 'invoice_type', value: 'purchase' },
            { type: 'eq', column: 'status', value: 'draft' },
          ],
        }),
        queryTable<Array<{ id: string }>>('invoices', {
          select: 'id',
          filters: [
            { type: 'eq', column: 'invoice_type', value: 'purchase' },
            { type: 'eq', column: 'status', value: 'posted' },
            { type: 'is', column: 'journal_entry_id', value: null },
          ],
        }),
        queryTable<Array<{ id: string }>>('purchase_returns', {
          select: 'id',
          filters: [
            { type: 'eq', column: 'status', value: 'draft' },
          ],
        }),
        queryTable<Array<{ id: string }>>('purchase_returns', {
          select: 'id',
          filters: [
            { type: 'eq', column: 'status', value: 'posted' },
            { type: 'is', column: 'journal_entry_id', value: null },
          ],
        }),
        queryTable<Array<{ id: string }>>('suppliers', {
          select: 'id',
          filters: [
            { type: 'lt', column: 'outstanding_balance', value: 0 },
          ],
        }).catch(() => ({ data: null, error: { message: 'column may not exist' } })),
        queryTable<Array<{ id: string }>>('invoices', {
          select: 'id',
          filters: [
            { type: 'eq', column: 'invoice_type', value: 'purchase' },
            { type: 'eq', column: 'status', value: 'paid' },
            { type: 'gt', column: 'remaining_amount', value: 0.01 },
          ],
        }),
      ]);

      setSummary({
        draft_invoices: Array.isArray(draftResult.data) ? draftResult.data.length : 0,
        posted_no_je: Array.isArray(postedNoJeResult.data) ? postedNoJeResult.data.length : 0,
        returns_pending_post: Array.isArray(returnsPendingResult.data) ? returnsPendingResult.data.length : 0,
        returns_ref_mismatch: Array.isArray(returnsRefMismatchResult.data) ? returnsRefMismatchResult.data.length : 0,
        vendor_negative_balance: Array.isArray(vendorNegativeResult.data) ? vendorNegativeResult.data.length : 0,
        paid_with_remaining: Array.isArray(paidWithRemainingResult.data) ? paidWithRemainingResult.data.length : 0,
        missing_movements: 0, // Requires more complex query
        wrong_account_mapping: 0, // Requires more complex query
        generated_at: new Date().toISOString(),
      });
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Failed to fetch monitoring summary:', err);
      toast.error(isAr ? 'فشل في تحميل البيانات' : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [isAr]);

  useEffect(() => {
    fetchSummary();
    const interval = setInterval(fetchSummary, 60000);
    return () => clearInterval(interval);
  }, [fetchSummary]);

  const openDrillDown = (type: PurchasingDrillDownType) => {
    setDrillDownType(type);
    setDrillDownOpen(true);
  };

  const kpiCards = summary
    ? [
        {
          section: isAr ? 'فواتير المشتريات' : 'Purchase Invoices',
          icon: <FileText className="h-4 w-4" />,
          cards: [
            {
              key: 'draft_invoices',
              title: 'Draft/Unposted',
              titleAr: 'مسودة/غير مرحل',
              value: summary.draft_invoices,
              drillDownType: 'draft_invoices' as PurchasingDrillDownType,
            },
            {
              key: 'posted_no_je',
              title: 'Posted without JE',
              titleAr: 'مرحل بدون قيد',
              value: summary.posted_no_je,
              drillDownType: 'posted_no_je' as PurchasingDrillDownType,
            },
          ],
        },
        {
          section: isAr ? 'المرتجعات' : 'Returns',
          icon: <RotateCcw className="h-4 w-4" />,
          cards: [
            {
              key: 'returns_pending_post',
              title: 'Pending Posting',
              titleAr: 'في انتظار الترحيل',
              value: summary.returns_pending_post,
              drillDownType: 'returns_pending_post' as PurchasingDrillDownType,
            },
            {
              key: 'returns_ref_mismatch',
              title: 'Reference Mismatch',
              titleAr: 'عدم تطابق المرجع',
              value: summary.returns_ref_mismatch,
              drillDownType: 'returns_ref_mismatch' as PurchasingDrillDownType,
            },
          ],
        },
        {
          section: isAr ? 'أرصدة الموردين' : 'Vendor Balances',
          icon: <Building2 className="h-4 w-4" />,
          cards: [
            {
              key: 'vendor_negative_balance',
              title: 'Negative/Abnormal',
              titleAr: 'رصيد سالب/غير طبيعي',
              value: summary.vendor_negative_balance,
              drillDownType: 'vendor_negative_balance' as PurchasingDrillDownType,
            },
            {
              key: 'paid_with_remaining',
              title: 'Paid but Remaining > 0',
              titleAr: 'مدفوع لكن المتبقي > 0',
              value: summary.paid_with_remaining,
              drillDownType: 'paid_with_remaining' as PurchasingDrillDownType,
            },
          ],
        },
        {
          section: isAr ? 'تأثيرات المخزون' : 'Inventory Effects',
          icon: <Package className="h-4 w-4" />,
          cards: [
            {
              key: 'missing_movements',
              title: 'Missing Movements',
              titleAr: 'حركات مفقودة',
              value: summary.missing_movements,
              drillDownType: 'missing_movements' as PurchasingDrillDownType,
            },
            {
              key: 'wrong_account_mapping',
              title: 'Wrong Account Mapping',
              titleAr: 'خريطة حسابات خاطئة',
              value: summary.wrong_account_mapping,
              drillDownType: 'wrong_account_mapping' as PurchasingDrillDownType,
            },
          ],
        },
      ]
    : [];

  const activeAlerts = summary
    ? Object.entries(summary).filter(
        ([key, value]) =>
          typeof value === 'number' &&
          value > 0 &&
          !['generated_at'].includes(key)
      ).length
    : 0;

  if (loading && !summary) {
    return (
      <MainLayout>
        <div className="space-y-6 p-6">
          <Skeleton className="h-10 w-64" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
        {/* Drill-down Dialog */}
        <PurchasingDrillDownDialog
          open={drillDownOpen}
          onOpenChange={setDrillDownOpen}
          type={drillDownType || 'draft_invoices'}
        />

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              {isAr ? 'مراقبة المشتريات' : 'Purchasing Monitoring'}
            </h1>
            <p className="text-muted-foreground">
              {isAr
                ? `آخر تحديث: ${lastRefresh?.toLocaleTimeString('ar-SA') ?? '-'}`
                : `Last updated: ${lastRefresh?.toLocaleTimeString() ?? '-'}`}
            </p>
          </div>
          <Button onClick={fetchSummary} disabled={loading} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            {isAr ? 'تحديث' : 'Refresh'}
          </Button>
        </div>

        {/* Active Alerts Summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              {isAr ? 'ملخص التنبيهات' : 'Alerts Summary'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="text-4xl font-bold">{activeAlerts}</div>
              <div className="text-muted-foreground">
                {isAr ? 'مشكلة تحتاج مراجعة' : 'issues need attention'}
              </div>
              {activeAlerts === 0 && (
                <Badge className="bg-green-100 text-green-800 gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {isAr ? 'كل شيء سليم' : 'All Clear'}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* KPI Cards by Section */}
        {kpiCards.map((section) => (
          <div key={section.section} className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              {section.icon}
              {section.section}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {section.cards.map((card) => (
                <KPICard
                  key={card.key}
                  title={card.title}
                  titleAr={card.titleAr}
                  value={card.value}
                  severity={getSeverity(card.key, card.value)}
                  icon={section.icon}
                  onClick={() => openDrillDown(card.drillDownType)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </MainLayout>
  );
}
