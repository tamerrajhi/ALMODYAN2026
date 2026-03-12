import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { useAuth } from '@/contexts/AuthContext';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, AlertTriangle } from 'lucide-react';
import { createProductionCompleteJournalEntry, calculateWorkOrderTotalCost } from '@/lib/production-accounting';
import { logAudit } from '@/lib/audit';

interface PartialCompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrder: {
    id: string;
    order_number: string;
    quantity: number;
    gold_weight_required: number;
    completed_quantity?: number;
    completed_weight?: number;
    cost_center_id?: string;
    branch_id?: string;
  };
}

export default function PartialCompletionDialog({
  open,
  onOpenChange,
  workOrder,
}: PartialCompletionDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    quantity_completed: 0,
    weight_completed: 0,
    notes: '',
  });

  const remainingQuantity = workOrder.quantity - (workOrder.completed_quantity || 0);
  const remainingWeight = workOrder.gold_weight_required - (workOrder.completed_weight || 0);

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (form.quantity_completed <= 0 && form.weight_completed <= 0) {
        throw new Error('يجب إدخال كمية أو وزن');
      }

      if (form.quantity_completed > remainingQuantity) {
        throw new Error('الكمية المدخلة أكبر من المتبقي');
      }

      // Generate completion number
      const { data: completionNumber } = await dataGateway.rpc(
        'generate_partial_completion_number',
        { p_work_order_id: workOrder.id }
      );

      // Calculate cost for this portion
      const totalCost = await calculateWorkOrderTotalCost(workOrder.id);
      const portionRatio = form.weight_completed / workOrder.gold_weight_required;
      const allocatedCost = totalCost.totalCost * portionRatio;

      forbidDirectWrite('insert', 'PartialCompletionDialog.tsx:completeMutation');
    },
    onSuccess: (data) => {
      toast.success(
        data.isFullyCompleted
          ? 'تم إكمال أمر الإنتاج بالكامل'
          : 'تم تسجيل الإنتاج الجزئي بنجاح'
      );
      onOpenChange(false);
      setForm({ quantity_completed: 0, weight_completed: 0, notes: '' });
      queryClient.invalidateQueries({ queryKey: ['work-order', workOrder.id] });
      queryClient.invalidateQueries({ queryKey: ['work-order-partial-completions', workOrder.id] });
    },
    onError: (error: any) => {
      console.error('Error completing:', error);
      toast.error(error.message || 'حدث خطأ أثناء تسجيل الإنتاج الجزئي');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل إنتاج جزئي</DialogTitle>
          <DialogDescription>
            أمر الإنتاج: {workOrder.order_number}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Remaining Info */}
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span>الكمية المتبقية:</span>
              <span className="font-medium">{remainingQuantity} قطعة</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>الوزن المتبقي:</span>
              <span className="font-medium">{remainingWeight.toFixed(2)} جرام</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>الكمية المكتملة *</Label>
              <Input
                type="number"
                value={form.quantity_completed}
                onChange={(e) => setForm(prev => ({ ...prev, quantity_completed: parseInt(e.target.value) || 0 }))}
                min={0}
                max={remainingQuantity}
              />
            </div>
            <div className="space-y-2">
              <Label>الوزن المكتمل (جرام) *</Label>
              <Input
                type="number"
                value={form.weight_completed}
                onChange={(e) => setForm(prev => ({ ...prev, weight_completed: parseFloat(e.target.value) || 0 }))}
                min={0}
                max={remainingWeight}
                step={0.01}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>ملاحظات</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="ملاحظات إضافية..."
            />
          </div>

          {form.quantity_completed >= remainingQuantity && (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
              <AlertTriangle className="w-5 h-5" />
              <span className="text-sm">سيتم إغلاق أمر الإنتاج بالكامل</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            onClick={() => completeMutation.mutate()}
            disabled={
              (form.quantity_completed <= 0 && form.weight_completed <= 0) ||
              completeMutation.isPending
            }
          >
            {completeMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            تأكيد الإنتاج
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
