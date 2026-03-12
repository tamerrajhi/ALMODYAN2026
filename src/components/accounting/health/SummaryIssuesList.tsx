import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, XCircle, ChevronLeft, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HealthCheckIssue, HealthCheckSeverity } from '@/lib/accounting-health-checks';

interface SummaryIssuesListProps {
  issues: HealthCheckIssue[];
  severity: 'warning' | 'critical';
  onIssueClick: (issue: HealthCheckIssue) => void;
  children: React.ReactNode;
}

const severityConfig: Record<'warning' | 'critical', { icon: typeof XCircle; color: string; bg: string; title: string }> = {
  critical: {
    icon: XCircle,
    color: 'text-red-500',
    bg: 'bg-red-50 dark:bg-red-950/30',
    title: 'المشاكل الحرجة',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-yellow-500',
    bg: 'bg-yellow-50 dark:bg-yellow-950/30',
    title: 'التحذيرات',
  },
};

export function SummaryIssuesList({ issues, severity, onIssueClick, children }: SummaryIssuesListProps) {
  const config = severityConfig[severity];
  const Icon = config.icon;

  if (issues.length === 0) {
    return <>{children}</>;
  }

  const formatAmount = (amount?: number) => {
    if (!amount) return null;
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
    }).format(amount);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <div className={cn('p-3 border-b', config.bg)}>
          <div className="flex items-center gap-2">
            <Icon className={cn('w-5 h-5', config.color)} />
            <h4 className="font-medium">{config.title}</h4>
            <Badge variant="secondary" className="mr-auto">
              {issues.length}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            اضغط على أي مشكلة لعرض السجلات المتأثرة
          </p>
        </div>
        <ScrollArea className="max-h-80">
          <div className="p-2 space-y-1">
            {issues.map((issue) => (
              <Button
                key={issue.id}
                variant="ghost"
                className="w-full justify-start text-right h-auto py-3 px-3 hover:bg-muted/80"
                onClick={() => onIssueClick(issue)}
              >
                <div className="flex items-start gap-2 w-full">
                  <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', config.color)} />
                  <div className="flex-1 min-w-0 text-right">
                    <p className="font-medium text-sm truncate">{issue.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {issue.affectedRecords} سجل
                      </Badge>
                      {issue.affectedAmount && (
                        <Badge variant="secondary" className="text-xs">
                          {formatAmount(issue.affectedAmount)}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                </div>
              </Button>
            ))}
          </div>
        </ScrollArea>
        <div className="p-2 border-t bg-muted/30">
          <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
            <ExternalLink className="w-3 h-3" />
            اضغط للوصول المباشر للسجلات
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
