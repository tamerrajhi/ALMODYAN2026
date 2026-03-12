import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { Loader2, Save, Search, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  rebuildUniqueInvoiceAtomic,
  fetchRebuildGate,
  type UniqueInvoiceEditCommand,
  type RebuildGateResult,
} from '@/domain/purchasing/purchasingWriteService';
import {
  UniqueItemsGridEditor,
  type EditableGridItem,
  type GridColumnDef,
  apiItemToRow,
} from '@/components/shared/UniqueItemsGridEditor';

interface UniqueInvoiceEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: {
    id: string;
    invoiceNumber: string;
    supplierInvoiceNo?: string | null;
    invoiceDate: string;
    notes?: string | null;
  };
  onEditComplete: () => void;
}

const EDITABLE_FIELDS: GridColumnDef[] = [
  { key: 'serial_no', labelAr: 'الرقم التسلسلي', labelEn: 'Serial No', type: 'text', width: 'w-28' },
  { key: 'stockcode', labelAr: 'كود المنتج', labelEn: 'Stockcode', type: 'text', width: 'w-24' },
  { key: 'description', labelAr: 'الوصف', labelEn: 'Description', type: 'text', width: 'w-44' },
  { key: 'model', labelAr: 'الموديل', labelEn: 'Model', type: 'text', width: 'w-24' },
  { key: 'metal', labelAr: 'المعدن', labelEn: 'Metal', type: 'text', width: 'w-16' },
  { key: 'g_weight', labelAr: 'الوزن', labelEn: 'Weight', type: 'number', width: 'w-20' },
  { key: 'cost', labelAr: 'التكلفة', labelEn: 'Cost', type: 'number', width: 'w-24' },
  { key: 'tag_price', labelAr: 'سعر البطاقة', labelEn: 'Tag Price', type: 'number', width: 'w-24' },
  { key: 'supp_ref', labelAr: 'مرجع المورد', labelEn: 'Supp Ref', type: 'text', width: 'w-24' },
];

export function UniqueInvoiceEditDialog({
  open,
  onOpenChange,
  invoice,
  onEditComplete,
}: UniqueInvoiceEditDialogProps) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const isAr = language === 'ar';
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingGate, setIsCheckingGate] = useState(false);
  const [gateResult, setGateResult] = useState<RebuildGateResult | null>(null);

  const [suppInv, setSuppInv] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<EditableGridItem[]>([]);

  const loadItems = useCallback(async () => {
    if (!invoice?.id) return;
    setIsLoading(true);
    try {
      const resp = await fetch(`/api/purchasing/unique-invoice-items/${invoice.id}?page=0&page_size=5000`, {
        credentials: 'include',
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const json = await resp.json();
      const items = json?.data?.items || [];
      if (!Array.isArray(items)) throw new Error('Invalid items shape');
      setRows(items.map(apiItemToRow));
    } catch (err) {
      console.error('Failed to load items:', err);
      toast.error(isAr ? 'فشل تحميل القطع' : 'Failed to load items');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [invoice?.id, isAr]);

  useEffect(() => {
    if (open && invoice) {
      setSuppInv(invoice.supplierInvoiceNo || '');
      setInvoiceDate(invoice.invoiceDate?.split('T')[0] || '');
      setNotes(invoice.notes || '');
      setGateResult(null);
      loadItems();
    }
  }, [open, invoice, loadItems]);

  const visibleRows = rows.filter((r) => !r._isDeleted);
  const newSubtotal = visibleRows.reduce((sum, r) => sum + r.cost, 0);

  const handleGateCheck = async () => {
    setIsCheckingGate(true);
    try {
      const result = await fetchRebuildGate(invoice.id);
      setGateResult(result);
      if (result.can_rebuild) {
        toast.success(isAr ? 'يمكن إعادة البناء — لا توجد موانع' : 'Rebuild allowed — no blockers');
      } else {
        toast.error(isAr ? 'توجد موانع — راجع التفاصيل' : 'Blockers found — check details');
      }
    } catch (err) {
      console.error('Gate check error:', err);
      toast.error(isAr ? 'خطأ في فحص قابلية إعادة البناء' : 'Error checking rebuild eligibility');
    } finally {
      setIsCheckingGate(false);
    }
  };

  const buildPayload = (): UniqueInvoiceEditCommand => {
    const cmd: UniqueInvoiceEditCommand = {
      invoice_id: invoice.id,
      supp_inv: suppInv || undefined,
      invoice_date: invoiceDate || undefined,
      notes: notes !== (invoice.notes || '') ? notes : undefined,
    };

    const itemsUpdate = rows
      .filter((r) => !r._isNew && !r._isDeleted && r._original)
      .filter((r) => {
        const o = r._original!;
        return (
          r.cost !== Number(o.cost) ||
          r.stockcode !== (o.stockcode || '') ||
          r.description !== (o.description || '') ||
          r.model !== (o.model || '') ||
          r.supp_ref !== (o.supp_ref || '') ||
          r.type !== (o.type || '') ||
          r.division !== (o.division || '') ||
          r.metal !== (o.metal || '') ||
          r.stone !== (o.stone || '') ||
          r.g_weight !== Number(o.g_weight || 0) ||
          r.d_weight !== Number(o.d_weight || 0) ||
          r.tag_price !== Number(o.tag_price || 0) ||
          r.minimum_price !== Number(o.minimum_price || 0)
        );
      })
      .map((r) => ({
        item_id: r.item_id!,
        stockcode: r.stockcode,
        model: r.model,
        description: r.description,
        division: r.division,
        supp_ref: r.supp_ref,
        type: r.type,
        cost: r.cost,
        tag_price: r.tag_price,
        minimum_price: r.minimum_price,
        g_weight: r.g_weight,
        d_weight: r.d_weight,
        metal: r.metal,
        stone: r.stone,
      }));

    const itemsAdd = rows
      .filter((r) => r._isNew && !r._isDeleted)
      .map((r) => ({
        stockcode: r.stockcode,
        model: r.model,
        description: r.description,
        division: r.division,
        supp_ref: r.supp_ref,
        type: r.type,
        cost: r.cost,
        tag_price: r.tag_price,
        minimum_price: r.minimum_price,
        g_weight: r.g_weight,
        d_weight: r.d_weight,
        metal: r.metal,
        stone: r.stone,
      }));

    const itemsDelete = rows
      .filter((r) => !r._isNew && r._isDeleted && r.item_id)
      .map((r) => ({ item_id: r.item_id! }));

    if (itemsUpdate.length > 0) cmd.items_update = itemsUpdate;
    if (itemsAdd.length > 0) cmd.items_add = itemsAdd;
    if (itemsDelete.length > 0) cmd.items_delete = itemsDelete;

    return cmd;
  };

  const handleSubmit = async () => {
    const newRows = rows.filter((r) => r._isNew && !r._isDeleted);
    for (const nr of newRows) {
      if (!nr.description && !nr.stockcode) {
        toast.error(isAr ? 'يجب إدخال وصف أو كود المنتج للقطع الجديدة' : 'New items must have a description or stockcode');
        return;
      }
      if (nr.cost <= 0) {
        toast.error(isAr ? 'يجب إدخال تكلفة أكبر من صفر للقطع الجديدة' : 'New items must have cost > 0');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const cmd = buildPayload();
      const result = await rebuildUniqueInvoiceAtomic(cmd);

      if (result.success) {
        const msg = isAr
          ? `تم إعادة بناء الفاتورة بنجاح (${result.items_updated || 0} معدل، ${result.items_added || 0} مضاف، ${result.items_deleted || 0} محذوف — ${result.rebuilt_movements || 0} حركة أُعيد بناؤها)`
          : `Invoice rebuilt (${result.items_updated || 0} updated, ${result.items_added || 0} added, ${result.items_deleted || 0} deleted — ${result.rebuilt_movements || 0} movements rebuilt)`;
        toast.success(msg);
        queryClient.invalidateQueries({ queryKey: ['purchase-invoice', invoice.id] });
        queryClient.invalidateQueries({ queryKey: ['purchasing-invoices'] });
        queryClient.invalidateQueries({ queryKey: ['unique-invoice-items', invoice.id] });
        onEditComplete();
        onOpenChange(false);
      } else {
        const errorMsg = result.message_ar || result.error || (isAr ? 'فشل إعادة بناء الفاتورة' : 'Failed to rebuild invoice');
        toast.error(errorMsg);
      }
    } catch (err) {
      console.error('Rebuild invoice error:', err);
      toast.error(isAr ? 'خطأ في إعادة بناء الفاتورة' : 'Error rebuilding invoice');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(isAr ? 'ar-SA' : 'en-SA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] xl:max-w-[85vw] max-h-[90vh] overflow-hidden flex flex-col" dir={isAr ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle data-testid="text-edit-dialog-title">
            {isAr ? 'تعديل فاتورة الشراء (إعادة بناء)' : 'Edit Purchase Invoice (Rebuild)'}
            <span className="text-muted-foreground text-sm mx-2">{invoice.invoiceNumber}</span>
          </DialogTitle>
          <DialogDescription>
            {isAr ? 'عدّل بيانات الفاتورة والقطع — عند الحفظ سيتم إعادة بناء الحركات والقيود تلقائياً' : 'Edit invoice data and items — saving will rebuild movements and journal entries automatically'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={handleGateCheck}
              disabled={isCheckingGate}
              data-testid="button-rebuild-gate-check"
            >
              {isCheckingGate ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span className="mx-1">{isAr ? 'فحص قابلية إعادة البناء' : 'Check Rebuild Eligibility'}</span>
            </Button>

            {gateResult && (
              <div className="flex items-center gap-1">
                {gateResult.can_rebuild ? (
                  <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                    <CheckCircle2 className="w-4 h-4" />
                    {isAr ? 'يمكن إعادة البناء' : 'Rebuild allowed'}
                    {gateResult.purchase_in_movements != null && (
                      <span className="text-muted-foreground">
                        ({gateResult.purchase_in_movements} {isAr ? 'حركة' : 'movements'})
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-sm text-destructive">
                    <XCircle className="w-4 h-4" />
                    {isAr ? 'توجد موانع' : 'Blockers found'}
                  </span>
                )}
              </div>
            )}
          </div>

          {gateResult && !gateResult.can_rebuild && gateResult.blockers.length > 0 && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 space-y-1">
              <div className="flex items-center gap-1 text-sm font-medium text-destructive">
                <AlertTriangle className="w-4 h-4" />
                {isAr ? 'موانع إعادة البناء:' : 'Rebuild Blockers:'}
              </div>
              {gateResult.blockers.map((b, i) => (
                <div key={i} className="text-sm text-destructive/80 ps-5" data-testid={`text-blocker-${i}`}>
                  {isAr ? b.message_ar : `${b.code} (${b.count})`}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>{isAr ? 'رقم فاتورة المورد' : 'Supplier Invoice No'}</Label>
              <Input
                data-testid="input-supp-inv"
                value={suppInv}
                onChange={(e) => setSuppInv(e.target.value)}
              />
            </div>
            <div>
              <Label>{isAr ? 'تاريخ الفاتورة' : 'Invoice Date'}</Label>
              <Input
                data-testid="input-invoice-date"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>
            <div>
              <Label>{isAr ? 'ملاحظات' : 'Notes'}</Label>
              <Input
                data-testid="input-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <UniqueItemsGridEditor
              mode="purchase_invoice_edit"
              columns={EDITABLE_FIELDS}
              rows={rows}
              onRowsChange={setRows}
              readOnlyFields={['serial_no']}
              allowAddRows
              allowDeleteRows
              enableExcelPaste
              language={language}
            />
          )}

          <div className="p-3 bg-muted rounded-md">
            <div className="flex justify-between gap-2 items-center flex-wrap">
              <span className="text-sm font-medium">
                {isAr ? 'إجمالي التكلفة:' : 'Total Cost:'}
              </span>
              <span className="text-lg font-bold">{formatCurrency(newSubtotal)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2 border-t">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            data-testid="button-cancel-edit"
          >
            {isAr ? 'إلغاء' : 'Cancel'}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || isLoading}
            data-testid="button-save-rebuild"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span className="mx-1">{isAr ? 'حفظ وإعادة البناء' : 'Save & Rebuild'}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
