import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, X, Pause } from 'lucide-react';
import { toast } from 'sonner';
import { notifyPRCreator, notifyApprovers } from '@/lib/pr-notifications';
import { PRApprovalHistoryView } from './PRApprovalHistoryView';
import { approvePurchaseRequisition } from '@/domain/purchasing/purchasingWriteService';
import { getPurchaseRequisitionForApproval } from '@/domain/purchasing/purchasingReadService';

interface PRApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requisitionId: string | null;
  userProfile: any;
}

export function PRApprovalDialog({ open, onOpenChange, requisitionId, userProfile }: PRApprovalDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [comments, setComments] = useState('');

  // Fetch PR data from read service
  const { data: requisition, isLoading } = useQuery({
    queryKey: ['purchase-requisition-approval', requisitionId],
    queryFn: () => requisitionId ? getPurchaseRequisitionForApproval(requisitionId) : null,
    enabled: open && !!requisitionId,
  });

  const approvalMutation = useMutation({
    mutationFn: async (action: 'approve' | 'reject' | 'hold') => {
      if (!requisition || !user) return;

      const result = await approvePurchaseRequisition({
        requisitionId: requisition.id,
        action,
        comments: comments || undefined,
        userId: user.id,
        userName: userProfile?.full_name || user.email || 'مستخدم',
        userRole: userProfile?.role_name || 'مستخدم',
        requisitionNumber: requisition.requisitionNumber,
        currentApprovalLevel: requisition.currentApprovalLevel,
        requiredApprovalLevel: requisition.requiredApprovalLevel,
        createdBy: requisition.createdBy || '',
        departmentId: requisition.departmentId || '',
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      // Notifications
      if (action === 'approve') {
        if (result.newStatus === 'approved') {
          await notifyPRCreator({
            requisitionId: requisition.id,
            requisitionNumber: requisition.requisitionNumber,
            action: 'approved',
            fromUserName: userProfile?.full_name || user?.email,
          }, requisition.createdBy || '');
        } else {
          await notifyApprovers(
            requisition.id,
            requisition.requisitionNumber,
            result.newLevel || 1,
            userProfile?.full_name || user?.email,
            requisition.departmentId || ''
          );
        }
      } else {
        await notifyPRCreator({
          requisitionId: requisition.id,
          requisitionNumber: requisition.requisitionNumber,
          action: action === 'reject' ? 'rejected' : 'on_hold',
          fromUserName: userProfile?.full_name || user?.email,
          comments,
        }, requisition.createdBy || '');
      }

      return { action, newStatus: result.newStatus };
    },
    onSuccess: (data) => {
      const messages = {
        approve: 'تمت الموافقة بنجاح',
        reject: 'تم رفض الطلب',
        hold: 'تم تعليق الطلب',
      };
      toast.success(messages[data?.action || 'approve']);
      setComments('');
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ['purchase-requisitions'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requisition-approval', requisitionId] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل في العملية');
    },
  });

  if (!requisitionId) return null;

  const approvalLevelText = () => {
    if (!requisition) return '';
    const current = requisition.currentApprovalLevel;
    const required = requisition.requiredApprovalLevel;
    
    if (current === 0) return 'في انتظار موافقة مدير القسم';
    if (current === 1 && required > 1) return 'في انتظار موافقة المشتريات';
    if (current === 2 && required > 2) return 'في انتظار موافقة الإدارة العليا';
    return 'موافقة نهائية';
  };

  const isPending = approvalMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>مراجعة طلب الشراء</DialogTitle>
        </DialogHeader>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : requisition ? (
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">رقم الطلب:</span>
                <span className="font-mono">{requisition.requisitionNumber}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold">المبلغ التقديري:</span>
                <span className="text-lg font-bold">{requisition.totalEstimatedAmount.toLocaleString()} ر.س</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold">مستوى الموافقة:</span>
                <Badge variant="outline">
                  {requisition.currentApprovalLevel} / {requisition.requiredApprovalLevel}
                </Badge>
              </div>
              <div className="pt-2 border-t">
                <p className="text-sm text-muted-foreground">{approvalLevelText()}</p>
              </div>
            </div>

            {requisition.justification && (
              <div>
                <Label className="text-muted-foreground text-sm">مبررات الطلب</Label>
                <p className="p-3 bg-muted/50 rounded-lg text-sm">{requisition.justification}</p>
              </div>
            )}

            <PRApprovalHistoryView requisitionId={requisition.id} />

            <div>
              <Label>تعليق الموافقة / سبب الرفض / سبب التعليق *</Label>
              <Textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="اكتب تعليقك أو السبب..."
                rows={3}
              />
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            لم يتم العثور على الطلب
          </div>
        )}

        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            إلغاء
          </Button>
          <Button
            variant="secondary"
            onClick={() => approvalMutation.mutate('hold')}
            disabled={isPending || !comments.trim() || !requisition}
            className="gap-1"
          >
            {approvalMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            <Pause className="w-4 h-4" />
            تعليق
          </Button>
          <Button
            variant="destructive"
            onClick={() => approvalMutation.mutate('reject')}
            disabled={isPending || !comments.trim() || !requisition}
            className="gap-1"
          >
            {approvalMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            <X className="w-4 h-4" />
            رفض
          </Button>
          <Button
            onClick={() => approvalMutation.mutate('approve')}
            disabled={isPending || !requisition}
            className="bg-green-600 hover:bg-green-700 gap-1"
          >
            {approvalMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            <Check className="w-4 h-4" />
            موافقة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
