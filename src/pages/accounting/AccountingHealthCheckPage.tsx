import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  Play, 
  Download, 
  History, 
  CheckCircle, 
  AlertTriangle, 
  XCircle,
  Activity,
  Loader2,
  Wrench,
  ExternalLink
} from 'lucide-react';
import { toast } from 'sonner';
import { 
  runHealthCheck, 
  type HealthCheckResult,
  type HealthCheckCategory,
  type HealthCheckIssue,
  categoryLabels 
} from '@/lib/accounting-health-checks';
import { executeAutoFix, type FixResult } from '@/lib/accounting-health-fixes';
import { HealthCheckSummary } from '@/components/accounting/health/HealthCheckSummary';
import { HealthCheckCategoryCard } from '@/components/accounting/health/HealthCheckCategory';
import { HealthCheckAuditLog } from '@/components/accounting/health/HealthCheckAuditLog';
import { HealthCheckReport } from '@/components/accounting/health/HealthCheckReport';
import { IssueDetailsDialog } from '@/components/accounting/health/IssueDetailsDialog';

const AccountingHealthCheckPage = () => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<HealthCheckResult | null>(null);
  const [activeTab, setActiveTab] = useState<string>('summary');
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [fixingIssueId, setFixingIssueId] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<HealthCheckIssue | null>(null);
  const [showIssueDetails, setShowIssueDetails] = useState(false);

  const handleIssueClick = (issue: HealthCheckIssue) => {
    setSelectedIssue(issue);
    setShowIssueDetails(true);
  };

  const handleRunCheck = async () => {
    setIsRunning(true);
    try {
      const checkResult = await runHealthCheck({
        mode: 'read_only',
        categories: Object.keys(categoryLabels) as HealthCheckCategory[],
        userId: user?.id,
      });
      setResult(checkResult);
      toast.success(language === 'ar' ? 'تم إكمال الفحص بنجاح' : 'Health check completed');
    } catch (error) {
      console.error('Health check error:', error);
      toast.error(language === 'ar' ? 'حدث خطأ أثناء الفحص' : 'Error running health check');
    } finally {
      setIsRunning(false);
    }
  };

  const handleFixIssue = async (issue: HealthCheckIssue) => {
    if (!issue.canAutoFix || !issue.autoFixFunction) {
      toast.error(language === 'ar' ? 'هذه المشكلة لا تدعم الإصلاح التلقائي' : 'This issue does not support auto-fix');
      return;
    }

    setIsFixing(true);
    setFixingIssueId(issue.issueCode);
    
    try {
      const fixResult = await executeAutoFix(issue);
      
      if (fixResult.success) {
        toast.success(
          language === 'ar' 
            ? `تم إصلاح ${fixResult.fixedCount} سجل بنجاح` 
            : `Successfully fixed ${fixResult.fixedCount} records`
        );
        // Re-run health check to see updated results
        await handleRunCheck();
      } else {
        toast.error(
          language === 'ar'
            ? `فشل الإصلاح: ${fixResult.errors.join(', ')}`
            : `Fix failed: ${fixResult.errors.join(', ')}`
        );
      }
    } catch (error) {
      console.error('Fix error:', error);
      toast.error(language === 'ar' ? 'حدث خطأ أثناء الإصلاح' : 'Error during fix');
    } finally {
      setIsFixing(false);
      setFixingIssueId(null);
    }
  };

  const handleFixAllIssues = async () => {
    if (!result) return;
    
    const fixableIssues = result.issues.filter(i => i.canAutoFix);
    if (fixableIssues.length === 0) {
      toast.info(language === 'ar' ? 'لا توجد مشاكل قابلة للإصلاح التلقائي' : 'No auto-fixable issues found');
      return;
    }

    setIsFixing(true);
    let totalFixed = 0;
    let totalFailed = 0;

    try {
      for (const issue of fixableIssues) {
        setFixingIssueId(issue.issueCode);
        const fixResult = await executeAutoFix(issue);
        totalFixed += fixResult.fixedCount;
        totalFailed += fixResult.failedCount;
      }

      if (totalFixed > 0) {
        toast.success(
          language === 'ar' 
            ? `تم إصلاح ${totalFixed} سجل بنجاح` 
            : `Successfully fixed ${totalFixed} records`
        );
      }
      if (totalFailed > 0) {
        toast.warning(
          language === 'ar'
            ? `فشل إصلاح ${totalFailed} سجل`
            : `Failed to fix ${totalFailed} records`
        );
      }
      
      // Re-run health check
      await handleRunCheck();
    } catch (error) {
      console.error('Fix all error:', error);
      toast.error(language === 'ar' ? 'حدث خطأ أثناء الإصلاح' : 'Error during fix');
    } finally {
      setIsFixing(false);
      setFixingIssueId(null);
    }
  };

  const categories: HealthCheckCategory[] = [
    'journal_entries',
    'sales',
    'purchases',
    'payments',
    'returns',
    'balances',
    'inventory',
    'trial_balance'
  ];

  const getCategoryIssues = (category: HealthCheckCategory) => {
    if (!result) return [];
    return result.issues.filter(issue => issue.category === category);
  };

  const getCategorySummary = (category: HealthCheckCategory) => {
    if (!result) return { total: 0, passed: 0, warnings: 0, critical: 0 };
    return result.categorySummary[category] || { total: 0, passed: 0, warnings: 0, critical: 0 };
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {language === 'ar' ? 'نظام تدقيق الحسابات' : 'Accounting Health Check'}
            </h1>
            <p className="text-muted-foreground mt-1">
              {language === 'ar' 
                ? 'فحص شامل للمعاملات المحاسبية واكتشاف الاختلالات'
                : 'Comprehensive check for accounting transactions and discrepancies'}
            </p>
          </div>
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowAuditLog(true)}
            >
              <History className="w-4 h-4 ml-2" />
              {language === 'ar' ? 'سجل وجلسات التدقيق' : 'Audit Log & Sessions'}
            </Button>
            
            {result && (
              <Button
                variant="outline"
                onClick={() => setShowReport(true)}
              >
                <Download className="w-4 h-4 ml-2" />
                {language === 'ar' ? 'تصدير التقرير' : 'Export Report'}
              </Button>
            )}
            
            {result && result.issues.filter(i => i.canAutoFix).length > 0 && (
              <Button 
                variant="default"
                onClick={handleFixAllIssues}
                disabled={isFixing || isRunning}
                className="bg-green-600 hover:bg-green-700"
              >
                {isFixing ? (
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                ) : (
                  <Wrench className="w-4 h-4 ml-2" />
                )}
                {language === 'ar' 
                  ? (isFixing ? 'جاري الإصلاح...' : 'إصلاح جميع المشاكل')
                  : (isFixing ? 'Fixing...' : 'Fix All Issues')}
              </Button>
            )}
            
            <Button 
              onClick={handleRunCheck}
              disabled={isRunning || isFixing}
            >
              {isRunning ? (
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 ml-2" />
              )}
              {language === 'ar' 
                ? (isRunning ? 'جاري الفحص...' : 'تشغيل فحص جديد')
                : (isRunning ? 'Running...' : 'Run New Check')}
            </Button>
          </div>
        </div>

        {/* Mode Indicator */}
        <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
              <Activity className="w-5 h-5" />
              <span className="font-medium">
                {language === 'ar' 
                  ? 'وضع القراءة فقط (Read-Only Mode) - لن يتم إجراء أي تعديلات'
                  : 'Read-Only Mode - No modifications will be made'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        {result && (
          <HealthCheckSummary
            healthScore={result.healthScore}
            passedChecks={result.passedChecks}
            warningChecks={result.warningChecks}
            criticalChecks={result.criticalChecks}
            totalChecks={result.totalChecks}
            isLoading={isRunning}
            warningIssues={result.issues.filter(i => i.severity === 'warning')}
            criticalIssues={result.issues.filter(i => i.severity === 'critical')}
            onIssueClick={handleIssueClick}
          />
        )}

        {/* No Results State */}
        {!result && !isRunning && (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <Activity className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {language === 'ar' ? 'لم يتم إجراء أي فحص بعد' : 'No check has been run yet'}
              </h3>
              <p className="text-muted-foreground mb-4">
                {language === 'ar' 
                  ? 'اضغط على "تشغيل فحص جديد" لبدء تحليل النظام المحاسبي'
                  : 'Click "Run New Check" to start analyzing the accounting system'}
              </p>
              <Button onClick={handleRunCheck}>
                <Play className="w-4 h-4 ml-2" />
                {language === 'ar' ? 'تشغيل الفحص الأول' : 'Run First Check'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Loading State */}
        {isRunning && (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <Loader2 className="w-16 h-16 text-primary animate-spin mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {language === 'ar' ? 'جاري فحص النظام المحاسبي...' : 'Analyzing accounting system...'}
              </h3>
              <p className="text-muted-foreground">
                {language === 'ar' 
                  ? 'يرجى الانتظار، قد يستغرق هذا بضع ثوان'
                  : 'Please wait, this may take a few seconds'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Results Tabs */}
        {result && !isRunning && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="summary" className="gap-2">
                <Activity className="w-4 h-4" />
                {language === 'ar' ? 'ملخص' : 'Summary'}
              </TabsTrigger>
              {categories.map(category => {
                const issues = getCategoryIssues(category);
                const criticalCount = issues.filter(i => i.severity === 'critical').length;
                const warningCount = issues.filter(i => i.severity === 'warning').length;
                
                return (
                  <TabsTrigger key={category} value={category} className="gap-2">
                    {categoryLabels[category][language === 'ar' ? 'ar' : 'en']}
                    {criticalCount > 0 && (
                      <Badge variant="destructive" className="ml-1 h-5 px-1.5">
                        {criticalCount}
                      </Badge>
                    )}
                    {warningCount > 0 && criticalCount === 0 && (
                      <Badge variant="secondary" className="ml-1 h-5 px-1.5 bg-yellow-100 text-yellow-800">
                        {warningCount}
                      </Badge>
                    )}
                    {criticalCount === 0 && warningCount === 0 && issues.length === 0 && (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <TabsContent value="summary" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5" />
                    {language === 'ar' ? 'ملخص تنفيذي' : 'Executive Summary'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-950/30">
                      <CheckCircle className="w-8 h-8 text-green-500" />
                      <div>
                        <p className="text-2xl font-bold text-green-700 dark:text-green-300">
                          {result.passedChecks}
                        </p>
                        <p className="text-sm text-green-600 dark:text-green-400">
                          {language === 'ar' ? 'فحص ناجح' : 'Passed Checks'}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow-50 dark:bg-yellow-950/30">
                      <AlertTriangle className="w-8 h-8 text-yellow-500" />
                      <div>
                        <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">
                          {result.warningChecks}
                        </p>
                        <p className="text-sm text-yellow-600 dark:text-yellow-400">
                          {language === 'ar' ? 'تحذيرات' : 'Warnings'}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-950/30">
                      <XCircle className="w-8 h-8 text-red-500" />
                      <div>
                        <p className="text-2xl font-bold text-red-700 dark:text-red-300">
                          {result.criticalChecks}
                        </p>
                        <p className="text-sm text-red-600 dark:text-red-400">
                          {language === 'ar' ? 'مشاكل حرجة' : 'Critical Issues'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* All Issues List */}
                  <div className="mt-6">
                    <h4 className="font-medium mb-4">
                      {language === 'ar' ? 'جميع المشاكل المكتشفة' : 'All Discovered Issues'}
                    </h4>
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-3">
                        {result.issues
                          .sort((a, b) => {
                            const severityOrder = { critical: 0, warning: 1, info: 2 };
                            return severityOrder[a.severity] - severityOrder[b.severity];
                          })
                          .map((issue) => (
                             <Card 
                              key={issue.id} 
                              className="p-4 cursor-pointer hover:bg-muted/50 hover:shadow-sm transition-all"
                              onClick={() => handleIssueClick(issue)}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex items-start gap-3">
                                  {issue.severity === 'critical' && (
                                    <XCircle className="w-5 h-5 text-red-500 mt-0.5" />
                                  )}
                                  {issue.severity === 'warning' && (
                                    <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />
                                  )}
                                  {issue.severity === 'info' && (
                                    <CheckCircle className="w-5 h-5 text-blue-500 mt-0.5" />
                                  )}
                                  <div>
                                    <h5 className="font-medium">{issue.title}</h5>
                                    <p className="text-sm text-muted-foreground mt-1">
                                      {issue.description}
                                    </p>
                                    <div className="flex gap-2 mt-2">
                                      <Badge variant="outline">
                                        {categoryLabels[issue.category]?.[language === 'ar' ? 'ar' : 'en'] || issue.category}
                                      </Badge>
                                      <Badge variant="secondary">
                                        {issue.affectedRecords} {language === 'ar' ? 'سجل' : 'records'}
                                      </Badge>
                                      {issue.affectedAmount && (
                                        <Badge variant="secondary">
                                          {issue.affectedAmount.toLocaleString()} {language === 'ar' ? 'ر.س' : 'SAR'}
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1 text-xs text-primary mt-2">
                                      <ExternalLink className="w-3 h-3" />
                                      اضغط لعرض السجلات المتأثرة
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </Card>
                          ))}
                        {result.issues.length === 0 && (
                          <div className="text-center py-8 text-muted-foreground">
                            <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
                            {language === 'ar' ? 'لا توجد مشاكل مكتشفة!' : 'No issues discovered!'}
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {categories.map(category => (
              <TabsContent key={category} value={category}>
                <HealthCheckCategoryCard
                  category={category}
                  issues={getCategoryIssues(category)}
                  summary={getCategorySummary(category)}
                  onRequestFix={handleFixIssue}
                  isFixing={isFixing}
                  fixingIssueId={fixingIssueId}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}

        {/* Audit Log Dialog */}
        <Dialog open={showAuditLog} onOpenChange={setShowAuditLog}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle>
                {language === 'ar' ? 'سجل التدقيق المحاسبي' : 'Accounting Audit Log'}
              </DialogTitle>
            </DialogHeader>
            <HealthCheckAuditLog onRerunCheck={() => {
              setShowAuditLog(false);
              handleRunCheck();
            }} />
          </DialogContent>
        </Dialog>

        {/* Report Dialog */}
        <Dialog open={showReport} onOpenChange={setShowReport}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>
                {language === 'ar' ? 'تقرير صحة النظام المحاسبي' : 'Accounting Health Report'}
              </DialogTitle>
            </DialogHeader>
            <HealthCheckReport result={result} />
          </DialogContent>
        </Dialog>

        {/* Issue Details Dialog */}
        {selectedIssue && (
          <IssueDetailsDialog
            open={showIssueDetails}
            onOpenChange={setShowIssueDetails}
            issue={selectedIssue}
          />
        )}
      </div>
    </MainLayout>
  );
};

export default AccountingHealthCheckPage;
