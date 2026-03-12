import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import { useLanguage } from '@/contexts/LanguageContext';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { 
  ArrowRightLeft, 
  Building2, 
  Search, 
  Package, 
  Loader2, 
  FileText,
  Calendar,
  Eye,
  BookOpen,
  Check,
  X,
  Printer,
  RotateCcw,
  Plus,
  Trash2,
  ScanBarcode
} from 'lucide-react';
import { useBranches } from '@/hooks/useBranches';
import { 
  useCreateTransferV2, 
  useSearchPurchaseInvoices,
  useItemsByPurchaseInvoice,
  PurchaseInvoiceSearchResult
} from '@/hooks/useTransfersV2';
import { useTransfersList, getTransferActionAvailability, useReverseTransferV2 } from '@/hooks/useTransfersV2ReadModel';
import { TransferFiltersDTO, TransferListItemDTO } from '@/types/transfers.v2.dto';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { TransferDetailsDialog } from '@/components/transfers/TransferDetailsDialog';
import TransferReceipt from '@/components/transfers/TransferReceipt';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { getTransferStatusDisplay } from '@/lib/transfer-accounting';

type TransferMode = 'manual' | 'invoice';

// Phase D1: Page uses unified read hooks - NO direct database queries here

export default function TransfersCenterPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  // ============================================
  // STATE - CREATE SECTION
  // ============================================
  const [mode, setMode] = useState<TransferMode>('manual');
  const [fromBranchId, setFromBranchId] = useState<string>('');
  const [toBranchId, setToBranchId] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // Manual mode: scan-to-add
  const [scanInput, setScanInput] = useState('');
  const [isSearchingItem, setIsSearchingItem] = useState(false);
  const [addedItems, setAddedItems] = useState<any[]>([]);
  const scanInputRef = useRef<HTMLInputElement>(null);
  
  // Invoice mode
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoiceSearchResult | null>(null);
  
  // ============================================
  // STATE - LIST SECTION
  // ============================================
  const [filters, setFilters] = useState<TransferFiltersDTO>({});
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [printTransferId, setPrintTransferId] = useState<string | null>(null);
  
  // Reverse confirmation state
  const [reverseDialogOpen, setReverseDialogOpen] = useState(false);
  const [transferToReverse, setTransferToReverse] = useState<TransferListItemDTO | null>(null);

  // ============================================
  // PRINT REF & HANDLER
  // ============================================
  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Transfer-${printTransferId || 'Receipt'}`,
    onAfterPrint: () => setPrintTransferId(null),
  });

  // ============================================
  // DEBOUNCED VALUES (350ms delay, ignores stale requests)
  // ============================================
  const debouncedInvoiceSearch = useDebouncedValue(invoiceSearch, 350);

  // ============================================
  // QUERIES & MUTATIONS
  // ============================================
  const { data: branches = [] } = useBranches(true);
  const createTransfer = useCreateTransferV2();
  const reverseTransfer = useReverseTransferV2();
  
  const { data: transfers = [], isLoading: transfersLoading } = useTransfersList(filters);
  
  // Invoice mode: search invoices (uses DEBOUNCED search)
  const { data: invoiceResults = [] } = useSearchPurchaseInvoices(
    mode === 'invoice' ? debouncedInvoiceSearch : ''
  );
  
  // Invoice mode: items from selected invoice
  const { data: invoiceItems = [], isLoading: invoiceItemsLoading } = useItemsByPurchaseInvoice(
    mode === 'invoice' ? selectedInvoice?.id || null : null
  );

  // ============================================
  // COMPUTED
  // ============================================
  const manualTotalCost = addedItems.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
  const manualTotalWeight = addedItems.reduce((sum, item) => sum + (Number(item.g_weight) || 0), 0);
  
  const invoiceSelectedList = invoiceItems.filter(item => selectedItems.has(item.id));
  const invoiceTotalCost = invoiceSelectedList.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
  const invoiceTotalWeight = invoiceSelectedList.reduce((sum, item) => sum + (Number(item.g_weight) || 0), 0);

  // ============================================
  // HANDLERS
  // ============================================
  const handleModeChange = (newMode: TransferMode) => {
    setMode(newMode);
    setSelectedItems(new Set());
    setSelectedInvoice(null);
    setInvoiceSearch('');
    setScanInput('');
    setAddedItems([]);
  };

  // Manual mode: scan-to-add handler
  const handleScanAdd = useCallback(async () => {
    const query = scanInput.trim();
    if (!query || !fromBranchId) return;

    if (addedItems.some(i => i.item_code === query)) {
      toast.error('هذه القطعة مضافة بالفعل');
      setScanInput('');
      scanInputRef.current?.focus();
      return;
    }

    setIsSearchingItem(true);
    try {
      const params = new URLSearchParams({ branch_id: fromBranchId, search: query });
      const response = await fetch(`/api/inventory/transferable-items?${params}`);
      if (!response.ok) {
        toast.error('حدث خطأ في البحث');
        return;
      }
      const result = await response.json();
      if (result.error) {
        toast.error('حدث خطأ في البحث');
        return;
      }

      const items: any[] = result.data || [];
      const exactMatch = items.find(
        (i: any) => i.item_code?.toLowerCase() === query.toLowerCase() || i.stockcode?.toLowerCase() === query.toLowerCase()
      );
      const foundItem = exactMatch || (items.length > 0 ? items[0] : null);

      if (!foundItem) {
        toast.error('لم يتم العثور على القطعة في هذا الفرع');
        scanInputRef.current?.focus();
        return;
      }

      if (addedItems.some(i => i.id === foundItem.id)) {
        toast.error('هذه القطعة مضافة بالفعل');
        setScanInput('');
        scanInputRef.current?.focus();
        return;
      }

      setAddedItems(prev => [...prev, foundItem]);
      setScanInput('');
      toast.success(`تمت إضافة: ${foundItem.item_code}`);
    } finally {
      setIsSearchingItem(false);
      scanInputRef.current?.focus();
    }
  }, [scanInput, fromBranchId, addedItems]);

  const handleRemoveItem = (itemId: string) => {
    setAddedItems(prev => prev.filter(i => i.id !== itemId));
  };

  const handleSelectAll = () => {
    if (selectedItems.size === invoiceItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(invoiceItems.map(item => item.id)));
    }
  };

  const handleToggleItem = (itemId: string) => {
    const newSet = new Set(selectedItems);
    if (newSet.has(itemId)) {
      newSet.delete(itemId);
    } else {
      newSet.add(itemId);
    }
    setSelectedItems(newSet);
  };

  const handleSelectInvoice = (invoice: PurchaseInvoiceSearchResult) => {
    setSelectedInvoice(invoice);
    setInvoiceSearch('');
    setSelectedItems(new Set());
    if (invoice.branch_id) {
      setFromBranchId(invoice.branch_id);
    }
  };

  const handleSubmit = async () => {
    if (!toBranchId) {
      toast.error('يرجى اختيار الفرع المستهدف');
      return;
    }

    const itemIds = mode === 'manual'
      ? addedItems.map(i => i.id)
      : Array.from(selectedItems);

    if (itemIds.length === 0) {
      toast.error('يرجى إضافة قطعة واحدة على الأقل');
      return;
    }
    
    const effectiveFromBranch = mode === 'invoice' && selectedInvoice?.branch_id 
      ? selectedInvoice.branch_id 
      : fromBranchId || null;
    
    if (effectiveFromBranch === toBranchId) {
      toast.error('لا يمكن النقل إلى نفس الفرع');
      return;
    }

    const result = await createTransfer.mutateAsync({
      from_branch_id: effectiveFromBranch,
      to_branch_id: toBranchId,
      item_ids: itemIds,
      notes: mode === 'invoice' && selectedInvoice 
        ? `نقل من فاتورة ${selectedInvoice.invoice_number}` 
        : null,
      purchase_invoice_id: mode === 'invoice' ? selectedInvoice?.id : undefined
    });

    if (result.success) {
      toast.success(`تم نقل ${result.total_items} قطعة بنجاح`, {
        description: `رقم العملية: ${result.transfer_code}`
      });
      setSelectedItems(new Set());
      setSelectedInvoice(null);
      setInvoiceSearch('');
      setScanInput('');
      setAddedItems([]);
    } else {
      toast.error(result.error || 'فشل النقل');
    }
  };

  const handleReverseConfirm = async () => {
    if (!transferToReverse) return;
    
    const result = await reverseTransfer.mutateAsync({
      transfer_id: transferToReverse.id,
    });

    if (result.success) {
      toast.success('تم عكس التحويل بنجاح', {
        description: `رقم العملية العكسية: ${result.reversal_transfer_code}`
      });
      setReverseDialogOpen(false);
      setTransferToReverse(null);
    } else {
      toast.error(result.error || 'فشل عكس التحويل');
    }
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowRightLeft className="w-6 h-6 text-primary" />
            {t.transfers.title}
          </h1>
          <p className="text-muted-foreground">{t.transfers.subtitle}</p>
        </div>

        {/* ============================================ */}
        {/* TOP SECTION: CREATE TRANSFER */}
        {/* ============================================ */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t.transfers.newTransfer}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Mode Selection */}
            <RadioGroup 
              value={mode} 
              onValueChange={(v) => handleModeChange(v as TransferMode)}
              className="flex gap-6"
            >
              <div className="flex items-center space-x-2 space-x-reverse">
                <RadioGroupItem value="manual" id="manual" />
                <Label htmlFor="manual" className="cursor-pointer">{t.transfers.selectiveMove}</Label>
              </div>
              <div className="flex items-center space-x-2 space-x-reverse">
                <RadioGroupItem value="invoice" id="invoice" />
                <Label htmlFor="invoice" className="cursor-pointer">{t.transfers.byInvoice}</Label>
              </div>
            </RadioGroup>

            <Separator />

            {/* Branch Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {mode === 'manual' && (
                <div className="space-y-2">
                  <Label>{t.transfers.fromBranch}</Label>
                  <Select value={fromBranchId} onValueChange={setFromBranchId}>
                    <SelectTrigger>
                      <SelectValue placeholder={t.transfers.selectSourceBranch} />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map(branch => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.branch_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              {mode === 'invoice' && (
                <div className="space-y-2">
                  <Label>{t.transfers.searchInvoice}</Label>
                  <div className="relative">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="رقم الفاتورة..."
                      value={invoiceSearch}
                      onChange={(e) => setInvoiceSearch(e.target.value)}
                      className="pr-10"
                    />
                  </div>
                  {invoiceResults.length > 0 && invoiceSearch && (
                    <Card className="absolute z-50 mt-1 max-h-60 overflow-auto">
                      <CardContent className="p-2">
                        {invoiceResults.map(inv => (
                          <div
                            key={inv.id}
                            className="p-2 hover:bg-muted rounded cursor-pointer"
                            onClick={() => handleSelectInvoice(inv)}
                          >
                            <div className="font-medium">{inv.invoice_number}{inv.supp_inv ? ` (${inv.supp_inv})` : ''}</div>
                            <div className="text-sm text-muted-foreground">
                              {inv.supplier_name} - {inv.branch_name}
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                  {selectedInvoice && (
                    <div className="p-3 bg-muted rounded-lg flex items-center justify-between">
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          {selectedInvoice.invoice_number}{selectedInvoice.supp_inv ? ` (${selectedInvoice.supp_inv})` : ''}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {selectedInvoice.supplier_name} - {selectedInvoice.branch_name}
                        </div>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => setSelectedInvoice(null)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
              
              <div className="space-y-2">
                <Label>{t.transfers.toBranch}</Label>
                <Select value={toBranchId} onValueChange={setToBranchId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.transfers.selectDestBranch} />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map(branch => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.branch_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Manual mode: Scan-to-Add */}
            {mode === 'manual' && fromBranchId && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <ScanBarcode className="w-4 h-4" />
                    مسح / إدخال رقم القطعة
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      ref={scanInputRef}
                      placeholder="امسح الباركود أو اكتب رقم القطعة..."
                      value={scanInput}
                      onChange={(e) => setScanInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleScanAdd();
                        }
                      }}
                      disabled={isSearchingItem}
                      autoFocus
                      data-testid="input-scan-barcode"
                    />
                    <Button
                      onClick={handleScanAdd}
                      disabled={isSearchingItem || !scanInput.trim()}
                      data-testid="button-add-scan-item"
                    >
                      {isSearchingItem ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {addedItems.length > 0 && (
                  <div className="border rounded-lg">
                    <div className="bg-muted p-3 flex items-center justify-between flex-wrap gap-2">
                      <span className="text-sm font-medium">
                        القطع المضافة ({addedItems.length})
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAddedItems([])}
                        className="text-destructive"
                        data-testid="button-clear-all-items"
                      >
                        <Trash2 className="w-3 h-3 ml-1" />
                        مسح الكل
                      </Button>
                    </div>
                    <div className="max-h-[300px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12 text-right">#</TableHead>
                            <TableHead className="text-right">{t.common.code}</TableHead>
                            <TableHead className="text-right">{t.transfers.model}</TableHead>
                            <TableHead className="text-right">فاتورة المورد</TableHead>
                            <TableHead className="text-right">{t.common.weight}</TableHead>
                            <TableHead className="text-right">{t.transfers.cost}</TableHead>
                            <TableHead className="w-12"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {addedItems.map((item, idx) => (
                            <TableRow key={item.id} data-testid={`row-added-item-${item.id}`}>
                              <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                              <TableCell className="font-mono text-sm">{item.item_code}</TableCell>
                              <TableCell>{item.model || item.description || '-'}</TableCell>
                              <TableCell className="text-sm">{item.supp_inv || '-'}</TableCell>
                              <TableCell>{item.g_weight != null ? Number(item.g_weight).toFixed(2) : '-'} g</TableCell>
                              <TableCell>{item.cost != null ? Number(item.cost).toLocaleString() : '-'} ر.س</TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRemoveItem(item.id)}
                                  data-testid={`button-remove-item-${item.id}`}
                                >
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="bg-muted/50 p-3 flex items-center justify-between flex-wrap gap-2 border-t">
                      <div className="flex gap-4 text-sm">
                        <span>الوزن: <strong>{manualTotalWeight.toFixed(2)} g</strong></span>
                        <span>التكلفة: <strong>{manualTotalCost.toLocaleString()} ر.س</strong></span>
                      </div>
                    </div>
                  </div>
                )}

                {addedItems.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground border rounded-lg">
                    <ScanBarcode className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p>امسح الباركود أو اكتب رقم القطعة لإضافتها</p>
                  </div>
                )}
              </div>
            )}

            {/* Invoice mode: Items Table with checkboxes */}
            {mode === 'invoice' && selectedInvoice && (
              <div className="border rounded-lg">
                <div className="bg-muted p-3 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-4">
                    <Checkbox
                      checked={invoiceItems.length > 0 && selectedItems.size === invoiceItems.length}
                      onCheckedChange={handleSelectAll}
                    />
                    <span className="text-sm font-medium">
                      {t.common.selectAll} ({invoiceItems.length} {t.common.pieces})
                    </span>
                  </div>
                  <Badge variant="secondary">
                    {t.common.selected}: {selectedItems.size} {t.common.pieces}
                  </Badge>
                </div>
                
                {invoiceItemsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : invoiceItems.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p>{t.transfers.noItemsToTransfer}</p>
                  </div>
                ) : (
                  <div className="max-h-[300px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"></TableHead>
                          <TableHead className="text-right">{t.common.code}</TableHead>
                          <TableHead className="text-right">{t.transfers.model}</TableHead>
                          <TableHead className="text-right">فاتورة المورد</TableHead>
                          <TableHead className="text-right">{t.common.weight}</TableHead>
                          <TableHead className="text-right">{t.transfers.cost}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoiceItems.map((item) => (
                          <TableRow 
                            key={item.id}
                            className={selectedItems.has(item.id) ? 'bg-primary/5' : ''}
                          >
                            <TableCell>
                              <Checkbox
                                checked={selectedItems.has(item.id)}
                                onCheckedChange={() => handleToggleItem(item.id)}
                              />
                            </TableCell>
                            <TableCell className="font-mono text-sm">{item.item_code}</TableCell>
                            <TableCell>{item.model || '-'}</TableCell>
                            <TableCell className="text-sm">{item.supp_inv || '-'}</TableCell>
                            <TableCell>{item.g_weight != null ? Number(item.g_weight).toFixed(2) : '-'} g</TableCell>
                            <TableCell>{item.cost != null ? Number(item.cost).toLocaleString() : '-'} ر.س</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}

            {/* Summary & Submit */}
            {((mode === 'manual' && addedItems.length > 0) || (mode === 'invoice' && selectedItems.size > 0)) && (
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg flex-wrap gap-2">
                <div className="flex gap-6 flex-wrap">
                  <div>
                    <span className="text-sm text-muted-foreground">{t.transfers.itemsCount}:</span>
                    <span className="font-bold mr-2">{mode === 'manual' ? addedItems.length : selectedItems.size}</span>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">{t.transfers.totalWeight}:</span>
                    <span className="font-bold mr-2">{(mode === 'manual' ? manualTotalWeight : invoiceTotalWeight).toFixed(2)} g</span>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">{t.transfers.totalCost}:</span>
                    <span className="font-bold mr-2">{(mode === 'manual' ? manualTotalCost : invoiceTotalCost).toLocaleString()} ر.س</span>
                  </div>
                </div>
                <Button 
                  onClick={handleSubmit}
                  disabled={createTransfer.isPending || !toBranchId}
                  data-testid="button-execute-transfer"
                >
                  {createTransfer.isPending ? (
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 ml-2" />
                  )}
                  {t.transfers.executeTransfer}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ============================================ */}
        {/* BOTTOM SECTION: TRANSFERS LIST */}
        {/* ============================================ */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5" />
              {t.transfers.transferHistory}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="space-y-1">
                <Label className="text-sm">{t.transfers.branch}</Label>
                <Select 
                  value={filters.branch_id || 'all'} 
                  onValueChange={(v) => setFilters({...filters, branch_id: v === 'all' ? undefined : v})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.transfers.allBranches} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.transfers.allBranches}</SelectItem>
                    {branches.map(branch => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.branch_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-sm">{t.common.from} {t.common.date}</Label>
                <Input
                  type="date"
                  value={filters.date_from || ''}
                  onChange={(e) => setFilters({...filters, date_from: e.target.value || undefined})}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">{t.common.to} {t.common.date}</Label>
                <Input
                  type="date"
                  value={filters.date_to || ''}
                  onChange={(e) => setFilters({...filters, date_to: e.target.value || undefined})}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">{t.common.search}</Label>
                <Input
                  placeholder={t.transfers.searchTransferCode}
                  value={filters.search || ''}
                  onChange={(e) => setFilters({...filters, search: e.target.value || undefined})}
                />
              </div>
              <div className="flex items-end">
                <Button 
                  variant="outline" 
                  onClick={() => setFilters({})}
                >
                  {t.common.reset}
                </Button>
              </div>
            </div>

            {/* Transfers Table */}
            {transfersLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : transfers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ArrowRightLeft className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>لا توجد عمليات نقل</p>
              </div>
            ) : (
              <div className="responsive-table-wrapper">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">رقم العملية</TableHead>
                    <TableHead className="text-right">التاريخ</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">من</TableHead>
                    <TableHead className="text-right">إلى</TableHead>
                    <TableHead className="text-right">القطع</TableHead>
                    <TableHead className="text-right">التكلفة</TableHead>
                    <TableHead className="text-right">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.map((transfer) => {
                    const statusDisplay = getTransferStatusDisplay(transfer.status as any);
                    return (
                      <TableRow 
                        key={transfer.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => {
                          setSelectedTransferId(transfer.id);
                          setShowDetailsDialog(true);
                        }}
                      >
                        <TableCell className="font-mono text-sm">
                          {transfer.transfer_code || transfer.id.slice(0, 8)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-muted-foreground" />
                            {format(new Date(transfer.transfer_date), 'yyyy/MM/dd', { locale: ar })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={`${statusDisplay.bgColor} ${statusDisplay.color} border-0`}>
                            {statusDisplay.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-muted-foreground" />
                            {transfer.from_branch?.branch_name || 'المستودع'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-muted-foreground" />
                            {transfer.to_branch?.branch_name || '-'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{transfer.total_items} قطعة</Badge>
                        </TableCell>
                        <TableCell className="font-mono">
                          {transfer.total_cost?.toLocaleString() || '-'} ر.س
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const actions = getTransferActionAvailability(transfer);
                            return (
                              <div className="flex items-center gap-1">
                                {/* View */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => {
                                        setSelectedTransferId(transfer.id);
                                        setShowDetailsDialog(true);
                                      }}
                                    >
                                      <Eye className="w-4 h-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>عرض التفاصيل</TooltipContent>
                                </Tooltip>

                                {/* Print */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => {
                                        setPrintTransferId(transfer.id);
                                        // Delay to allow receipt to render
                                        setTimeout(() => handlePrint(), 100);
                                      }}
                                    >
                                      <Printer className="w-4 h-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>طباعة الإيصال</TooltipContent>
                                </Tooltip>

                                {/* Journal Entry */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      disabled={!actions.can_open_journal}
                                      onClick={() => {
                                        if (transfer.journal_entry_id) {
                                          navigate(`/accounting/journal-entries?entry=${transfer.journal_entry_id}`);
                                        }
                                      }}
                                    >
                                      <BookOpen className="w-4 h-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {actions.can_open_journal ? 'عرض القيد المحاسبي' : 'لا يوجد قيد محاسبي'}
                                  </TooltipContent>
                                </Tooltip>

                                {/* Reverse */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      disabled={!actions.can_reverse || reverseTransfer.isPending}
                                      onClick={() => {
                                        setTransferToReverse(transfer);
                                        setReverseDialogOpen(true);
                                      }}
                                    >
                                      {reverseTransfer.isPending ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <RotateCcw className="w-4 h-4" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {actions.reverse_disabled_reason || 'عكس التحويل'}
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            );
                          })()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Hidden Print Component */}
        {printTransferId && (
          <div className="hidden">
            <TransferReceipt
              ref={printRef}
              transferId={printTransferId}
            />
          </div>
        )}

        {/* Details Dialog */}
        <TransferDetailsDialog
          transferId={selectedTransferId}
          open={showDetailsDialog}
          onOpenChange={setShowDetailsDialog}
        />

        {/* Reverse Confirmation Dialog */}
        <AlertDialog open={reverseDialogOpen} onOpenChange={setReverseDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>تأكيد عكس التحويل</AlertDialogTitle>
              <AlertDialogDescription>
                هل أنت متأكد من عكس التحويل{' '}
                <span className="font-bold">{transferToReverse?.transfer_code}</span>؟
                <br />
                سيتم إرجاع جميع القطع للفرع الأصلي وإنشاء قيد محاسبي عكسي.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <AlertDialogCancel onClick={() => setTransferToReverse(null)}>
                إلغاء
              </AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleReverseConfirm}
                disabled={reverseTransfer.isPending}
              >
                {reverseTransfer.isPending ? (
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                ) : null}
                تأكيد العكس
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout>
  );
}