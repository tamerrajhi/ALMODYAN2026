import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useBranches } from '@/hooks/useBranches';
import * as dataGateway from '@/lib/dataGateway';
import { toast } from 'sonner';
import { Loader2, ArrowRightLeft, AlertTriangle, Printer, Check } from 'lucide-react';
import TransferReceipt from './transfers/TransferReceipt';
import { useReactToPrint } from 'react-to-print';

// Phase C2: TransferItem interface removed - TransferReceipt now uses transferId

interface BulkMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const BATCH_SIZE = 500;

export function BulkMoveDialog({ open, onOpenChange, onSuccess }: BulkMoveDialogProps) {
  const { data: branches } = useBranches(true);
  const [sourceBranchId, setSourceBranchId] = useState<string>('');
  const [targetBranchId, setTargetBranchId] = useState<string>('');
  const [isMoving, setIsMoving] = useState(false);
  const [itemCount, setItemCount] = useState<number | null>(null);
  
  // Print state
  const [showSuccess, setShowSuccess] = useState(false);
  const [transferId, setTransferId] = useState<string | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: 'إيصال نقل جماعي',
  });

  const checkItemCount = async (branchId: string) => {
    if (!branchId) {
      setItemCount(null);
      return;
    }

    const { count } = await dataGateway.queryTable('unique_items', {
      select: 'id',
      filters: [
        { type: 'eq', column: 'branch_id', value: branchId },
        { type: 'is', column: 'sold_at', value: null },
      ],
      count: 'exact',
      limit: 1,
    });

    setItemCount(count || 0);
  };

  const handleSourceChange = (value: string) => {
    setSourceBranchId(value);
    checkItemCount(value);
  };

  // Fetch items in batches to avoid hitting the 1000 row limit
  // Phase C2: Only need id for transfer, TransferReceipt fetches its own data
  const fetchAllItems = async (branchId: string): Promise<{ id: string }[]> => {
    const allItems: { id: string }[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await dataGateway.queryTable('unique_items', {
        select: 'id',
        filters: [
          { type: 'eq', column: 'branch_id', value: branchId },
          { type: 'is', column: 'sold_at', value: null },
        ],
        order: { column: 'serial_no', ascending: true },
        range: { from: offset, to: offset + BATCH_SIZE - 1 },
      });

      if (error) throw error;

      if (data && data.length > 0) {
        allItems.push(...data);
        offset += data.length;
        hasMore = data.length === BATCH_SIZE;
      } else {
        hasMore = false;
      }
    }

    return allItems;
  };

  const handleBulkMove = async () => {
    if (!sourceBranchId || !targetBranchId) {
      toast.error('يرجى اختيار الفرع المصدر والمستهدف');
      return;
    }

    if (sourceBranchId === targetBranchId) {
      toast.error('الفرع المصدر والمستهدف متماثلان');
      return;
    }

    setIsMoving(true);

    try {
      // Fetch all unsold items from source branch using pagination
      const itemsToMove = await fetchAllItems(sourceBranchId);

      if (itemsToMove.length === 0) {
        toast.error('لا توجد قطع للنقل في هذا الفرع');
        setIsMoving(false);
        return;
      }

      const itemIds = itemsToMove.map((item: any) => item.id);

      // Use transfer utility with post-checks
      const { executeTransferWithChecks } = await import('@/lib/transfer-post-checks');
      
      const { result, postCheck, isPartialSuccess } = await executeTransferWithChecks(
        sourceBranchId,
        targetBranchId,
        itemIds,
        `نقل جماعي - ${itemIds.length} قطعة`
      );

      if (!result.success) {
        throw new Error(result.error || 'فشل النقل الجماعي');
      }

      // Show post-check results
      if (postCheck) {
        if (isPartialSuccess) {
          toast.warning('نجاح جزئي - يرجى مراجعة التفاصيل', {
            description: postCheck.details.filter(d => d.startsWith('❌')).join('\n'),
            duration: 10000,
          });
        } else {
          const targetBranch = branches?.find(b => b.id === targetBranchId);
          toast.success(`تم نقل ${itemIds.length} قطعة إلى ${targetBranch?.branch_name}`);
        }
      }
      
      // Phase C2: Store transfer_id for snapshot-based receipt
      setTransferId(result.transfer_id || null);
      setShowSuccess(true);
      onSuccess();
    } catch (error: any) {
      console.error('Bulk move error:', error);
      toast.error(error.message || 'حدث خطأ أثناء نقل القطع');
    }

    setIsMoving(false);
  };

  const resetState = () => {
    setSourceBranchId('');
    setTargetBranchId('');
    setItemCount(null);
    setShowSuccess(false);
    setTransferId(null);
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const sourceBranch = branches?.find(b => b.id === sourceBranchId);
  const targetBranch = branches?.find(b => b.id === targetBranchId);

  // Success view with print option - Phase C2: Use transferId for snapshot-based receipt
  if (showSuccess && transferId) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <Check className="w-5 h-5" />
              تمت عملية النقل بنجاح
            </DialogTitle>
            <DialogDescription>
              تم نقل القطع من {sourceBranch?.branch_name} إلى {targetBranch?.branch_name}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh]">
            {/* Phase C2: TransferReceipt now fetches from snapshots via transferId */}
            <TransferReceipt
              ref={receiptRef}
              transferId={transferId}
            />
          </ScrollArea>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={handleClose}>
              إغلاق
            </Button>
            <Button onClick={() => handlePrint()}>
              <Printer className="w-4 h-4 ml-2" />
              طباعة الإيصال
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-gold" />
            نقل جميع القطع بين الفروع
          </DialogTitle>
          <DialogDescription>
            نقل جميع القطع غير المباعة من فرع إلى فرع آخر
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>الفرع المصدر</Label>
            <Select value={sourceBranchId} onValueChange={handleSourceChange}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الفرع المصدر..." />
              </SelectTrigger>
              <SelectContent>
                {branches?.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.branch_name} ({branch.branch_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {itemCount !== null && (
              <p className="text-sm text-muted-foreground">
                عدد القطع غير المباعة: <span className="font-semibold">{itemCount}</span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>الفرع المستهدف</Label>
            <Select value={targetBranchId} onValueChange={setTargetBranchId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الفرع المستهدف..." />
              </SelectTrigger>
              <SelectContent>
                {branches?.filter(b => b.id !== sourceBranchId).map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.branch_name} ({branch.branch_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {itemCount && itemCount > 0 && (
            <div className="p-3 bg-warning/10 text-warning rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <p className="text-sm">
                سيتم نقل <span className="font-bold">{itemCount}</span> قطعة غير مباعة. هذا الإجراء لا يمكن التراجع عنه.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button 
              onClick={handleBulkMove} 
              disabled={isMoving || !sourceBranchId || !targetBranchId || itemCount === 0}
            >
              {isMoving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              نقل جميع القطع
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
