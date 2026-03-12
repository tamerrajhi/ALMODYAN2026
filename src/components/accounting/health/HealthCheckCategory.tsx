import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HealthCheckIssueCard } from './HealthCheckIssue';
import type { HealthCheckIssue, HealthCheckCategory as IHealthCheckCategory } from '@/lib/accounting-health-checks';
import { categoryLabels } from '@/lib/accounting-health-checks';

interface HealthCheckCategoryProps {
  category: IHealthCheckCategory;
  issues: HealthCheckIssue[];
  summary: {
    total: number;
    passed: number;
    warnings: number;
    critical: number;
  };
  onRequestFix?: (issue: HealthCheckIssue) => void;
  isFixing?: boolean;
  fixingIssueId?: string | null;
}

export function HealthCheckCategoryCard({
  category,
  issues,
  summary,
  onRequestFix,
  isFixing,
  fixingIssueId,
}: HealthCheckCategoryProps) {
  const score = summary.total > 0 
    ? ((summary.passed / summary.total) * 100) 
    : 100;

  const getScoreColor = (s: number) => {
    if (s >= 90) return 'text-emerald-500';
    if (s >= 70) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getProgressColor = (s: number) => {
    if (s >= 90) return 'bg-emerald-500';
    if (s >= 70) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getBorderColor = (s: number) => {
    if (s >= 90) return 'border-emerald-500/20';
    if (s >= 70) return 'border-yellow-500/20';
    return 'border-red-500/20';
  };

  return (
    <div className="space-y-4">
      {/* Category Summary */}
      <Card className={cn('border', getBorderColor(score))}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{categoryLabels[category].ar}</CardTitle>
            <span className={cn('text-xl font-bold', getScoreColor(score))}>
              {score.toFixed(0)}%
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <Progress 
            value={score} 
            className={cn('h-2 mb-3', getProgressColor(score))}
          />
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-1 text-emerald-500">
              <CheckCircle2 className="w-4 h-4" />
              <span>{summary.passed} سليم</span>
            </div>
            <div className="flex items-center gap-1 text-yellow-500">
              <AlertTriangle className="w-4 h-4" />
              <span>{summary.warnings} تحذير</span>
            </div>
            <div className="flex items-center gap-1 text-red-500">
              <XCircle className="w-4 h-4" />
              <span>{summary.critical} حرج</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Issues List */}
      {issues.length > 0 ? (
        <div className="space-y-3">
          {issues.map((issue) => (
            <HealthCheckIssueCard 
              key={issue.id} 
              issue={issue}
              onRequestFix={onRequestFix}
              isFixing={isFixing && fixingIssueId === issue.issueCode}
            />
          ))}
        </div>
      ) : (
        <Card className="border border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="p-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
            <p className="text-emerald-600 font-medium">لا توجد مشاكل</p>
            <p className="text-sm text-muted-foreground">
              جميع الفحوصات في هذه الفئة سليمة
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
