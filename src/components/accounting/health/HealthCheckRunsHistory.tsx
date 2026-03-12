import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  User,
  Calendar,
  Search,
  ExternalLink,
  Play,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ar } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { HealthCheckIssue, HealthCheckCategory } from '@/lib/accounting-health-checks';
import { categoryLabels } from '@/lib/accounting-health-checks';
import { IssueDetailsDialog } from './IssueDetailsDialog';

interface HealthCheckRun {
  id: string;
  run_number: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  mode: string;
  health_score: number | null;
  total_checks: number | null;
  passed_checks: number | null;
  warning_checks: number | null;
  critical_checks: number | null;
  started_by_name: string | null;
  categories_checked: string[] | null;
  summary: Record<string, any> | null;
}

interface HealthCheckRunResult {
  id: string;
  run_id: string;
  issue_code: string;
  title: string;
  description: string;
  severity: string;
  category: string;
  affected_records: number | null;
  affected_amount: number | null;
  can_auto_fix: boolean | null;
  auto_fix_function: string | null;
  fix_status: string | null;
  details: any[] | null;
}

interface HealthCheckRunsHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRerunCheck?: (runId: string, categories: HealthCheckCategory[]) => void;
}

export function HealthCheckRunsHistory({ open, onOpenChange, onRerunCheck }: HealthCheckRunsHistoryProps) {
  const [runs, setRuns] = useState<HealthCheckRun[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRun, setSelectedRun] = useState<HealthCheckRun | null>(null);
  const [runResults, setRunResults] = useState<HealthCheckRunResult[]>([]);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<HealthCheckIssue | null>(null);
  const [showIssueDetails, setShowIssueDetails] = useState(false);

  const fetchRuns = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/health-check-runs', { credentials: 'include' });
      if (!res.ok && res.status === 501) { setRuns([]); return; }
      if (!res.ok) { setRuns([]); return; }
      const data = await res.json();
      setRuns((data as HealthCheckRun[]) || []);
    } catch (error) {
      console.error('Failed to fetch runs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchRunResults = async (runId: string) => {
    setIsLoadingResults(true);
    try {
      const res = await fetch(`/api/health-check-results/${runId}`, { credentials: 'include' });
      if (!res.ok && res.status === 501) { setRunResults([]); return; }
      if (!res.ok) { setRunResults([]); return; }
      const data = await res.json();
      setRunResults((data as HealthCheckRunResult[]) || []);
    } catch (error) {
      console.error('Failed to fetch run results:', error);
    } finally {
      setIsLoadingResults(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchRuns();
    }
  }, [open]);

  useEffect(() => {
    if (selectedRun) {
      fetchRunResults(selectedRun.id);
    }
  }, [selectedRun]);

  const formatDate = (date: string) => {
    return format(new Date(date), 'dd/MM/yyyy HH:mm', { locale: ar });
  };

  const getStatusConfig = (run: HealthCheckRun) => {
    const critical = run.critical_checks || 0;
    const warnings = run.warning_checks || 0;

    if (run.status !== 'completed') {
      return { color: 'bg-muted', label: 'قيد التنفيذ', icon: RefreshCw };
    }
    if (critical > 0) {
      return { color: 'bg-red-500/10 text-red-500 border-red-500/20', label: 'به مشاكل', icon: XCircle };
    }
    if (warnings > 0) {
      return { color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20', label: 'تحذيرات', icon: AlertTriangle };
    }
    return { color: 'bg-green-500/10 text-green-500 border-green-500/20', label: 'سليم', icon: CheckCircle };
  };

  const calculateDuration = (start: string, end: string | null) => {
    if (!end) return '-';
    const startDate = new Date(start);
    const endDate = new Date(end);
    const seconds = Math.round((endDate.getTime() - startDate.getTime()) / 1000);
    if (seconds < 60) return `${seconds} ثانية`;
    return `${Math.floor(seconds / 60)} دقيقة`;
  };

  const handleRowClick = (run: HealthCheckRun) => {
    setSelectedRun(run);
  };

  const handleIssueClick = (result: HealthCheckRunResult) => {
    const issue: HealthCheckIssue = {
      id: result.id,
      issueCode: result.issue_code,
      title: result.title,
      description: result.description,
      severity: result.severity as 'critical' | 'warning' | 'info',
      category: result.category as HealthCheckCategory,
      affectedRecords: result.affected_records || 0,
      affectedAmount: result.affected_amount || undefined,
      canAutoFix: result.can_auto_fix || false,
      autoFixFunction: result.auto_fix_function || undefined,
      details: result.details || [],
    };
    setSelectedIssue(issue);
    setShowIssueDetails(true);
  };

  const handleRerunCheck = () => {
    if (selectedRun && onRerunCheck) {
      const categories = (selectedRun.categories_checked || []) as HealthCheckCategory[];
      onRerunCheck(selectedRun.id, categories);
      onOpenChange(false);
    }
  };

  const filteredRuns = runs.filter(run =>
    run.run_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
    run.started_by_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default:
        return <CheckCircle className="w-4 h-4 text-blue-500" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-500/10 text-red-600 border-red-500/20';
      case 'warning':
        return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
      default:
        return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    }
  };

  const formatCurrency = (amount: number | null) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
    }).format(amount);
  };

  return (
    <>
      <Dialog open={open && !selectedRun} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              سجل جلسات التدقيق المحاسبي
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2 py-2">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث برقم الجلسة أو اسم المستخدم..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={fetchRuns} disabled={isLoading}>
              <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">رقم الجلسة</TableHead>
                  <TableHead className="text-right">التاريخ والوقت</TableHead>
                  <TableHead className="text-right">المستخدم</TableHead>
                  <TableHead className="text-right">المدة</TableHead>
                  <TableHead className="text-right">نسبة الصحة</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-center w-[80px]">عرض</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : filteredRuns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      لا توجد جلسات تدقيق
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRuns.map((run) => {
                    const statusConfig = getStatusConfig(run);
                    const StatusIcon = statusConfig.icon;

                    return (
                      <TableRow
                        key={run.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleRowClick(run)}
                      >
                        <TableCell className="font-mono text-sm">{run.run_number}</TableCell>
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-muted-foreground" />
                            {formatDate(run.started_at)}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3 text-muted-foreground" />
                            {run.started_by_name || '-'}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {calculateDuration(run.started_at, run.completed_at)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-muted rounded-full h-2">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  (run.health_score || 0) >= 90 ? "bg-green-500" :
                                  (run.health_score || 0) >= 70 ? "bg-yellow-500" : "bg-red-500"
                                )}
                                style={{ width: `${run.health_score || 0}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium">{run.health_score?.toFixed(1)}%</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusConfig.color}>
                            <StatusIcon className="w-3 h-3 ml-1" />
                            {statusConfig.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedRun} onOpenChange={(open) => !open && setSelectedRun(null)}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                تفاصيل جلسة التدقيق: {selectedRun?.run_number}
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleRerunCheck} className="gap-2">
                  <Play className="w-4 h-4" />
                  إعادة التشغيل
                </Button>
              </div>
            </div>
          </DialogHeader>

          {selectedRun && (
            <div className="flex-1 overflow-auto space-y-6">
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-base">معلومات الجلسة</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">رقم الجلسة</p>
                    <p className="font-mono text-sm">{selectedRun.run_number}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">تاريخ التنفيذ</p>
                    <p className="text-sm">{formatDate(selectedRun.started_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">المستخدم المنفذ</p>
                    <p className="text-sm">{selectedRun.started_by_name || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">نوع الفحص</p>
                    <p className="text-sm">تدقيق مالي داخلي</p>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
                  <CardContent className="p-4 text-center">
                    <p className="text-3xl font-bold text-primary">{selectedRun.health_score?.toFixed(1)}%</p>
                    <p className="text-xs text-muted-foreground">نسبة الصحة</p>
                  </CardContent>
                </Card>
                <Card className="bg-muted/50">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">{selectedRun.total_checks || 0}</p>
                    <p className="text-xs text-muted-foreground">إجمالي الفحوصات</p>
                  </CardContent>
                </Card>
                <Card className="bg-green-500/10">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-600">{selectedRun.passed_checks || 0}</p>
                    <p className="text-xs text-green-600">ناجحة</p>
                  </CardContent>
                </Card>
                <Card className="bg-yellow-500/10">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-yellow-600">{selectedRun.warning_checks || 0}</p>
                    <p className="text-xs text-yellow-600">تحذيرات</p>
                  </CardContent>
                </Card>
                <Card className="bg-red-500/10">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-red-600">{selectedRun.critical_checks || 0}</p>
                    <p className="text-xs text-red-600">حرجة</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    نتائج الفحص ({runResults.length} بند)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoadingResults ? (
                    <div className="flex items-center justify-center py-8">
                      <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : runResults.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
                      <p>لا توجد مشاكل - النظام سليم</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {runResults.map((result) => (
                        <Card
                          key={result.id}
                          className={cn(
                            "p-4 cursor-pointer hover:shadow-md transition-all",
                            getSeverityColor(result.severity)
                          )}
                          onClick={() => handleIssueClick(result)}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-3">
                              {getSeverityIcon(result.severity)}
                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="font-medium">{result.title}</h4>
                                  <Badge variant="outline" className="text-xs">
                                    {result.issue_code}
                                  </Badge>
                                  <Badge variant="secondary" className="text-xs">
                                    {categoryLabels[result.category as HealthCheckCategory]?.ar || result.category}
                                  </Badge>
                                </div>
                                <p className="text-sm text-muted-foreground mt-1">{result.description}</p>
                                <div className="flex items-center gap-4 mt-2 text-sm">
                                  <span>السجلات: <strong>{result.affected_records}</strong></span>
                                  {result.affected_amount && (
                                    <span>القيمة: <strong>{formatCurrency(result.affected_amount)}</strong></span>
                                  )}
                                  {result.fix_status && (
                                    <Badge variant="outline" className="text-xs">
                                      {result.fix_status === 'fixed' ? 'تم الإصلاح' : 'معلق'}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                            <Button variant="ghost" size="sm" className="gap-1">
                              <ExternalLink className="w-4 h-4" />
                              عرض التفاصيل
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {selectedIssue && (
        <IssueDetailsDialog
          open={showIssueDetails}
          onOpenChange={setShowIssueDetails}
          issue={selectedIssue}
        />
      )}
    </>
  );
}
