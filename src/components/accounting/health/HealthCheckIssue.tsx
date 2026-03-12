import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertTriangle,
  XCircle,
  Info,
  ChevronDown,
  Wrench,
  FileText,
  ExternalLink,
  Loader2,
  List,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HealthCheckIssue as IHealthCheckIssue, HealthCheckSeverity } from '@/lib/accounting-health-checks';
import { HealthCheckFixConfirm } from './HealthCheckFixConfirm';
import { IssueDetailsDialog } from './IssueDetailsDialog';

interface HealthCheckIssueProps {
  issue: IHealthCheckIssue;
  onRequestFix?: (issue: IHealthCheckIssue) => void;
  isFixing?: boolean;
}

const severityConfig: Record<HealthCheckSeverity, { icon: typeof XCircle; color: string; bg: string; label: string }> = {
  critical: {
    icon: XCircle,
    color: 'text-red-500',
    bg: 'bg-red-500/10 border-red-500/20',
    label: 'حرج',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-yellow-500',
    bg: 'bg-yellow-500/10 border-yellow-500/20',
    label: 'تحذير',
  },
  info: {
    icon: Info,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10 border-blue-500/20',
    label: 'معلومات',
  },
};

export function HealthCheckIssueCard({ issue, onRequestFix, isFixing }: HealthCheckIssueProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showFixDialog, setShowFixDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  
  const config = severityConfig[issue.severity];
  const Icon = config.icon;

  const formatAmount = (amount?: number) => {
    if (!amount) return null;
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
    }).format(amount);
  };

  const handleFixRequest = () => {
    setShowFixDialog(true);
  };

  const handleConfirmFix = () => {
    setShowFixDialog(false);
    if (onRequestFix) {
      onRequestFix(issue);
    }
  };

  const handleViewDetails = () => {
    setShowDetailsDialog(true);
  };

  return (
    <>
      <Card className={cn('border', config.bg)}>
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-start gap-3">
                <div className={cn('p-2 rounded-lg', config.bg)}>
                  <Icon className={cn('w-5 h-5', config.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base">{issue.title}</CardTitle>
                    <Badge variant="outline" className={cn('text-xs', config.color)}>
                      {config.label}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {issue.issueCode}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {issue.description}
                  </p>
                  <div className="flex items-center gap-4 mt-2 text-sm">
                    <span className="text-muted-foreground">
                      السجلات المتأثرة: <strong>{issue.affectedRecords}</strong>
                    </span>
                    {issue.affectedAmount && (
                      <span className="text-muted-foreground">
                        القيمة: <strong className={config.color}>{formatAmount(issue.affectedAmount)}</strong>
                      </span>
                    )}
                  </div>
                </div>
                <ChevronDown className={cn(
                  'w-5 h-5 text-muted-foreground transition-transform',
                  isOpen && 'rotate-180'
                )} />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          
          <CollapsibleContent>
            <CardContent className="pt-0">
              {/* Details Table */}
              {issue.details && issue.details.length > 0 && (
                <div className="mb-4 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {Object.keys(issue.details[0]).slice(0, 5).map(key => (
                          <TableHead key={key} className="text-right">{key}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {issue.details.slice(0, 5).map((detail, idx) => (
                        <TableRow key={idx}>
                          {Object.values(detail).slice(0, 5).map((value, vIdx) => (
                            <TableCell key={vIdx} className="text-right">
                              {typeof value === 'number' 
                                ? value.toLocaleString('ar-SA')
                                : String(value || '-')}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {issue.details.length > 5 && (
                    <Button 
                      variant="link" 
                      size="sm" 
                      onClick={handleViewDetails}
                      className="mt-2 gap-2"
                    >
                      <List className="w-4 h-4" />
                      عرض كل {issue.details.length} سجل
                    </Button>
                  )}
                </div>
              )}

              {/* Manual Fix Steps */}
              {issue.manualFixSteps && issue.manualFixSteps.length > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-muted/50">
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    خطوات الإصلاح اليدوي
                  </h4>
                  <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1 mr-4">
                    {issue.manualFixSteps.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-2 justify-end">
                {issue.canAutoFix && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleFixRequest}
                    disabled={isFixing}
                    className="gap-2 bg-green-600 hover:bg-green-700"
                  >
                    {isFixing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wrench className="w-4 h-4" />
                    )}
                    {isFixing ? 'جاري الإصلاح...' : 'تنفيذ الإصلاح'}
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="gap-2"
                  onClick={handleViewDetails}
                >
                  <ExternalLink className="w-4 h-4" />
                  عرض التفاصيل الكاملة
                </Button>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Fix Confirmation Dialog */}
      <HealthCheckFixConfirm
        open={showFixDialog}
        onOpenChange={setShowFixDialog}
        issue={issue}
        onConfirm={handleConfirmFix}
      />

      {/* Issue Details Dialog */}
      <IssueDetailsDialog
        open={showDetailsDialog}
        onOpenChange={setShowDetailsDialog}
        issue={issue}
      />
    </>
  );
}
