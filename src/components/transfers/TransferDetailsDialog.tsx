import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { 
  ArrowRightLeft, 
  Building2, 
  Calendar, 
  Package, 
  Loader2, 
  BookOpen, 
  RotateCcw, 
  FileText,
  Check,
  X,
  AlertTriangle
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTransferDetails } from '@/hooks/useTransfersV2ReadModel';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { toast } from 'sonner';
import { 
  TransferStatus, 
  getTransferStatusDisplay, 
  reverseTransfer, 
  canReverseTransfer,
  approveTransfer,
  rejectTransfer
} from '@/lib/transfer-accounting';

// Phase D1: Dialog accepts transferId and fetches data via hook
interface TransferDetailsDialogProps {
  transferId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TransferDetailsDialog({ transferId, open, onOpenChange }: TransferDetailsDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showReverseConfirm, setShowReverseConfirm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [isReversing, setIsReversing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  // Phase D1: Use unified read hook instead of direct database queries
  const { data: transferData, isLoading } = useTransferDetails(open ? transferId : null);

  // Check if can reverse
  const { data: canReverse } = useQuery({
    queryKey: ['can-reverse-transfer', transferId],
    queryFn: async () => {
      if (!transferId) return null;
      return await canReverseTransfer(transferId);
    },
    enabled: !!transferId && transferData?.header?.status === 'posted',
  });

  if (!transferId || !open) return null;

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!transferData) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl">
          <div className="text-center py-12 text-muted-foreground">
            <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>لم يتم العثور على بيانات النقل</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const { header, items } = transferData;
  const statusDisplay = getTransferStatusDisplay(header.status as TransferStatus);
  // Use unit_cost snapshot from transfer_items
  const totalCost = items.reduce((sum, ti) => sum + (Number(ti.unit_cost) || 0), 0);

  const handleReverse = async () => {
    if (!reverseReason.trim()) {
      toast.error('يرجى إدخال سبب العكس');
      return;
    }

    setIsReversing(true);
    try {
      const result = await reverseTransfer(transferId, 'current_user', reverseReason);
      
      if (result.success) {
        toast.success('تم عكس النقل بنجاح');
        queryClient.invalidateQueries({ queryKey: ['transfers-list-v2'] });
        queryClient.invalidateQueries({ queryKey: ['transfer-details-read-v2'] });
        queryClient.invalidateQueries({ queryKey: ['transfer-history-report-v2'] });
        setShowReverseConfirm(false);
        setReverseReason('');
        onOpenChange(false);
      } else {
        toast.error(result.error || 'فشل عكس النقل');
      }
    } finally {
      setIsReversing(false);
    }
  };

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      const result = await approveTransfer(transferId, 'current_user');
      
      if (result.success) {
        toast.success('تم اعتماد النقل وإنشاء القيد المحاسبي');
        queryClient.invalidateQueries({ queryKey: ['transfers-list-v2'] });
        queryClient.invalidateQueries({ queryKey: ['transfer-details-read-v2'] });
        queryClient.invalidateQueries({ queryKey: ['transfer-history-report-v2'] });
        onOpenChange(false);
      } else {
        toast.error(result.error || 'فشل اعتماد النقل');
      }
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      toast.error('يرجى إدخال سبب الرفض');
      return;
    }

    setIsRejecting(true);
    try {
      const result = await rejectTransfer(transferId, rejectReason);
      
      if (result.success) {
        toast.success('تم رفض النقل');
        queryClient.invalidateQueries({ queryKey: ['transfers-list-v2'] });
        queryClient.invalidateQueries({ queryKey: ['transfer-details-read-v2'] });
        queryClient.invalidateQueries({ queryKey: ['transfer-history-report-v2'] });
        setShowRejectConfirm(false);
        setRejectReason('');
        onOpenChange(false);
      } else {
        toast.error(result.error || 'فشل رفض النقل');
      }
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-gold" />
              تفاصيل عملية النقل
            </DialogTitle>
            <DialogDescription>
              عرض تفاصيل النقل والقيد المحاسبي المرتبط
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Status Banner */}
            <div className={`p-4 rounded-lg ${statusDisplay.bgColor} flex items-center justify-between`}>
              <div className="flex items-center gap-3">
                <Badge className={`${statusDisplay.bgColor} ${statusDisplay.color} border-0`}>
                  {statusDisplay.label}
                </Badge>
                {header.status === 'reversed' && header.reversal_reason && (
                  <span className="text-sm text-muted-foreground">
                    السبب: {header.reversal_reason}
                  </span>
                )}
              </div>
              
              {/* Action Buttons */}
              <div className="flex gap-2">
                {header.status === 'awaiting_approval' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowRejectConfirm(true)}
                      disabled={isRejecting}
                    >
                      <X className="w-4 h-4 ml-1" />
                      رفض
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleApprove}
                      disabled={isApproving}
                    >
                      {isApproving ? (
                        <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4 ml-1" />
                      )}
                      اعتماد
                    </Button>
                  </>
                )}
                
                {header.status === 'posted' && !canReverse && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowReverseConfirm(true)}
                    className="text-destructive hover:text-destructive"
                  >
                    <RotateCcw className="w-4 h-4 ml-1" />
                    عكس النقل
                  </Button>
                )}
              </div>
            </div>

            {/* Transfer Info */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">التاريخ</p>
                <p className="font-medium flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {format(new Date(header.transfer_date), 'yyyy/MM/dd HH:mm', { locale: ar })}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">من</p>
                <p className="font-medium flex items-center gap-1">
                  <Building2 className="w-4 h-4" />
                  {header.from_branch?.branch_name || 'المستودع'}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">إلى</p>
                <p className="font-medium flex items-center gap-1">
                  <Building2 className="w-4 h-4" />
                  {header.to_branch?.branch_name || '-'}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">عدد القطع</p>
                <p className="font-medium">{items.length} قطعة</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">إجمالي التكلفة</p>
                <p className="font-medium text-primary">{totalCost.toLocaleString()} ر.س</p>
              </div>
              {header.invoice_number && (
                <div>
                  <p className="text-sm text-muted-foreground">فاتورة المشتريات</p>
                  <p className="font-medium flex items-center gap-1">
                    <FileText className="w-4 h-4" />
                    {header.invoice_number}
                  </p>
                </div>
              )}
              {header.approved_at && (
                <div>
                  <p className="text-sm text-muted-foreground">تاريخ الاعتماد</p>
                  <p className="font-medium">
                    {format(new Date(header.approved_at), 'yyyy/MM/dd HH:mm', { locale: ar })}
                  </p>
                </div>
              )}
              {header.reversed_at && (
                <div>
                  <p className="text-sm text-muted-foreground">تاريخ العكس</p>
                  <p className="font-medium text-destructive">
                    {format(new Date(header.reversed_at), 'yyyy/MM/dd HH:mm', { locale: ar })}
                  </p>
                </div>
              )}
            </div>

            {/* Journal Entry Links */}
            {(header.journal_entry_id || header.reverse_journal_entry_id) && (
              <Card>
                <CardContent className="p-4 space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-primary" />
                    القيود المحاسبية
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {header.journal_entry_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          onOpenChange(false);
                          navigate(`/accounting/journal-entries?entry=${header.journal_entry_id}`);
                        }}
                      >
                        <BookOpen className="w-4 h-4 ml-1" />
                        قيد النقل
                      </Button>
                    )}
                    {header.reverse_journal_entry_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          onOpenChange(false);
                          navigate(`/accounting/journal-entries?entry=${header.reverse_journal_entry_id}`);
                        }}
                        className="text-destructive"
                      >
                        <RotateCcw className="w-4 h-4 ml-1" />
                        قيد العكس
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Items Table */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">كود القطعة</TableHead>
                  <TableHead className="text-right">الموديل</TableHead>
                  <TableHead className="text-right">الوصف</TableHead>
                  <TableHead className="text-right">فاتورة المورد</TableHead>
                  <TableHead className="text-right">الوزن</TableHead>
                  <TableHead className="text-right">التكلفة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.item_id}>
                    {/* item_code from snapshot */}
                    <TableCell className="font-mono text-sm">
                      {item.item_code || item.item_id.slice(0, 8)}
                    </TableCell>
                    {/* model/description from jewelry_items (display only) */}
                    <TableCell>{item.model || '-'}</TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {item.description || '-'}
                    </TableCell>
                    <TableCell className="text-sm">{item.supp_ref || '-'}</TableCell>
                    {/* weight_grams from snapshot */}
                    <TableCell>
                      {item.weight_grams != null ? Number(item.weight_grams).toFixed(2) : '-'} g
                    </TableCell>
                    {/* unit_cost from snapshot */}
                    <TableCell>
                      {item.unit_cost != null ? Number(item.unit_cost).toLocaleString() : '-'} ر.س
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {header.notes && (
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">ملاحظات</p>
                <p>{header.notes}</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Reverse Confirmation Dialog */}
      <AlertDialog open={showReverseConfirm} onOpenChange={setShowReverseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              تأكيد عكس النقل
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <p>
                سيتم إعادة {items.length} قطعة إلى الفرع المصدر
                وإنشاء قيد محاسبي عكسي.
              </p>
              <Textarea
                placeholder="سبب العكس (إلزامي)..."
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                className="mt-2"
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReverse}
              disabled={isReversing || !reverseReason.trim()}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isReversing ? (
                <Loader2 className="w-4 h-4 ml-1 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4 ml-1" />
              )}
              تأكيد العكس
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject Confirmation Dialog */}
      <AlertDialog open={showRejectConfirm} onOpenChange={setShowRejectConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>رفض النقل</AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <p>سيتم رفض هذا النقل وإعادته لحالة المسودة.</p>
              <Textarea
                placeholder="سبب الرفض (إلزامي)..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="mt-2"
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={isRejecting || !rejectReason.trim()}
            >
              {isRejecting ? (
                <Loader2 className="w-4 h-4 ml-1 animate-spin" />
              ) : (
                <X className="w-4 h-4 ml-1" />
              )}
              تأكيد الرفض
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}