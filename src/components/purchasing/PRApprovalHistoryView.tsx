import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Check, X, Send, FileEdit, XCircle, ArrowRight } from 'lucide-react';

interface PRApprovalHistoryViewProps {
  requisitionId: string;
}

const actionConfig: Record<string, { label: string; icon: any; color: string }> = {
  created: { label: 'إنشاء', icon: FileEdit, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  updated: { label: 'تعديل', icon: FileEdit, color: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400' },
  submitted: { label: 'إرسال للموافقة', icon: Send, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  approved: { label: 'موافقة', icon: Check, color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  rejected: { label: 'رفض', icon: X, color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  cancelled: { label: 'إلغاء', icon: XCircle, color: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400' },
  converted: { label: 'تحويل لأمر شراء', icon: ArrowRight, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
};

export function PRApprovalHistoryView({ requisitionId }: PRApprovalHistoryViewProps) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['pr-approval-history', requisitionId],
    queryFn: async () => {
      const res = await fetch(`/api/pr-approval-history/${requisitionId}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch PR approval history');
      return await res.json();
    },
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">جاري التحميل...</div>;
  }

  if (history.length === 0) {
    return <div className="text-sm text-muted-foreground">لا يوجد سجل للموافقات</div>;
  }

  return (
    <div className="space-y-3">
      <h4 className="font-semibold">سجل الموافقات</h4>
      <div className="relative">
        <div className="absolute right-3 top-0 bottom-0 w-0.5 bg-border" />
        <div className="space-y-4">
          {history.map((entry, index) => {
            const config = actionConfig[entry.action] || actionConfig.updated;
            const Icon = config.icon;
            
            return (
              <div key={entry.id} className="relative pr-8">
                <div className={`absolute right-1 w-5 h-5 rounded-full flex items-center justify-center ${config.color}`}>
                  <Icon className="w-3 h-3" />
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={config.color}>{config.label}</Badge>
                    <span className="text-sm font-medium">{entry.action_by_name}</span>
                    {entry.action_by_role && (
                      <span className="text-xs text-muted-foreground">({entry.action_by_role})</span>
                    )}
                  </div>
                  {entry.comments && (
                    <p className="text-sm mt-2 text-muted-foreground">{entry.comments}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(new Date(entry.created_at), 'dd MMMM yyyy - hh:mm a', { locale: ar })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
