import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History, User, Clock, FileEdit, Plus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

interface AuditTrailCardProps {
  invoiceId: string;
  maxHeight?: string;
}

const actionIcons: Record<string, React.ReactNode> = {
  Create: <Plus className="w-3 h-3 text-green-500" />,
  Update: <FileEdit className="w-3 h-3 text-blue-500" />,
  Delete: <Trash2 className="w-3 h-3 text-red-500" />,
};

const actionLabels: Record<string, string> = {
  Create: 'إنشاء',
  Update: 'تعديل',
  Delete: 'حذف',
};

export default function AuditTrailCard({ 
  invoiceId,
  maxHeight = '300px',
}: AuditTrailCardProps) {
  const { data: auditLogs = [], isLoading } = useQuery({
    queryKey: ['invoice-audit-logs', invoiceId],
    queryFn: async () => {
      const res = await fetch(`/api/invoice-audit-trail/${invoiceId}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch audit trail');
      return (await res.json()) || [];
    },
    enabled: !!invoiceId,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="w-4 h-4" />
          سجل النشاط
          {auditLogs.length > 0 && (
            <Badge variant="secondary" className="mr-2">
              {auditLogs.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : auditLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            لا يوجد سجل نشاط لهذه الفاتورة
          </p>
        ) : (
          <ScrollArea style={{ maxHeight }} className="pr-4">
            <div className="space-y-4">
              {auditLogs.map((log, index) => (
                <div 
                  key={log.id} 
                  className={`relative pb-4 ${index < auditLogs.length - 1 ? 'border-b' : ''}`}
                >
                  {/* Timeline connector */}
                  {index < auditLogs.length - 1 && (
                    <div className="absolute top-6 right-[7px] bottom-0 w-[2px] bg-muted" />
                  )}

                  <div className="flex gap-3">
                    {/* Action Icon */}
                    <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center mt-1 z-10">
                      {actionIcons[log.action_type] || <FileEdit className="w-3 h-3" />}
                    </div>

                    {/* Content */}
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {actionLabels[log.action_type] || log.action_type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(log.timestamp), 'dd MMM yyyy - HH:mm', { locale: ar })}
                        </span>
                      </div>

                      {/* User */}
                      <div className="flex items-center gap-1 text-sm">
                        <User className="w-3 h-3 text-muted-foreground" />
                        <span className="font-medium">{log.user_name || 'مستخدم'}</span>
                      </div>

                      {/* Description */}
                      {log.description && (
                        <p className="text-sm text-muted-foreground">
                          {log.description}
                        </p>
                      )}

                      {/* Changes Preview */}
                      {log.old_value && log.new_value && (
                        <div className="text-xs bg-muted/50 rounded p-2 mt-2">
                          <p className="text-muted-foreground">تم تغيير القيم</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
