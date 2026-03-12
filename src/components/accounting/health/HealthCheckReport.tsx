import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FileText,
  Download,
  Calendar,
  User,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Printer,
} from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import type { HealthCheckResult } from '@/lib/accounting-health-checks';
import { categoryLabels } from '@/lib/accounting-health-checks';

interface HealthCheckReportProps {
  result: HealthCheckResult | null;
  onExport?: () => void;
  onPrint?: () => void;
}

export function HealthCheckReport({ result, onExport, onPrint }: HealthCheckReportProps) {
  if (!result) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>لا توجد نتائج فحص</p>
          <p className="text-sm">قم بتشغيل فحص جديد لعرض التقرير</p>
        </CardContent>
      </Card>
    );
  }

  const formatDate = (date: Date | undefined) => {
    if (!date) return '-';
    return format(date, 'dd MMMM yyyy - HH:mm', { locale: ar });
  };

  const formatAmount = (amount?: number) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
    }).format(amount);
  };

  const criticalIssues = result.issues.filter(i => i.severity === 'critical');
  const warningIssues = result.issues.filter(i => i.severity === 'warning');
  const fixableIssues = result.issues.filter(i => i.canAutoFix);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            تقرير صحة النظام المحاسبي
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            رقم الجلسة: {result.runNumber}
          </p>
        </div>
        <div className="flex gap-2">
          {onPrint && (
            <Button variant="outline" size="sm" onClick={onPrint}>
              <Printer className="w-4 h-4 ml-2" />
              طباعة
            </Button>
          )}
          {onExport && (
            <Button variant="outline" size="sm" onClick={onExport}>
              <Download className="w-4 h-4 ml-2" />
              تصدير
            </Button>
          )}
        </div>
      </CardHeader>
      
      <CardContent>
        <ScrollArea className="h-[500px] pl-4">
          {/* Executive Summary */}
          <section className="mb-6">
            <h3 className="text-lg font-semibold mb-3">📈 ملخص تنفيذي</h3>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  تاريخ الفحص
                </div>
                <p className="font-medium mt-1">{formatDate(result.startedAt)}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  مدة الفحص
                </div>
                <p className="font-medium mt-1">
                  {result.completedAt 
                    ? `${Math.round((result.completedAt.getTime() - result.startedAt.getTime()) / 1000)} ثانية`
                    : '-'}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-sm text-muted-foreground">الوضع</div>
                <Badge variant="outline" className="mt-1">
                  {result.mode === 'read_only' ? 'قراءة فقط' : 'مع الإصلاحات'}
                </Badge>
              </div>
              <div className={`p-3 rounded-lg ${
                result.healthScore >= 90 ? 'bg-emerald-500/10' :
                result.healthScore >= 70 ? 'bg-yellow-500/10' : 'bg-red-500/10'
              }`}>
                <div className="text-sm text-muted-foreground">نسبة الصحة</div>
                <p className={`text-2xl font-bold mt-1 ${
                  result.healthScore >= 90 ? 'text-emerald-500' :
                  result.healthScore >= 70 ? 'text-yellow-500' : 'text-red-500'
                }`}>
                  {result.healthScore.toFixed(0)}%
                </p>
              </div>
            </div>

            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>سليم: {result.passedChecks}</span>
              </div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                <span>تحذيرات: {result.warningChecks}</span>
              </div>
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-500" />
                <span>حرج: {result.criticalChecks}</span>
              </div>
            </div>
          </section>

          <Separator className="my-4" />

          {/* Critical Issues */}
          {criticalIssues.length > 0 && (
            <section className="mb-6">
              <h3 className="text-lg font-semibold mb-3 text-red-500 flex items-center gap-2">
                <XCircle className="w-5 h-5" />
                🔴 المشاكل الحرجة ({criticalIssues.length})
              </h3>
              <div className="space-y-3">
                {criticalIssues.map((issue, idx) => (
                  <div key={issue.id} className="p-3 rounded-lg border border-red-500/20 bg-red-500/5">
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-red-500">{idx + 1}.</span>
                      <div>
                        <p className="font-medium">{issue.title}</p>
                        <p className="text-sm text-muted-foreground">{issue.description}</p>
                        <div className="flex items-center gap-4 mt-2 text-sm">
                          <span>السجلات: {issue.affectedRecords}</span>
                          {issue.affectedAmount && (
                            <span>القيمة: {formatAmount(issue.affectedAmount)}</span>
                          )}
                          {issue.canAutoFix && (
                            <Badge variant="outline" className="text-xs">
                              قابل للإصلاح الآلي
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Warnings */}
          {warningIssues.length > 0 && (
            <section className="mb-6">
              <h3 className="text-lg font-semibold mb-3 text-yellow-500 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                🟠 التحذيرات ({warningIssues.length})
              </h3>
              <div className="space-y-2">
                {warningIssues.map((issue, idx) => (
                  <div key={issue.id} className="p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5">
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-yellow-500">{idx + 1}.</span>
                      <div>
                        <p className="font-medium">{issue.title}</p>
                        <p className="text-sm text-muted-foreground">{issue.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <Separator className="my-4" />

          {/* Action Plan */}
          <section className="mb-6">
            <h3 className="text-lg font-semibold mb-3">📋 خطة العمل المقترحة</h3>
            
            {result.issues.length === 0 ? (
              <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <p className="text-emerald-600 font-medium">النظام سليم!</p>
                <p className="text-sm text-muted-foreground">
                  لا توجد مشاكل تحتاج إلى إصلاح
                </p>
              </div>
            ) : (
              <ol className="space-y-2 mr-4">
                {criticalIssues.map((issue, idx) => (
                  <li key={issue.id} className="text-sm">
                    <span className="font-medium text-red-500">[أولوية عالية]</span>{' '}
                    {issue.title}
                    {issue.canAutoFix && ' ← يمكن الإصلاح الآلي'}
                  </li>
                ))}
                {warningIssues.map((issue, idx) => (
                  <li key={issue.id} className="text-sm">
                    <span className="font-medium text-yellow-500">[أولوية متوسطة]</span>{' '}
                    {issue.title}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Fixable Summary */}
          {fixableIssues.length > 0 && (
            <section className="mb-6">
              <h3 className="text-lg font-semibold mb-3">🔧 الإصلاحات الآلية المتاحة</h3>
              <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <p className="text-sm mb-2">
                  يمكن إصلاح <strong>{fixableIssues.length}</strong> مشكلة آلياً
                </p>
                <p className="text-sm text-muted-foreground">
                  ⚠️ يتطلب الإصلاح الآلي موافقة صريحة وإنشاء نسخة احتياطية أولاً
                </p>
              </div>
            </section>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
