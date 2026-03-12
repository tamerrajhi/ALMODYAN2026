import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RefreshCw, FileSearch, CheckCircle, Wrench, ExternalLink, Clock, User } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { getAccountingAuditLogs } from '@/lib/accounting-health-checks';
import { HealthCheckRunsHistory } from './HealthCheckRunsHistory';
import type { HealthCheckCategory } from '@/lib/accounting-health-checks';

interface AuditLog {
  id: string;
  audit_type: string;
  category: string;
  issue_type: string;
  entity_type?: string;
  entity_id?: string;
  entity_code?: string;
  old_value?: any;
  new_value?: any;
  status: string;
  user_name?: string;
  description?: string;
  created_at: string;
}

const auditTypeConfig: Record<string, { label: string; icon: typeof FileSearch; color: string }> = {
  health_check: {
    label: 'فحص صحة',
    icon: FileSearch,
    color: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  },
  auto_fix: {
    label: 'إصلاح آلي',
    icon: Wrench,
    color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  },
  manual_fix: {
    label: 'إصلاح يدوي',
    icon: CheckCircle,
    color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  },
  system: {
    label: 'نظام',
    icon: RefreshCw,
    color: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  },
};

interface HealthCheckAuditLogProps {
  onRerunCheck?: (runId: string, categories: HealthCheckCategory[]) => void;
}

export function HealthCheckAuditLog({ onRerunCheck }: HealthCheckAuditLogProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const data = await getAccountingAuditLogs(50);
      setLogs(data || []);
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const formatDate = (date: string) => {
    return format(new Date(date), 'dd/MM/yyyy HH:mm', { locale: ar });
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="w-5 h-5" />
            سجل التدقيق المحاسبي
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowHistory(true)}
              className="gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              عرض جلسات التدقيق
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={fetchLogs}
              disabled={isLoading}
            >
              <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-right">النوع</TableHead>
                  <TableHead className="text-right">الفئة</TableHead>
                  <TableHead className="text-right">الوصف</TableHead>
                  <TableHead className="text-right">المستخدم</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      {isLoading ? 'جارِ التحميل...' : 'لا توجد سجلات'}
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => {
                    const config = auditTypeConfig[log.audit_type] || auditTypeConfig.system;
                    const Icon = config.icon;
                    
                    return (
                      <TableRow key={log.id} className="hover:bg-muted/50">
                        <TableCell className="text-sm">
                          {formatDate(log.created_at)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={config.color}>
                            <Icon className="w-3 h-3 ml-1" />
                            {config.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {log.category}
                        </TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">
                          {log.description}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {log.user_name || '-'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {log.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Health Check Runs History Dialog */}
      <HealthCheckRunsHistory
        open={showHistory}
        onOpenChange={setShowHistory}
        onRerunCheck={onRerunCheck}
      />
    </>
  );
}
