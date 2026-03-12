import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useBranches } from '@/hooks/useBranches';
import { toast } from 'sonner';
import { Loader2, ArrowRightLeft, Search, Package, Printer, Check, Hash, ListFilter, ChevronDown, FileText, X, BookOpen, Plus, Trash2, ScanBarcode } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import TransferReceipt from './transfers/TransferReceipt';
import { useReactToPrint } from 'react-to-print';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import * as dataGateway from '@/lib/dataGateway';


interface JewelryItem {
  id: string;
  item_code: string;
  barcode: string | null;
  model: string | null;
  description: string | null;
  type: string | null;
  weight_grams: number | null;
  selling_price: number | null;
  unit_cost?: number | null;
  supp_ref?: string | null;
}

interface PurchaseInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  supplier_name?: string | null;
}

interface SelectiveTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function SelectiveTransferDialog({ open, onOpenChange, onSuccess }: SelectiveTransferDialogProps) {
  const { data: branches } = useBranches(true);
  const [sourceBranchId, setSourceBranchId] = useState<string>('');
  const [targetBranchId, setTargetBranchId] = useState<string>('');
  const [isMoving, setIsMoving] = useState(false);

  const [transferMode, setTransferMode] = useState<'manual' | 'purchase_invoice'>('manual');

  // Scan/serial input for manual mode
  const [scanInput, setScanInput] = useState('');
  const [isSearchingItem, setIsSearchingItem] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Items added to the transfer list (invoice-style)
  const [addedItems, setAddedItems] = useState<JewelryItem[]>([]);

  // Purchase invoice search state
  const [invoiceSearchQuery, setInvoiceSearchQuery] = useState('');
  const [debouncedInvoiceSearch, setDebouncedInvoiceSearch] = useState('');
  const [invoiceSearchResults, setInvoiceSearchResults] = useState<PurchaseInvoice[]>([]);
  const [isSearchingInvoices, setIsSearchingInvoices] = useState(false);
  const [selectedPurchaseInvoice, setSelectedPurchaseInvoice] = useState<PurchaseInvoice | null>(null);
  const [showInvoiceResults, setShowInvoiceResults] = useState(false);

  // Purchase invoice items (separate from addedItems)
  const [invoiceItems, setInvoiceItems] = useState<JewelryItem[]>([]);
  const [selectedInvoiceItems, setSelectedInvoiceItems] = useState<Set<string>>(new Set());
  const [isLoadingInvoiceItems, setIsLoadingInvoiceItems] = useState(false);
  const [invoiceTotalCount, setInvoiceTotalCount] = useState<number | null>(null);

  // Print state
  const [showSuccess, setShowSuccess] = useState(false);
  const [transferId, setTransferId] = useState<string | null>(null);
  const [journalEntryId, setJournalEntryId] = useState<string | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  const invoiceSearchRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: 'إيصال نقل',
  });

  // Debounce search query for invoices
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedInvoiceSearch(invoiceSearchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [invoiceSearchQuery]);

  // Search purchase invoices when debounced search changes
  useEffect(() => {
    if (debouncedInvoiceSearch.length >= 2 && transferMode === 'purchase_invoice') {
      searchPurchaseInvoices(debouncedInvoiceSearch);
    } else {
      setInvoiceSearchResults([]);
    }
  }, [debouncedInvoiceSearch, transferMode]);

  // Close invoice results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (invoiceSearchRef.current && !invoiceSearchRef.current.contains(event.target as Node)) {
        setShowInvoiceResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus scan input when source branch is selected
  useEffect(() => {
    if (sourceBranchId && transferMode === 'manual' && scanInputRef.current) {
      setTimeout(() => scanInputRef.current?.focus(), 100);
    }
  }, [sourceBranchId, transferMode]);

  // Search purchase invoices from server
  const searchPurchaseInvoices = async (query: string) => {
    if (!query || query.length < 2) {
      setInvoiceSearchResults([]);
      return;
    }

    setIsSearchingInvoices(true);
    try {
      const { data, error } = await dataGateway.queryTable('invoices', {
        select: 'id, invoice_number, invoice_date',
        filters: [
          { type: 'eq', column: 'invoice_type', value: 'purchase' },
          { type: 'ilike', column: 'invoice_number', value: `%${query}%` },
        ],
        order: { column: 'invoice_date', ascending: false },
        limit: 10,
      });

      if (error) {
        console.error('Error searching invoices:', error);
        return;
      }

      const results: PurchaseInvoice[] = (data || []).map((inv: any) => ({
        id: inv.id,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        supplier_name: null,
      }));

      setInvoiceSearchResults(results);
      setShowInvoiceResults(true);
    } finally {
      setIsSearchingInvoices(false);
    }
  };

  // Load items by purchase invoice
  const loadItemsByPurchaseInvoice = async (invoiceId: string) => {
    setIsLoadingInvoiceItems(true);
    try {
      const { data, error, count } = await dataGateway.queryTable('unique_items', {
        select: 'id, serial_no, stockcode, model, description, type, g_weight, tag_price, cost',
        filters: [
          { type: 'eq', column: 'unique_invoice_id', value: invoiceId },
          { type: 'is', column: 'sold_at', value: null },
        ],
        order: { column: 'serial_no', ascending: true },
        count: 'exact',
      });

      if (error) {
        console.error('Error loading invoice items:', error);
        toast.error('حدث خطأ في تحميل قطع الفاتورة');
        return;
      }

      setInvoiceItems(data || []);
      setInvoiceTotalCount(count ?? null);

      if (data && data.length > 0) {
        setSelectedInvoiceItems(new Set(data.map((item: JewelryItem) => item.id)));
        toast.success(`تم تحميل ${data.length} قطعة من الفاتورة`);
      } else {
        toast.info('لا توجد قطع متاحة للنقل في هذه الفاتورة');
      }
    } finally {
      setIsLoadingInvoiceItems(false);
    }
  };

  // Handle invoice selection
  const handleSelectInvoice = (invoice: PurchaseInvoice) => {
    setSelectedPurchaseInvoice(invoice);
    setInvoiceSearchQuery('');
    setInvoiceSearchResults([]);
    setShowInvoiceResults(false);
    loadItemsByPurchaseInvoice(invoice.id);
  };

  // Clear selected invoice
  const handleClearInvoice = () => {
    setSelectedPurchaseInvoice(null);
    setInvoiceItems([]);
    setSelectedInvoiceItems(new Set());
    setInvoiceTotalCount(null);
  };

  const handleSourceChange = (value: string) => {
    setSourceBranchId(value);
    setScanInput('');
    setAddedItems([]);
  };

  // Search and add item by serial/barcode
  const handleAddItem = async () => {
    const query = scanInput.trim();
    if (!query) {
      toast.error('يرجى إدخال رقم السيريال أو الباركود');
      return;
    }

    if (!sourceBranchId) {
      toast.error('يرجى اختيار الفرع المصدر أولاً');
      return;
    }

    // Check if item already added
    const alreadyAdded = addedItems.find(
      (item) => item.item_code === query || item.barcode === query
    );
    if (alreadyAdded) {
      toast.error('هذه القطعة مضافة بالفعل');
      setScanInput('');
      scanInputRef.current?.focus();
      return;
    }

    setIsSearchingItem(true);
    try {
      // Search by exact item_code or stockcode match in the source branch
      const { data, error } = await dataGateway.queryTable('unique_items', {
        select: 'id, serial_no, stockcode, model, description, type, g_weight, tag_price, cost',
        filters: [
          { type: 'eq', column: 'branch_id', value: sourceBranchId },
          { type: 'is', column: 'sold_at', value: null },
          { type: 'or', value: `serial_no.eq.${query},stockcode.eq.${query}` },
        ],
        limit: 1,
      });

      if (error) {
        console.error('Error searching item:', error);
        toast.error('حدث خطأ في البحث');
        return;
      }

      if (!data || data.length === 0) {
        const { data: partialData, error: partialError } = await dataGateway.queryTable('unique_items', {
          select: 'id, serial_no, stockcode, model, description, type, g_weight, tag_price, cost',
          filters: [
            { type: 'eq', column: 'branch_id', value: sourceBranchId },
            { type: 'is', column: 'sold_at', value: null },
            { type: 'or', value: `serial_no.ilike.%${query}%,stockcode.ilike.%${query}%` },
          ],
          limit: 1,
        });

        if (partialError || !partialData || partialData.length === 0) {
          toast.error('لم يتم العثور على القطعة في هذا الفرع');
          scanInputRef.current?.focus();
          return;
        }

        // Check if partial match is already added
        const alreadyExists = addedItems.find((item) => item.id === partialData[0].id);
        if (alreadyExists) {
          toast.error('هذه القطعة مضافة بالفعل');
          setScanInput('');
          scanInputRef.current?.focus();
          return;
        }

        setAddedItems((prev) => [...prev, partialData[0]]);
        toast.success(`تمت إضافة ${partialData[0].item_code}`);
      } else {
        // Check if exact match is already added by id
        const alreadyExists = addedItems.find((item) => item.id === data[0].id);
        if (alreadyExists) {
          toast.error('هذه القطعة مضافة بالفعل');
          setScanInput('');
          scanInputRef.current?.focus();
          return;
        }

        setAddedItems((prev) => [...prev, data[0]]);
        toast.success(`تمت إضافة ${data[0].item_code}`);
      }

      setScanInput('');
      scanInputRef.current?.focus();
    } finally {
      setIsSearchingItem(false);
    }
  };

  // Handle Enter key in scan input
  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddItem();
    }
  };

  // Remove item from added list
  const removeItem = (itemId: string) => {
    setAddedItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  // Toggle invoice item selection
  const toggleInvoiceItem = (itemId: string) => {
    const newSelected = new Set(selectedInvoiceItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedInvoiceItems(newSelected);
  };

  const toggleSelectAllInvoice = () => {
    if (selectedInvoiceItems.size === invoiceItems.length && invoiceItems.length > 0) {
      setSelectedInvoiceItems(new Set());
    } else {
      setSelectedInvoiceItems(new Set(invoiceItems.map((item) => item.id)));
    }
  };

  // Compute total values for added items
  const totalWeight = useMemo(() => {
    const items = transferMode === 'manual' ? addedItems : invoiceItems.filter((i) => selectedInvoiceItems.has(i.id));
    return items.reduce((sum, item) => sum + (Number(item.weight_grams) || 0), 0);
  }, [addedItems, invoiceItems, selectedInvoiceItems, transferMode]);

  const totalCost = useMemo(() => {
    const items = transferMode === 'manual' ? addedItems : invoiceItems.filter((i) => selectedInvoiceItems.has(i.id));
    return items.reduce((sum, item) => sum + (Number(item.unit_cost) || Number(item.selling_price) || 0), 0);
  }, [addedItems, invoiceItems, selectedInvoiceItems, transferMode]);

  const handleTransfer = async () => {
    if (!targetBranchId) {
      toast.error('يرجى اختيار الفرع المستهدف');
      return;
    }

    let itemIds: string[] = [];
    let actualSourceBranchId = sourceBranchId;

    if (transferMode === 'manual') {
      if (!sourceBranchId) {
        toast.error('يرجى اختيار الفرع المصدر');
        return;
      }
      if (addedItems.length === 0) {
        toast.error('يرجى إضافة قطعة واحدة على الأقل');
        return;
      }
      if (sourceBranchId === targetBranchId) {
        toast.error('الفرع المصدر والمستهدف متماثلان');
        return;
      }
      itemIds = addedItems.map((item) => item.id);
    } else {
      if (!selectedPurchaseInvoice) {
        toast.error('يجب اختيار فاتورة مشتريات');
        return;
      }
      if (selectedInvoiceItems.size === 0) {
        toast.error('يرجى اختيار قطعة واحدة على الأقل');
        return;
      }
      itemIds = Array.from(selectedInvoiceItems);

      // Get source branch from first item
      const firstItem = invoiceItems.find((i) => selectedInvoiceItems.has(i.id));
      if (firstItem) {
        const { data: itemData } = await dataGateway.queryTable('unique_items', {
          select: 'branch_id',
          filters: [
            { type: 'eq', column: 'id', value: firstItem.id },
          ],
          limit: 1,
          single: true,
        });
        if (itemData) {
          actualSourceBranchId = itemData.branch_id;
        }
      }
    }

    setIsMoving(true);

    try {
      const { executeTransferWithChecks } = await import('@/lib/transfer-post-checks');

      const { result, postCheck, isPartialSuccess } = await executeTransferWithChecks(
        actualSourceBranchId,
        targetBranchId,
        itemIds,
        selectedPurchaseInvoice
          ? `نقل من فاتورة ${selectedPurchaseInvoice.invoice_number}`
          : null,
        selectedPurchaseInvoice?.id || null
      );

      if (!result.success) {
        throw new Error(result.error || 'فشل النقل');
      }

      if (postCheck) {
        if (isPartialSuccess) {
          toast.warning('نجاح جزئي - يرجى مراجعة التفاصيل', {
            description: postCheck.details.filter((d: string) => d.startsWith('❌')).join('\n'),
            duration: 10000,
          });
        } else {
          const targetBranch = branches?.find((b) => b.id === targetBranchId);
          toast.success(`تم نقل ${itemIds.length} قطعة إلى ${targetBranch?.branch_name}`);
        }
      }

      setTransferId(result.transfer_id || null);
      setJournalEntryId(result.journal_entry_id || null);
      setShowSuccess(true);
      onSuccess();
    } catch (error: any) {
      console.error('Transfer error:', error);
      toast.error(error.message || 'حدث خطأ أثناء نقل القطع');
    }

    setIsMoving(false);
  };

  const resetState = () => {
    setSourceBranchId('');
    setTargetBranchId('');
    setAddedItems([]);
    setScanInput('');
    setShowSuccess(false);
    setTransferId(null);
    setTransferMode('manual');
    setInvoiceSearchQuery('');
    setSelectedPurchaseInvoice(null);
    setInvoiceSearchResults([]);
    setInvoiceItems([]);
    setSelectedInvoiceItems(new Set());
    setInvoiceTotalCount(null);
    setJournalEntryId(null);
  };

  // Reset when transfer mode changes
  useEffect(() => {
    setAddedItems([]);
    setScanInput('');
    setInvoiceItems([]);
    setSelectedInvoiceItems(new Set());
    setInvoiceTotalCount(null);
    setInvoiceSearchQuery('');
    setSelectedPurchaseInvoice(null);
  }, [transferMode]);

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const sourceBranch = branches?.find((b) => b.id === sourceBranchId);
  const targetBranch = branches?.find((b) => b.id === targetBranchId);

  // Get the active item count
  const activeItemCount = transferMode === 'manual' ? addedItems.length : selectedInvoiceItems.size;

  // Success view with print option
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
              تم نقل القطع من {sourceBranch?.branch_name || 'الفرع'} إلى {targetBranch?.branch_name}
              {journalEntryId && (
                <span className="block mt-1 text-green-600">
                  تم إنشاء القيد المحاسبي تلقائياً
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {journalEntryId && (
            <div className="bg-muted/50 p-4 rounded-lg border flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <BookOpen className="w-5 h-5 text-primary" />
                <div>
                  <p className="font-medium text-sm">القيد المحاسبي</p>
                  <p className="text-xs text-muted-foreground">نقل مخزون داخلي بين الفروع</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/accounting/journal-entries?entry=${journalEntryId}`, '_blank')}
              >
                <BookOpen className="w-4 h-4 ml-2" />
                عرض القيد
              </Button>
            </div>
          )}

          <ScrollArea className="max-h-[50vh]">
            <TransferReceipt
              ref={receiptRef}
              transferId={transferId}
            />
          </ScrollArea>

          <div className="flex justify-end gap-3 pt-4 border-t flex-wrap">
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
    <Dialog open={open} onOpenChange={(open) => {
      if (!open) resetState();
      onOpenChange(open);
    }}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-gold" />
            نقل قطع محددة
          </DialogTitle>
          <DialogDescription>
            اسكن الباركود أو اكتب السيريال لإضافة القطع
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Transfer Mode Selection */}
          <div className="space-y-2">
            <Label>طريقة النقل</Label>
            <RadioGroup
              value={transferMode}
              onValueChange={(v) => setTransferMode(v as 'manual' | 'purchase_invoice')}
              className="flex gap-4 flex-wrap"
            >
              <div className="flex items-center space-x-2 space-x-reverse">
                <RadioGroupItem value="manual" id="manual" data-testid="radio-manual-mode" />
                <Label htmlFor="manual" className="cursor-pointer flex items-center gap-2">
                  <ScanBarcode className="w-4 h-4" />
                  سكان / سيريال
                </Label>
              </div>
              <div className="flex items-center space-x-2 space-x-reverse">
                <RadioGroupItem value="purchase_invoice" id="purchase_invoice" data-testid="radio-invoice-mode" />
                <Label htmlFor="purchase_invoice" className="cursor-pointer flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  نقل حسب فاتورة مشتريات
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Branch Selection */}
          <div className={`grid gap-4 ${transferMode === 'manual' ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {transferMode === 'manual' && (
              <div className="space-y-2">
                <Label>الفرع المصدر</Label>
                <Select value={sourceBranchId} onValueChange={handleSourceChange}>
                  <SelectTrigger data-testid="select-source-branch">
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
              </div>
            )}

            <div className="space-y-2">
              <Label>الفرع المستهدف</Label>
              <Select value={targetBranchId} onValueChange={setTargetBranchId}>
                <SelectTrigger data-testid="select-target-branch">
                  <SelectValue placeholder="اختر الفرع المستهدف..." />
                </SelectTrigger>
                <SelectContent>
                  {branches?.filter((b) => b.id !== sourceBranchId).map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name} ({branch.branch_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ======= MANUAL MODE: Scan/Serial Input ======= */}
          {transferMode === 'manual' && sourceBranchId && (
            <div className="space-y-4">
              {/* Scan Input Row */}
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
                  <Label className="flex items-center gap-2">
                    <ScanBarcode className="w-4 h-4" />
                    سكان الباركود / رقم السيريال
                  </Label>
                  <div className="relative">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      ref={scanInputRef}
                      placeholder="اسكن الباركود أو اكتب الكود (مثال: ITM-00003027)..."
                      value={scanInput}
                      onChange={(e) => setScanInput(e.target.value)}
                      onKeyDown={handleScanKeyDown}
                      className="pr-10 font-mono"
                      data-testid="input-scan-serial"
                      autoFocus
                    />
                  </div>
                </div>
                <Button
                  onClick={handleAddItem}
                  disabled={isSearchingItem || !scanInput.trim()}
                  data-testid="button-add-item"
                >
                  {isSearchingItem ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  <span className="mr-2">إضافة</span>
                </Button>
              </div>

              {/* Added Items List (invoice-style) */}
              <div className="border rounded-lg">
                <div className="flex items-center justify-between p-3 border-b bg-muted/30 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">قائمة القطع المضافة</span>
                  </div>
                  <Badge variant="secondary">
                    {addedItems.length} قطعة
                  </Badge>
                </div>

                <ScrollArea className="h-[280px]">
                  {addedItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground">
                      <ScanBarcode className="w-12 h-12 mb-3 opacity-30" />
                      <p className="text-sm">اسكن الباركود أو اكتب السيريال لإضافة القطع</p>
                      <p className="text-xs mt-1">اضغط Enter أو زر الإضافة (+)</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>كود القطعة</TableHead>
                          <TableHead>الباركود</TableHead>
                          <TableHead>الموديل</TableHead>
                          <TableHead>فاتورة المورد</TableHead>
                          <TableHead>النوع</TableHead>
                          <TableHead>الوزن (جم)</TableHead>
                          <TableHead>السعر</TableHead>
                          <TableHead className="w-10"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {addedItems.map((item, index) => (
                          <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                            <TableCell className="text-muted-foreground text-sm">{index + 1}</TableCell>
                            <TableCell className="font-mono text-sm">{item.item_code}</TableCell>
                            <TableCell className="font-mono text-sm">{item.barcode || '-'}</TableCell>
                            <TableCell>{item.model || '-'}</TableCell>
                            <TableCell className="text-sm">{item.supp_ref || '-'}</TableCell>
                            <TableCell>{item.type || '-'}</TableCell>
                            <TableCell>{item.weight_grams != null ? Number(item.weight_grams).toFixed(2) : '-'}</TableCell>
                            <TableCell>{item.selling_price != null ? Number(item.selling_price).toLocaleString() : '-'}</TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeItem(item.id)}
                                className="text-destructive"
                                data-testid={`button-remove-item-${item.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>

                {/* Totals Footer */}
                {addedItems.length > 0 && (
                  <div className="flex items-center justify-between p-3 border-t bg-muted/20 flex-wrap gap-2">
                    <div className="flex items-center gap-4 text-sm">
                      <span>الوزن: <strong>{totalWeight.toFixed(2)} جم</strong></span>
                      <span>التكلفة: <strong>{totalCost.toLocaleString()} ر.س</strong></span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAddedItems([])}
                      className="text-destructive"
                      data-testid="button-clear-all"
                    >
                      <Trash2 className="w-3 h-3 ml-1" />
                      مسح الكل
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Prompt to select branch first in manual mode */}
          {transferMode === 'manual' && !sourceBranchId && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border rounded-lg">
              <ArrowRightLeft className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">اختر الفرع المصدر أولاً</p>
            </div>
          )}

          {/* ======= PURCHASE INVOICE MODE ======= */}
          {transferMode === 'purchase_invoice' && (
            <div className="space-y-2">
              <Label>فاتورة المشتريات</Label>

              {selectedPurchaseInvoice ? (
                <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/50 flex-wrap">
                  <FileText className="w-5 h-5 text-primary" />
                  <div className="flex-1">
                    <p className="font-medium">{selectedPurchaseInvoice.invoice_number}</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedPurchaseInvoice.supplier_name || 'مورد غير محدد'} {selectedPurchaseInvoice.invoice_date}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={handleClearInvoice}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="relative" ref={invoiceSearchRef}>
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="ابحث برقم فاتورة المشتريات..."
                    value={invoiceSearchQuery}
                    onChange={(e) => {
                      setInvoiceSearchQuery(e.target.value);
                      setShowInvoiceResults(true);
                    }}
                    onFocus={() => invoiceSearchResults.length > 0 && setShowInvoiceResults(true)}
                    className="pr-10"
                    data-testid="input-invoice-search"
                  />
                  {isSearchingInvoices && (
                    <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                  )}

                  {showInvoiceResults && invoiceSearchResults.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-64 overflow-auto">
                      {invoiceSearchResults.map((invoice) => (
                        <button
                          key={invoice.id}
                          onClick={() => handleSelectInvoice(invoice)}
                          className="w-full p-3 text-right hover-elevate border-b last:border-b-0 flex items-center gap-3"
                          data-testid={`button-select-invoice-${invoice.id}`}
                        >
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <div className="flex-1">
                            <p className="font-medium">{invoice.invoice_number}</p>
                            <p className="text-sm text-muted-foreground">
                              {invoice.supplier_name || 'مورد غير محدد'} {invoice.invoice_date}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {showInvoiceResults && invoiceSearchQuery.length >= 2 && invoiceSearchResults.length === 0 && !isSearchingInvoices && (
                    <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg p-4 text-center text-muted-foreground">
                      لا توجد نتائج للبحث
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Items Table for Purchase Invoice Mode */}
          {transferMode === 'purchase_invoice' && selectedPurchaseInvoice && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm text-muted-foreground">
                  {invoiceTotalCount !== null && (
                    <span>إجمالي القطع: {invoiceTotalCount} | </span>
                  )}
                  تم اختيار: <span className="font-semibold text-foreground">{selectedInvoiceItems.size}</span>
                </div>
                <Badge variant="outline" className="gap-1">
                  <FileText className="w-3 h-3" />
                  {selectedPurchaseInvoice.invoice_number}
                </Badge>
              </div>

              <ScrollArea className="h-[300px] border rounded-lg">
                {isLoadingInvoiceItems ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : invoiceItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <Package className="w-12 h-12 mb-2 opacity-50" />
                    <p>لا توجد قطع متاحة للنقل في هذه الفاتورة</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={selectedInvoiceItems.size === invoiceItems.length && invoiceItems.length > 0}
                            onCheckedChange={toggleSelectAllInvoice}
                          />
                        </TableHead>
                        <TableHead>كود القطعة</TableHead>
                        <TableHead>الباركود</TableHead>
                        <TableHead>الموديل</TableHead>
                        <TableHead>فاتورة المورد</TableHead>
                        <TableHead>النوع</TableHead>
                        <TableHead>الوزن (جم)</TableHead>
                        <TableHead>السعر</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoiceItems.map((item) => (
                        <TableRow
                          key={item.id}
                          className={selectedInvoiceItems.has(item.id) ? 'bg-primary/5' : ''}
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedInvoiceItems.has(item.id)}
                              onCheckedChange={() => toggleInvoiceItem(item.id)}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-sm">{item.item_code}</TableCell>
                          <TableCell className="font-mono text-sm">{item.barcode || '-'}</TableCell>
                          <TableCell>{item.model || '-'}</TableCell>
                          <TableCell className="text-sm">{item.supp_ref || '-'}</TableCell>
                          <TableCell>{item.type || '-'}</TableCell>
                          <TableCell>{item.weight_grams != null ? Number(item.weight_grams).toFixed(2) : '-'}</TableCell>
                          <TableCell>{item.selling_price != null ? Number(item.selling_price).toLocaleString() : '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between items-center pt-4 border-t flex-wrap gap-2">
            <div className="text-sm text-muted-foreground">
              {activeItemCount > 0 && (
                <span>سيتم نقل {activeItemCount} قطعة</span>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
                إلغاء
              </Button>
              <Button
                onClick={handleTransfer}
                disabled={
                  isMoving ||
                  !targetBranchId ||
                  activeItemCount === 0 ||
                  (transferMode === 'manual' && !sourceBranchId) ||
                  (transferMode === 'purchase_invoice' && !selectedPurchaseInvoice)
                }
                data-testid="button-transfer"
              >
                {isMoving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                نقل القطع ({activeItemCount})
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
