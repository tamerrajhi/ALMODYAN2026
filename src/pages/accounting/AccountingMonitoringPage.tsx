import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import * as dataGateway from '@/lib/dataGateway';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, RefreshCw, Clock, Shield, FileText, Calculator, Workflow, ExternalLink, History, FlaskConical, Copy, Check } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { DrillDownDialog, HBLegacyCleanupDialog } from '@/components/accounting/monitoring';
import type { DrillDownType } from '@/components/accounting/monitoring/types';

interface GateTestResult {
  kpi: string;
  summaryCount: number | null;
  drillDownCount: number | null;
  status: 'PASS' | 'FAIL' | 'SKIP';
}

interface MonitoringSummary {
  hb_enable_date: string;
  workflow_timeout_minutes: number;
  tolerance: number;
  hb_new_violations: number;
  hb_legacy_count: number;
  allow_unallocated_count: number | null;
  formula_mismatch_count: number;
  negative_remaining_count: number;
  overpaid_count: number;
  stuck_workflows_count: number;
  unbalanced_je_count: number;
  generated_at: string;
  notes: string[];
}

type Severity = 'critical' | 'warning' | 'info' | 'ok';

interface AlertRow {
  category: string;
  categoryIcon: React.ReactNode;
  metric: string;
  metricKey: keyof MonitoringSummary;
  drillDownType: DrillDownType;
  value: number | null;
  severity: Severity;
  owner: string;
  action: string;
}

const getSeverity = (metricKey: string, value: number | null): Severity => {
  if (value === null) return 'ok';
  
  if (['hb_new_violations', 'formula_mismatch_count', 'negative_remaining_count', 'overpaid_count'].includes(metricKey)) {
    return value > 0 ? 'critical' : 'ok';
  }
  
  if (['stuck_workflows_count', 'unbalanced_je_count'].includes(metricKey)) {
    return value > 0 ? 'warning' : 'ok';
  }
  
  if (metricKey === 'hb_legacy_count' || metricKey === 'allow_unallocated_count') {
    return value > 0 ? 'info' : 'ok';
  }
  
  return 'ok';
};

const SeverityBadge = ({ severity }: { severity: Severity }) => {
  const config = {
    critical: { label: 'Critical', labelAr: 'حرج', variant: 'destructive' as const, icon: <AlertCircle className="h-3 w-3" /> },
    warning: { label: 'Warning', labelAr: 'تحذير', variant: 'secondary' as const, icon: <AlertTriangle className="h-3 w-3" /> },
    info: { label: 'Info', labelAr: 'معلومات', variant: 'outline' as const, icon: <Info className="h-3 w-3" /> },
    ok: { label: 'OK', labelAr: 'سليم', variant: 'default' as const, icon: <CheckCircle2 className="h-3 w-3" /> },
  };
  
  const { language } = useLanguage();
  const c = config[severity];
  
  return (
    <Badge variant={c.variant} className="gap-1">
      {c.icon}
      {language === 'ar' ? c.labelAr : c.label}
    </Badge>
  );
};

interface KPICardProps {
  title: string;
  titleAr: string;
  value: number | null;
  severity: Severity;
  icon: React.ReactNode;
  onClick?: () => void;
}

const KPICard = ({ title, titleAr, value, severity, icon, onClick }: KPICardProps) => {
  const { language } = useLanguage();
  
  const bgColors = {
    critical: 'bg-destructive/10 border-destructive/30',
    warning: 'bg-warning/10 border-warning/30',
    info: 'bg-info/10 border-info/30',
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

export default function AccountingMonitoringPage() {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  
  // Drill-down state
  const [drillDownType, setDrillDownType] = useState<DrillDownType | null>(null);
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [legacyCleanupOpen, setLegacyCleanupOpen] = useState(false);
  
  // Gate Test state
  const [gateTestResults, setGateTestResults] = useState<GateTestResult[]>([]);
  const [gateTestRunning, setGateTestRunning] = useState(false);
  const [gateTestVisible, setGateTestVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  
  // Generate plaintext output for gate test results
  const getGateTestPlainText = useCallback(() => {
    if (gateTestResults.length === 0) return '';
    const lines = ['KPI | summary_count | drilldown_count | PASS/FAIL', '--- | --- | --- | ---'];
    for (const r of gateTestResults) {
      lines.push(`${r.kpi} | ${r.summaryCount ?? 'NULL'} | ${r.drillDownCount ?? 'ERROR'} | ${r.status}`);
    }
    const passed = gateTestResults.filter(r => r.status === 'PASS').length;
    const failed = gateTestResults.filter(r => r.status === 'FAIL').length;
    lines.push('', `TOTAL: ${passed} PASS, ${failed} FAIL`);
    return lines.join('\n');
  }, [gateTestResults]);
  
  const copyToClipboard = useCallback(() => {
    const text = getGateTestPlainText();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success(isAr ? 'تم النسخ!' : 'Copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    });
  }, [getGateTestPlainText, isAr]);

  const fetchSummary = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await dataGateway.getMonitoringSummary();
      
      if (error) throw new Error(error.message);
      
      setSummary(data as unknown as MonitoringSummary);
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

  const openDrillDown = (type: DrillDownType) => {
    if (type === 'hb_legacy') {
      setLegacyCleanupOpen(true);
    } else {
      setDrillDownType(type);
      setDrillDownOpen(true);
    }
  };

  // Phase 3-B Gate Test Runner
  const runGateTests = useCallback(async () => {
    setGateTestRunning(true);
    setGateTestVisible(true);
    const results: GateTestResult[] = [];
    
    try {
      console.log('=== PHASE 3-B GATE TESTS START ===');
      
      // 1. Fetch summary
      const { data: summaryData, error: summaryError } = await dataGateway.getMonitoringSummary();
      if (summaryError) {
        console.error('Summary RPC failed:', summaryError);
        toast.error('Failed to fetch monitoring summary');
        return;
      }
      
      const summary = summaryData as unknown as MonitoringSummary;
      console.log('Summary:', summary);
      
      // 2. Fetch all drill-down lists in parallel
      const [
        hbLegacyResult,
        hbNewViolationsResult,
        allowUnallocatedResult,
        formulaMismatchResult,
        negativeRemainingResult,
        overpaidResult,
        stuckWorkflowsResult,
        unbalancedJeResult,
      ] = await Promise.all([
        dataGateway.getMonitoringList('get_hb_legacy_list'),
        dataGateway.getMonitoringList('get_hb_new_violations_list'),
        dataGateway.getMonitoringList('get_allow_unallocated_list'),
        dataGateway.getMonitoringList('get_formula_mismatch_list'),
        dataGateway.getMonitoringList('get_negative_remaining_list'),
        dataGateway.getMonitoringList('get_overpaid_list'),
        dataGateway.getMonitoringList('get_stuck_workflows_list'),
        dataGateway.getMonitoringList('get_unbalanced_je_list'),
      ]);
      
      // 3. Build results
      const testCases: { kpi: string; summaryKey: keyof MonitoringSummary; listResult: any }[] = [
        { kpi: 'hb_new_violations', summaryKey: 'hb_new_violations', listResult: hbNewViolationsResult },
        { kpi: 'hb_legacy_count', summaryKey: 'hb_legacy_count', listResult: hbLegacyResult },
        { kpi: 'allow_unallocated_count', summaryKey: 'allow_unallocated_count', listResult: allowUnallocatedResult },
        { kpi: 'formula_mismatch_count', summaryKey: 'formula_mismatch_count', listResult: formulaMismatchResult },
        { kpi: 'negative_remaining_count', summaryKey: 'negative_remaining_count', listResult: negativeRemainingResult },
        { kpi: 'overpaid_count', summaryKey: 'overpaid_count', listResult: overpaidResult },
        { kpi: 'stuck_workflows_count', summaryKey: 'stuck_workflows_count', listResult: stuckWorkflowsResult },
        { kpi: 'unbalanced_je_count', summaryKey: 'unbalanced_je_count', listResult: unbalancedJeResult },
      ];
      
      for (const tc of testCases) {
        const summaryCount = summary[tc.summaryKey] as number | null;
        let drillDownCount: number | null = null;
        let status: 'PASS' | 'FAIL' | 'SKIP' = 'SKIP';
        
        if (tc.listResult.error) {
          console.error(`${tc.kpi} drill-down error:`, tc.listResult.error);
          drillDownCount = null;
          status = 'FAIL';
        } else {
          drillDownCount = Array.isArray(tc.listResult.data) ? tc.listResult.data.length : 0;
          if (summaryCount === null && drillDownCount === 0) {
            status = 'PASS';
          } else if (summaryCount === drillDownCount) {
            status = 'PASS';
          } else {
            status = 'FAIL';
          }
        }
        
        results.push({ kpi: tc.kpi, summaryCount, drillDownCount, status });
        console.log(`${tc.kpi}: summary=${summaryCount}, drilldown=${drillDownCount} → ${status}`);
      }
      
      setGateTestResults(results);
      
      // Summary log
      const passed = results.filter(r => r.status === 'PASS').length;
      const failed = results.filter(r => r.status === 'FAIL').length;
      console.log(`=== PHASE 3-B GATE TESTS END: ${passed} PASS, ${failed} FAIL ===`);
      console.table(results);
      
      if (failed === 0) {
        toast.success(isAr ? 'جميع اختبارات البوابة نجحت!' : 'All gate tests passed!');
      } else {
        toast.error(isAr ? `${failed} اختبارات فشلت` : `${failed} tests failed`);
      }
    } catch (err) {
      console.error('Gate test error:', err);
      toast.error(isAr ? 'فشل في تشغيل الاختبارات' : 'Failed to run gate tests');
    } finally {
      setGateTestRunning(false);
    }
  }, [isAr]);

  const alertRows: AlertRow[] = summary ? [
    {
      category: isAr ? 'حظر صارم' : 'Hard Block',
      categoryIcon: <Shield className="h-4 w-4" />,
      metric: isAr ? 'انتهاكات جديدة' : 'New Violations',
      metricKey: 'hb_new_violations',
      drillDownType: 'hb_new_violations',
      value: summary.hb_new_violations,
      severity: getSeverity('hb_new_violations', summary.hb_new_violations),
      owner: isAr ? 'المحاسبة' : 'Accounting',
      action: isAr ? 'مراجعة دفعات الموردين بدون توزيعات' : 'Review supplier payments without allocations',
    },
    {
      category: isAr ? 'حظر صارم' : 'Hard Block',
      categoryIcon: <Shield className="h-4 w-4" />,
      metric: isAr ? 'سجلات قديمة' : 'Legacy Records',
      metricKey: 'hb_legacy_count',
      drillDownType: 'hb_legacy',
      value: summary.hb_legacy_count,
      severity: getSeverity('hb_legacy_count', summary.hb_legacy_count),
      owner: isAr ? 'الإدارة' : 'Management',
      action: isAr ? 'تنظيف تاريخي - أولوية منخفضة' : 'Historical cleanup - low priority',
    },
    {
      category: isAr ? 'الفواتير' : 'Invoices',
      categoryIcon: <FileText className="h-4 w-4" />,
      metric: isAr ? 'عدم تطابق المعادلة' : 'Formula Mismatch',
      metricKey: 'formula_mismatch_count',
      drillDownType: 'formula_mismatch',
      value: summary.formula_mismatch_count,
      severity: getSeverity('formula_mismatch_count', summary.formula_mismatch_count),
      owner: isAr ? 'المحاسبة' : 'Accounting',
      action: isAr ? 'تصحيح المتبقي = الإجمالي - المرتجع - المدفوع' : 'Fix remaining = total - returned - paid',
    },
    {
      category: isAr ? 'الفواتير' : 'Invoices',
      categoryIcon: <FileText className="h-4 w-4" />,
      metric: isAr ? 'متبقي سالب' : 'Negative Remaining',
      metricKey: 'negative_remaining_count',
      drillDownType: 'negative_remaining',
      value: summary.negative_remaining_count,
      severity: getSeverity('negative_remaining_count', summary.negative_remaining_count),
      owner: isAr ? 'المحاسبة' : 'Accounting',
      action: isAr ? 'مراجعة دفعات زائدة' : 'Review overpayments',
    },
    {
      category: isAr ? 'الفواتير' : 'Invoices',
      categoryIcon: <FileText className="h-4 w-4" />,
      metric: isAr ? 'مدفوع زائد' : 'Overpaid',
      metricKey: 'overpaid_count',
      drillDownType: 'overpaid',
      value: summary.overpaid_count,
      severity: getSeverity('overpaid_count', summary.overpaid_count),
      owner: isAr ? 'المحاسبة' : 'Accounting',
      action: isAr ? 'مراجعة التوزيعات' : 'Review allocations',
    },
    {
      category: isAr ? 'حظر صارم' : 'Hard Block',
      categoryIcon: <Shield className="h-4 w-4" />,
      metric: isAr ? 'allow_unallocated مستخدم' : 'Allow Unallocated Used',
      metricKey: 'allow_unallocated_count',
      drillDownType: 'allow_unallocated',
      value: summary.allow_unallocated_count,
      severity: getSeverity('allow_unallocated_count', summary.allow_unallocated_count),
      owner: isAr ? 'الإدارة' : 'Management',
      action: isAr ? 'تتبع استخدام صلاحية الاستثناء' : 'Track escape hatch usage',
    },
    {
      category: isAr ? 'سير العمل' : 'Workflow',
      categoryIcon: <Workflow className="h-4 w-4" />,
      metric: isAr ? 'عمليات معلقة' : 'Stuck Workflows',
      metricKey: 'stuck_workflows_count',
      drillDownType: 'stuck_workflows',
      value: summary.stuck_workflows_count,
      severity: getSeverity('stuck_workflows_count', summary.stuck_workflows_count),
      owner: isAr ? 'التقنية' : 'Tech',
      action: isAr ? 'فحص pos_workflow_requests' : 'Check pos_workflow_requests',
    },
    {
      category: isAr ? 'القيود' : 'Journal',
      categoryIcon: <Calculator className="h-4 w-4" />,
      metric: isAr ? 'قيود غير متوازنة' : 'Unbalanced JE',
      metricKey: 'unbalanced_je_count',
      drillDownType: 'unbalanced_je',
      value: summary.unbalanced_je_count,
      severity: getSeverity('unbalanced_je_count', summary.unbalanced_je_count),
      owner: isAr ? 'المحاسبة' : 'Accounting',
      action: isAr ? 'تصحيح المدين/الدائن' : 'Fix debit/credit mismatch',
    },
  ] : [];

  const activeAlerts = alertRows.filter(r => r.severity === 'critical' || r.severity === 'warning').length;
  const hasCritical = alertRows.some(r => r.severity === 'critical');
  const hasWarning = alertRows.some(r => r.severity === 'warning');

  if (loading && !summary) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Dialogs */}
      <DrillDownDialog
        open={drillDownOpen}
        onOpenChange={setDrillDownOpen}
        type={drillDownType || 'hb_new_violations'}
      />
      <HBLegacyCleanupDialog
        open={legacyCleanupOpen}
        onOpenChange={setLegacyCleanupOpen}
        onCleanupComplete={fetchSummary}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {isAr ? 'مراقبة المحاسبة' : 'Accounting Monitoring'}
          </h1>
          <p className="text-muted-foreground">
            {isAr 
              ? `آخر تحديث: ${lastRefresh?.toLocaleTimeString('ar-SA') ?? '-'}` 
              : `Last updated: ${lastRefresh?.toLocaleTimeString() ?? '-'}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={runGateTests} disabled={gateTestRunning} variant="outline" size="sm">
            <FlaskConical className={`h-4 w-4 mr-1 ${gateTestRunning ? 'animate-spin' : ''}`} />
            {isAr ? 'اختبارات البوابة 3-B' : 'Phase 3-B Gate Tests'}
          </Button>
          <Button onClick={() => setLegacyCleanupOpen(true)} variant="outline" size="sm">
            <History className="h-4 w-4 mr-1" />
            {isAr ? 'تنظيف السجلات القديمة' : 'Legacy Cleanup'}
          </Button>
          <Button onClick={fetchSummary} disabled={loading} variant="outline">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {isAr ? 'تحديث' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Phase 3-B Gate Test Results */}
      {gateTestVisible && (
        <Card className="border-2 border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              {isAr ? 'نتائج اختبارات البوابة 3-B' : 'Phase 3-B Gate Test Results'}
            </CardTitle>
            <CardDescription>
              {isAr ? 'مقارنة عدد الملخص مع عدد القائمة التفصيلية' : 'Comparing summary counts with drill-down list counts'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {gateTestRunning ? (
              <div className="flex items-center gap-2 py-4">
                <RefreshCw className="h-4 w-4 animate-spin" />
                {isAr ? 'جاري تشغيل الاختبارات...' : 'Running tests...'}
              </div>
            ) : gateTestResults.length > 0 ? (
              <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>KPI</TableHead>
                    <TableHead className="text-center">{isAr ? 'عدد الملخص' : 'Summary Count'}</TableHead>
                    <TableHead className="text-center">{isAr ? 'عدد القائمة' : 'Drill-Down Count'}</TableHead>
                    <TableHead className="text-center">{isAr ? 'الحالة' : 'Status'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gateTestResults.map((result) => (
                    <TableRow key={result.kpi}>
                      <TableCell className="font-mono text-sm">{result.kpi}</TableCell>
                      <TableCell className="text-center font-mono">{result.summaryCount ?? 'NULL'}</TableCell>
                      <TableCell className="text-center font-mono">{result.drillDownCount ?? 'ERROR'}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={result.status === 'PASS' ? 'default' : result.status === 'FAIL' ? 'destructive' : 'secondary'}>
                          {result.status === 'PASS' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {result.status === 'FAIL' && <AlertCircle className="h-3 w-3 mr-1" />}
                          {result.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              {/* Preformatted text block for copy-paste */}
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{isAr ? 'نص قابل للنسخ:' : 'Copy-paste output:'}</span>
                  <Button onClick={copyToClipboard} variant="outline" size="sm">
                    {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                    {copied ? (isAr ? 'تم النسخ!' : 'Copied!') : (isAr ? 'نسخ' : 'Copy')}
                  </Button>
                </div>
                <pre className="bg-muted p-3 rounded-md text-xs font-mono overflow-x-auto whitespace-pre">{getGateTestPlainText()}</pre>
              </div>
              </>
            ) : (
              <p className="text-muted-foreground py-2">{isAr ? 'انقر على الزر لتشغيل الاختبارات' : 'Click the button to run tests'}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* All Clear Banner */}
      {!hasCritical && !hasWarning && summary && (
        <Card className="bg-accent/50 border-accent">
          <CardContent className="py-4 flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-primary" />
            <span className="font-medium">
              {isAr ? 'جميع المؤشرات سليمة - لا توجد تنبيهات حرجة أو تحذيرية' : 'All Clear - No critical or warning alerts'}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Executive KPI Cards - Clickable */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Active Alerts"
          titleAr="التنبيهات النشطة"
          value={activeAlerts}
          severity={hasCritical ? 'critical' : hasWarning ? 'warning' : 'ok'}
          icon={<AlertCircle className="h-4 w-4" />}
        />
        <KPICard
          title="HB New Violations"
          titleAr="انتهاكات الحظر الجديدة"
          value={summary?.hb_new_violations ?? null}
          severity={getSeverity('hb_new_violations', summary?.hb_new_violations ?? null)}
          icon={<Shield className="h-4 w-4" />}
          onClick={() => openDrillDown('hb_new_violations')}
        />
        <KPICard
          title="Formula Mismatch"
          titleAr="عدم تطابق المعادلة"
          value={summary?.formula_mismatch_count ?? null}
          severity={getSeverity('formula_mismatch_count', summary?.formula_mismatch_count ?? null)}
          icon={<Calculator className="h-4 w-4" />}
          onClick={() => openDrillDown('formula_mismatch')}
        />
        <KPICard
          title="Stuck Workflows"
          titleAr="عمليات معلقة"
          value={summary?.stuck_workflows_count ?? null}
          severity={getSeverity('stuck_workflows_count', summary?.stuck_workflows_count ?? null)}
          icon={<Clock className="h-4 w-4" />}
          onClick={() => openDrillDown('stuck_workflows')}
        />
      </div>

      {/* Alerts Table - Clickable rows */}
      <Card>
        <CardHeader>
          <CardTitle>{isAr ? 'جدول التنبيهات' : 'Alerts Table'}</CardTitle>
          <CardDescription>
            {isAr 
              ? 'انقر على أي صف لفتح التفاصيل'
              : 'Click any row to open drill-down details'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{isAr ? 'الفئة' : 'Category'}</TableHead>
                <TableHead>{isAr ? 'المقياس' : 'Metric'}</TableHead>
                <TableHead className="text-center">{isAr ? 'القيمة' : 'Value'}</TableHead>
                <TableHead>{isAr ? 'الخطورة' : 'Severity'}</TableHead>
                <TableHead>{isAr ? 'المسؤول' : 'Owner'}</TableHead>
                <TableHead>{isAr ? 'الإجراء' : 'Action'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alertRows.map((row, idx) => (
                <TableRow 
                  key={idx} 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => openDrillDown(row.drillDownType)}
                >
                  <TableCell className="flex items-center gap-2">
                    {row.categoryIcon}
                    {row.category}
                  </TableCell>
                  <TableCell>{row.metric}</TableCell>
                  <TableCell className="text-center font-mono">{row.value ?? '-'}</TableCell>
                  <TableCell><SeverityBadge severity={row.severity} /></TableCell>
                  <TableCell>{row.owner}</TableCell>
                  <TableCell className="text-sm text-muted-foreground flex items-center gap-1">
                    {row.action}
                    <ExternalLink className="h-3 w-3 opacity-50" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Runbook Accordion */}
      <Card>
        <CardHeader>
          <CardTitle>{isAr ? 'دليل التحقيق' : 'Investigation Runbook'}</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="w-full">
            <AccordionItem value="hb">
              <AccordionTrigger className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                {isAr ? 'انتهاكات الحظر الصارم' : 'Hard Block Violations'}
              </AccordionTrigger>
              <AccordionContent className="text-sm space-y-2">
                <p><strong>{isAr ? 'المسؤول:' : 'Owner:'}</strong> {isAr ? 'المحاسبة / الإدارة' : 'Accounting / Management'}</p>
                <p><strong>{isAr ? 'الوصف:' : 'Description:'}</strong> {isAr 
                  ? 'دفعات موردين بدون توزيعات على الفواتير. بعد 2026-01-19 يتم حظرها تلقائياً.'
                  : 'Supplier payments without invoice allocations. After 2026-01-19 these are blocked automatically.'}</p>
                <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
{`SELECT p.id, p.payment_number, p.amount
FROM payments p
LEFT JOIN supplier_payment_allocations a ON a.payment_id = p.id
WHERE p.payment_type = 'payment' AND p.supplier_id IS NOT NULL
GROUP BY p.id HAVING COUNT(a.id) = 0;`}
                </pre>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="formula">
              <AccordionTrigger className="flex items-center gap-2">
                <Calculator className="h-4 w-4" />
                {isAr ? 'عدم تطابق المعادلة' : 'Formula Mismatch'}
              </AccordionTrigger>
              <AccordionContent className="text-sm space-y-2">
                <p><strong>{isAr ? 'المسؤول:' : 'Owner:'}</strong> {isAr ? 'المحاسبة' : 'Accounting'}</p>
                <p><strong>{isAr ? 'المعادلة:' : 'Formula:'}</strong> remaining = total - returned - paid</p>
                <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
{`SELECT id, invoice_number, total_amount, total_returned_amount, paid_amount, remaining_amount,
       (total_amount - COALESCE(total_returned_amount,0) - COALESCE(paid_amount,0)) AS expected
FROM invoices
WHERE ABS(remaining_amount - (total_amount - COALESCE(total_returned_amount,0) - COALESCE(paid_amount,0))) > 0.01;`}
                </pre>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="stuck">
              <AccordionTrigger className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {isAr ? 'عمليات معلقة' : 'Stuck Workflows'}
              </AccordionTrigger>
              <AccordionContent className="text-sm space-y-2">
                <p><strong>{isAr ? 'المسؤول:' : 'Owner:'}</strong> {isAr ? 'التقنية' : 'Tech'}</p>
                <p><strong>{isAr ? 'العتبة:' : 'Threshold:'}</strong> 15 {isAr ? 'دقيقة' : 'minutes'}</p>
                <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
{`SELECT client_request_id, workflow_type, status, created_at
FROM pos_workflow_requests
WHERE status = 'in_progress' AND created_at < NOW() - INTERVAL '15 minutes';`}
                </pre>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="journal">
              <AccordionTrigger className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {isAr ? 'قيود غير متوازنة' : 'Unbalanced Journal Entries'}
              </AccordionTrigger>
              <AccordionContent className="text-sm space-y-2">
                <p><strong>{isAr ? 'المسؤول:' : 'Owner:'}</strong> {isAr ? 'المحاسبة' : 'Accounting'}</p>
                <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
{`SELECT id, entry_number, total_debit, total_credit
FROM journal_entries
WHERE ABS(COALESCE(total_debit,0) - COALESCE(total_credit,0)) > 0.01;`}
                </pre>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      {/* Config Info */}
      {summary && (
        <Card>
          <CardHeader>
            <CardTitle>{isAr ? 'إعدادات المراقبة' : 'Monitoring Config'}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">{isAr ? 'تاريخ الحظر:' : 'HB Enable Date:'}</span>
              <p className="font-mono">{summary.hb_enable_date}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{isAr ? 'مهلة العمليات:' : 'Workflow Timeout:'}</span>
              <p className="font-mono">{summary.workflow_timeout_minutes} min</p>
            </div>
            <div>
              <span className="text-muted-foreground">{isAr ? 'التسامح:' : 'Tolerance:'}</span>
              <p className="font-mono">{summary.tolerance}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{isAr ? 'وقت التوليد:' : 'Generated At:'}</span>
              <p className="font-mono text-xs">{new Date(summary.generated_at).toLocaleString(isAr ? 'ar-SA' : 'en-US')}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
