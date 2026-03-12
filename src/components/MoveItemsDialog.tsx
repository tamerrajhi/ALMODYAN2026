import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useBranches } from '@/hooks/useBranches';
import { toast } from 'sonner';
import { Loader2, ArrowRightLeft } from 'lucide-react';
import { executeTransferV2WithChecks } from '@/lib/transfersV2Service';

interface MoveItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItems: string[];
  currentBranchId?: string;
  onSuccess: () => void;
}

export function MoveItemsDialog({ 
  open, 
  onOpenChange, 
  selectedItems, 
  currentBranchId,
  onSuccess 
}: MoveItemsDialogProps) {
  const { data: branches } = useBranches(true);
  const [targetBranchId, setTargetBranchId] = useState<string>('');
  const [isMoving, setIsMoving] = useState(false);

  const handleMove = async () => {
    if (!targetBranchId) {
      toast.error('يرجى اختيار الفرع المستهدف');
      return;
    }

    if (targetBranchId === currentBranchId) {
      toast.error('الفرع المستهدف هو نفس الفرع الحالي');
      return;
    }

    if (selectedItems.length === 0) {
      toast.error('لا توجد قطع للنقل');
      return;
    }

    setIsMoving(true);

    try {
      // Use V2 transfer service with checks
      const { result, verification, isPartialSuccess } = await executeTransferV2WithChecks({
        from_branch_id: currentBranchId || null,
        to_branch_id: targetBranchId,
        item_ids: selectedItems,
      });

      if (!result.success) {
        throw new Error(result.error || 'فشل النقل');
      }

      // Show verification results
      if (verification) {
        if (isPartialSuccess) {
          toast.warning('نجاح جزئي - يرجى مراجعة التفاصيل', {
            description: verification.details.filter(d => d.startsWith('❌')).join('\n'),
            duration: 10000,
          });
        } else {
          const targetBranch = branches?.find(b => b.id === targetBranchId);
          toast.success(`تم نقل ${selectedItems.length} قطعة إلى ${targetBranch?.branch_name}`);
        }
      }
      
      onSuccess();
      onOpenChange(false);
      setTargetBranchId('');
    } catch (error: any) {
      console.error('Move error:', error);
      toast.error(error.message || 'حدث خطأ أثناء نقل القطع');
    }

    setIsMoving(false);
  };

  const availableBranches = branches?.filter(b => b.id !== currentBranchId) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-gold" />
            نقل القطع
          </DialogTitle>
          <DialogDescription>
            نقل {selectedItems.length} قطعة إلى فرع آخر
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>الفرع المستهدف</Label>
            <Select value={targetBranchId} onValueChange={setTargetBranchId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الفرع..." />
              </SelectTrigger>
              <SelectContent>
                {availableBranches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.branch_name} ({branch.branch_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button onClick={handleMove} disabled={isMoving || !targetBranchId}>
              {isMoving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              نقل القطع
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
