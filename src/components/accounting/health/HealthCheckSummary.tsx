import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, AlertTriangle, XCircle, Activity, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HealthCheckIssue } from '@/lib/accounting-health-checks';
import { SummaryIssuesList } from './SummaryIssuesList';

interface HealthCheckSummaryProps {
  healthScore: number;
  passedChecks: number;
  warningChecks: number;
  criticalChecks: number;
  totalChecks: number;
  isLoading?: boolean;
  warningIssues?: HealthCheckIssue[];
  criticalIssues?: HealthCheckIssue[];
  onIssueClick?: (issue: HealthCheckIssue) => void;
}

export function HealthCheckSummary({
  healthScore,
  passedChecks,
  warningChecks,
  criticalChecks,
  totalChecks,
  isLoading,
  warningIssues = [],
  criticalIssues = [],
  onIssueClick,
}: HealthCheckSummaryProps) {
  const getHealthColor = (score: number) => {
    if (score >= 90) return 'text-emerald-500';
    if (score >= 70) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getHealthBg = (score: number) => {
    if (score >= 90) return 'bg-emerald-500/10 border-emerald-500/20';
    if (score >= 70) return 'bg-yellow-500/10 border-yellow-500/20';
    return 'bg-red-500/10 border-red-500/20';
  };

  const getProgressColor = (score: number) => {
    if (score >= 90) return 'bg-emerald-500';
    if (score >= 70) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const handleIssueClick = (issue: HealthCheckIssue) => {
    if (onIssueClick) {
      onIssueClick(issue);
    }
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Health Score */}
      <Card className={cn('border', getHealthBg(healthScore))}>
        <CardContent className="p-4 md:p-6">
          <div className="flex items-center gap-3">
            <div className={cn('p-2 rounded-lg', getHealthBg(healthScore))}>
              <Activity className={cn('w-5 h-5 md:w-6 md:h-6', getHealthColor(healthScore))} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs md:text-sm text-muted-foreground">نسبة الصحة</p>
              <p className={cn('text-xl md:text-2xl font-bold', getHealthColor(healthScore))}>
                {isLoading ? '--' : `${healthScore.toFixed(0)}%`}
              </p>
            </div>
          </div>
          {!isLoading && (
            <Progress 
              value={healthScore} 
              className={cn('mt-3 h-1.5', getProgressColor(healthScore))}
            />
          )}
        </CardContent>
      </Card>

      {/* Passed Checks */}
      <Card className="border border-emerald-500/20 bg-emerald-500/5">
        <CardContent className="p-4 md:p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <CheckCircle2 className="w-5 h-5 md:w-6 md:h-6 text-emerald-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs md:text-sm text-muted-foreground">سليم</p>
              <p className="text-xl md:text-2xl font-bold text-emerald-500">
                {isLoading ? '--' : passedChecks}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Warning Checks - Clickable */}
      <SummaryIssuesList
        issues={warningIssues}
        severity="warning"
        onIssueClick={handleIssueClick}
      >
        <Card className={cn(
          'border border-yellow-500/20 bg-yellow-500/5 transition-all',
          warningIssues.length > 0 && 'cursor-pointer hover:shadow-md hover:border-yellow-500/40'
        )}>
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <AlertTriangle className="w-5 h-5 md:w-6 md:h-6 text-yellow-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs md:text-sm text-muted-foreground">تحذيرات</p>
                <p className="text-xl md:text-2xl font-bold text-yellow-500">
                  {isLoading ? '--' : warningChecks}
                </p>
              </div>
            </div>
            {warningIssues.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                <ExternalLink className="w-3 h-3" />
                اضغط لعرض التفاصيل
              </div>
            )}
          </CardContent>
        </Card>
      </SummaryIssuesList>

      {/* Critical Checks - Clickable */}
      <SummaryIssuesList
        issues={criticalIssues}
        severity="critical"
        onIssueClick={handleIssueClick}
      >
        <Card className={cn(
          'border border-red-500/20 bg-red-500/5 transition-all',
          criticalIssues.length > 0 && 'cursor-pointer hover:shadow-md hover:border-red-500/40'
        )}>
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <XCircle className="w-5 h-5 md:w-6 md:h-6 text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs md:text-sm text-muted-foreground">حرج</p>
                <p className="text-xl md:text-2xl font-bold text-red-500">
                  {isLoading ? '--' : criticalChecks}
                </p>
              </div>
            </div>
            {criticalIssues.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 mt-2">
                <ExternalLink className="w-3 h-3" />
                اضغط لعرض التفاصيل
              </div>
            )}
          </CardContent>
        </Card>
      </SummaryIssuesList>
    </div>
  );
}
