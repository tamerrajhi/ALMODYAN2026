import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { 
  Search, 
  Package, 
  ShoppingCart, 
  ArrowLeftRight, 
  RotateCcw, 
  AlertTriangle, 
  Trash2, 
  Eye, 
  FileSpreadsheet, 
  Printer,
  MapPin,
  Calendar,
  User,
  Hash,
  Scale,
  Tag,
  XCircle,
  RefreshCw,
  ArrowDownLeft,
  ArrowUpRight,
  QrCode
} from 'lucide-react';
import * as XLSX from 'xlsx';

// Movement type configuration
const movementConfig = {
  IMPORT: { icon: Package, color: 'bg-green-100 text-green-700 border-green-200', label: { ar: 'استيراد', en: 'Import' } },
  PURCHASE: { icon: Package, color: 'bg-green-100 text-green-700 border-green-200', label: { ar: 'فاتورة مشتريات', en: 'Purchase Invoice' } },
  TRANSFER: { icon: ArrowLeftRight, color: 'bg-blue-100 text-blue-700 border-blue-200', label: { ar: 'عملية نقل', en: 'Transfer' } },
  TRANSFER_IN: { icon: ArrowDownLeft, color: 'bg-blue-100 text-blue-700 border-blue-200', label: { ar: 'استلام تحويل', en: 'Transfer In' } },
  TRANSFER_OUT: { icon: ArrowUpRight, color: 'bg-blue-100 text-blue-700 border-blue-200', label: { ar: 'إرسال تحويل', en: 'Transfer Out' } },
  SALE: { icon: ShoppingCart, color: 'bg-red-100 text-red-700 border-red-200', label: { ar: 'مبيعات', en: 'Sale' } },
  RETURN_IN: { icon: RotateCcw, color: 'bg-green-100 text-green-700 border-green-200', label: { ar: 'مرتجع للمخزن', en: 'Return to Stock' } },
  RETURN_OUT: { icon: RotateCcw, color: 'bg-amber-100 text-amber-700 border-amber-200', label: { ar: 'مرتجع للعميل', en: 'Return to Customer' } },
  ADJUSTMENT: { icon: AlertTriangle, color: 'bg-amber-100 text-amber-700 border-amber-200', label: { ar: 'تسوية', en: 'Adjustment' } },
  WRITE_OFF: { icon: Trash2, color: 'bg-red-100 text-red-700 border-red-200', label: { ar: 'إعدام', en: 'Write-off' } },
} as const;

type MovementType = keyof typeof movementConfig;

interface MovementEntry {
  id: string;
  date: Date;
  type: MovementType;
  documentType: string;
  documentNumber: string;
  documentId: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  quantity: number;
  performedBy: string | null;
  notes: string | null;
}

interface JewelryItem {
  id: string;
  serial_no: string;
  stockcode: string | null;
  model: string | null;
  description: string | null;
  karat: string | null;
  g_weight: number | null;
  d_weight: number | null;
  status: string | null;
  branch_id: string | null;
  created_at: string;
  branches?: { branch_name: string } | null;
  [key: string]: any; // Allow additional properties
}

const SerialTrackingPage = () => {
  const { language, t } = useLanguage();
  const isRTL = language === 'ar';
  
  // State
  const [serialNumber, setSerialNumber] = useState('');
  const [searchedSerial, setSearchedSerial] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [selectedMovementType, setSelectedMovementType] = useState<string>('all');
  const [previewDocument, setPreviewDocument] = useState<{ type: string; id: string } | null>(null);
  
  // Fetch branches for filter
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    }
  });
  
  // Fetch item by serial (Exact Match)
  const { data: item, isLoading: itemLoading, error: itemError } = useQuery({
    queryKey: ['serial-item', searchedSerial],
    queryFn: async () => {
      if (!searchedSerial) return null;
      
      const res = await fetch(`/api/item-by-serial?serial=${encodeURIComponent(searchedSerial!)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) as JewelryItem | null;
    },
    enabled: !!searchedSerial
  });
  
  // Fetch movements from item_movements table
  const { data: movements = [] } = useQuery({
    queryKey: ['serial-movements', item?.id],
    queryFn: async () => {
      if (!item?.id) return [];
      
      const res = await fetch(`/api/item-movements/${item!.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) || [];
    },
    enabled: !!item?.id
  });
  
  // Fetch transfers
  const { data: transfers = [] } = useQuery({
    queryKey: ['serial-transfers', item?.id],
    queryFn: async () => {
      if (!item?.id) return [];
      
      const res = await fetch(`/api/serial-transfers/${item!.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) || [];
    },
    enabled: !!item?.id
  });
  
  // Fetch sales
  const { data: sales = [] } = useQuery({
    queryKey: ['serial-sales', item?.id],
    queryFn: async () => {
      if (!item?.id) return [];
      
      const res = await fetch(`/api/serial-sales/${item!.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) || [];
    },
    enabled: !!item?.id
  });
  
  // Fetch returns
  const { data: returns = [] } = useQuery({
    queryKey: ['serial-returns', item?.id],
    queryFn: async () => {
      if (!item?.id) return [];
      
      const res = await fetch(`/api/serial-returns/${item!.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) || [];
    },
    enabled: !!item?.id
  });
  
  // Build unified timeline
  const timeline = useMemo<MovementEntry[]>(() => {
    if (!item) return [];
    
    const entries: MovementEntry[] = [];
    
    // Collect transfer IDs from transfer_items for deduplication
    const transferIds = new Set(
      transfers.map((tr: any) => tr.transfers?.id).filter(Boolean)
    );
    
    // Add import/creation entry
    entries.push({
      id: `import-${item.id}`,
      date: new Date(item.created_at),
      type: 'IMPORT',
      documentType: isRTL ? 'إدخال أولي' : 'Initial Entry',
      documentNumber: item.serial_no,
      documentId: null,
      fromLocation: null,
      toLocation: item.branches?.branch_name || null,
      quantity: 1,
      performedBy: null,
      notes: null
    });
    
    // Add movements - with deduplication check
    movements.forEach((m: any) => {
      // Skip if this movement is a TRANSFER and already covered by transfer_items
      if ((m.movement_type === 'TRANSFER' || m.movement_type === 'TRANSFER_IN' || m.movement_type === 'TRANSFER_OUT') && 
          m.reference_id && transferIds.has(m.reference_id)) {
        return; // Skip duplicate
      }
      
      entries.push({
        id: `movement-${m.id}`,
        date: new Date(m.movement_date),
        type: m.movement_type === 'TRANSFER_IN' ? 'TRANSFER_IN' : 
              m.movement_type === 'TRANSFER_OUT' ? 'TRANSFER_OUT' :
              m.movement_type === 'TRANSFER' ? 'TRANSFER' :
              m.movement_type === 'SALE' ? 'SALE' :
              m.movement_type === 'RETURN' ? 'RETURN_IN' : 'ADJUSTMENT',
        documentType: m.movement_type || 'Movement',
        documentNumber: m.reference_code || '-',
        documentId: m.reference_id,
        fromLocation: m.from_branch?.branch_name || null,
        toLocation: m.to_branch?.branch_name || null,
        quantity: m.quantity || 1,
        performedBy: m.performed_by,
        notes: m.notes
      });
    });
    
    // Add transfers - single unified entry per transfer (not TRANSFER_OUT + TRANSFER_IN)
    transfers.forEach((tr: any) => {
      const transfer = tr.transfers;
      if (!transfer) return;
      
      // Single unified transfer entry
      entries.push({
        id: `transfer-${tr.id}`,
        date: new Date(transfer.transfer_date),
        type: 'TRANSFER',
        documentType: isRTL ? 'عملية نقل' : 'Transfer',
        documentNumber: transfer.transfer_code,
        documentId: transfer.id,
        fromLocation: transfer.from_branch?.branch_name || null,
        toLocation: transfer.to_branch?.branch_name || null,
        quantity: 1,
        performedBy: transfer.transferred_by,
        notes: null
      });
    });
    
    // Add sales
    sales.forEach((s: any) => {
      const sale = s.sales;
      if (!sale) return;
      
      entries.push({
        id: `sale-${s.id}`,
        date: new Date(sale.sale_date),
        type: 'SALE',
        documentType: isRTL ? 'فاتورة مبيعات' : 'Sales Invoice',
        documentNumber: sale.invoice_number || sale.sale_code,
        documentId: sale.id,
        fromLocation: sale.branches?.branch_name || null,
        toLocation: sale.customers?.full_name || (isRTL ? 'عميل' : 'Customer'),
        quantity: -1,
        performedBy: sale.cashier_name,
        notes: null
      });
    });
    
    // Add returns
    returns.forEach((r: any) => {
      const ret = r.returns;
      if (!ret) return;
      
      entries.push({
        id: `return-${r.id}`,
        date: new Date(ret.return_date),
        type: ret.return_type === 'purchase' ? 'RETURN_OUT' : 'RETURN_IN',
        documentType: isRTL ? 'مرتجع' : 'Return',
        documentNumber: ret.return_code,
        documentId: ret.id,
        fromLocation: ret.customers?.full_name || null,
        toLocation: ret.branches?.branch_name || null,
        quantity: ret.return_type === 'purchase' ? -1 : 1,
        performedBy: ret.created_by,
        notes: null
      });
    });
    
    // Sort by date
    return entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [item, movements, transfers, sales, returns, isRTL]);
  
  // Filter timeline
  const filteredTimeline = useMemo(() => {
    return timeline.filter(entry => {
      // Date filter
      if (dateFrom && new Date(entry.date) < new Date(dateFrom)) return false;
      if (dateTo && new Date(entry.date) > new Date(dateTo + 'T23:59:59')) return false;
      
      // Movement type filter
      if (selectedMovementType !== 'all' && entry.type !== selectedMovementType) return false;
      
      // Branch filter
      if (selectedBranch !== 'all') {
        const branchName = branches.find(b => b.id === selectedBranch)?.branch_name;
        if (branchName && entry.fromLocation !== branchName && entry.toLocation !== branchName) return false;
      }
      
      return true;
    });
  }, [timeline, dateFrom, dateTo, selectedMovementType, selectedBranch, branches]);
  
  // Get last movement
  const lastMovement = timeline.length > 0 ? timeline[timeline.length - 1] : null;
  
  // Determine current status
  const getCurrentStatus = () => {
    if (!item) return null;
    
    if (item.status === 'SOLD' || sales.length > 0) {
      const lastSale = sales[sales.length - 1];
      const hasReturn = returns.some((r: any) => r.returns?.return_type === 'sales');
      if (hasReturn) {
        return { label: isRTL ? 'مرتجع للمخزن' : 'Returned', color: 'bg-amber-500' };
      }
      return { label: isRTL ? 'مباع' : 'Sold', color: 'bg-red-500' };
    }
    
    if (item.status === 'TRANSFERRED') {
      return { label: isRTL ? 'محول' : 'Transferred', color: 'bg-blue-500' };
    }
    
    return { label: isRTL ? 'في المخزن' : 'In Stock', color: 'bg-green-500' };
  };
  
  const currentStatus = getCurrentStatus();
  
  // Handle search
  const handleSearch = () => {
    if (!serialNumber.trim()) {
      toast.error(isRTL ? 'يرجى إدخال رقم السيريال' : 'Please enter a serial number');
      return;
    }
    setSearchedSerial(serialNumber.trim());
  };
  
  // Handle reset
  const handleReset = () => {
    setSerialNumber('');
    setSearchedSerial(null);
    setDateFrom('');
    setDateTo('');
    setSelectedBranch('all');
    setSelectedMovementType('all');
  };
  
  // Export to Excel
  const handleExportExcel = () => {
    if (filteredTimeline.length === 0) {
      toast.error(isRTL ? 'لا توجد بيانات للتصدير' : 'No data to export');
      return;
    }
    
    const data = filteredTimeline.map(entry => ({
      [isRTL ? 'التاريخ' : 'Date']: format(entry.date, 'yyyy-MM-dd HH:mm'),
      [isRTL ? 'نوع الحركة' : 'Movement Type']: movementConfig[entry.type].label[language],
      [isRTL ? 'نوع المستند' : 'Document Type']: entry.documentType,
      [isRTL ? 'رقم المستند' : 'Document Number']: entry.documentNumber,
      [isRTL ? 'من' : 'From']: entry.fromLocation || '-',
      [isRTL ? 'إلى' : 'To']: entry.toLocation || '-',
      [isRTL ? 'الكمية' : 'Quantity']: entry.quantity,
      [isRTL ? 'المستخدم' : 'User']: entry.performedBy || '-',
      [isRTL ? 'ملاحظات' : 'Notes']: entry.notes || '-',
    }));
    
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Serial History');
    XLSX.writeFile(wb, `serial-tracking-${searchedSerial}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success(isRTL ? 'تم تصدير البيانات بنجاح' : 'Data exported successfully');
  };
  
  // Handle print
  const handlePrint = () => {
    window.print();
  };
  
  return (
    <MainLayout>
      <div className="p-6 space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <QrCode className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">
                {isRTL ? 'تتبع حركة القطع' : 'Serial Tracking'}
              </h1>
              <p className="text-muted-foreground text-sm">
                {isRTL ? 'تتبع رحلة القطعة من الاستيراد إلى الوضع الحالي' : 'Track item journey from import to current status'}
              </p>
            </div>
          </div>
          
          {searchedSerial && item && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExportExcel}>
                <FileSpreadsheet className="h-4 w-4 me-2" />
                {isRTL ? 'تصدير Excel' : 'Export Excel'}
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="h-4 w-4 me-2" />
                {isRTL ? 'طباعة' : 'Print'}
              </Button>
            </div>
          )}
        </div>
        
        {/* Filters */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">{isRTL ? 'البحث والفلاتر' : 'Search & Filters'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Serial Number - Required */}
              <div className="lg:col-span-2 space-y-2">
                <Label className="flex items-center gap-1">
                  <Hash className="h-4 w-4" />
                  {isRTL ? 'رقم السيريال' : 'Serial Number'} <span className="text-destructive">*</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={serialNumber}
                    onChange={(e) => setSerialNumber(e.target.value)}
                    placeholder={isRTL ? 'أدخل السيريال...' : 'Enter serial...'}
                    className="flex-1"
                    dir="ltr"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                  <Button onClick={handleSearch} disabled={itemLoading}>
                    <Search className="h-4 w-4 me-2" />
                    {isRTL ? 'بحث' : 'Search'}
                  </Button>
                </div>
              </div>
              
              {/* Date From */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {isRTL ? 'من تاريخ' : 'From Date'}
                </Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              
              {/* Date To */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {isRTL ? 'إلى تاريخ' : 'To Date'}
                </Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
              
              {/* Branch Filter */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {isRTL ? 'الفرع' : 'Branch'}
                </Label>
                <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isRTL ? 'جميع الفروع' : 'All Branches'}</SelectItem>
                    {branches.map(branch => (
                      <SelectItem key={branch.id} value={branch.id}>{branch.branch_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {/* Second Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              {/* Movement Type Filter */}
              <div className="space-y-2">
                <Label>{isRTL ? 'نوع الحركة' : 'Movement Type'}</Label>
                <Select value={selectedMovementType} onValueChange={setSelectedMovementType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isRTL ? 'جميع الحركات' : 'All Movements'}</SelectItem>
                    {Object.entries(movementConfig).map(([key, config]) => (
                      <SelectItem key={key} value={key}>{config.label[language]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* Reset Button */}
              <div className="flex items-end">
                <Button variant="outline" onClick={handleReset} className="w-full md:w-auto">
                  <RefreshCw className="h-4 w-4 me-2" />
                  {isRTL ? 'إعادة تعيين' : 'Reset'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* No search yet message */}
        {!searchedSerial && (
          <Card className="py-12">
            <CardContent className="text-center text-muted-foreground">
              <QrCode className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg">
                {isRTL ? 'أدخل رقم السيريال للبدء بتتبع حركة القطعة' : 'Enter serial number to start tracking item movement'}
              </p>
            </CardContent>
          </Card>
        )}
        
        {/* Item not found */}
        {searchedSerial && !itemLoading && !item && (
          <Card className="py-12 border-destructive/50">
            <CardContent className="text-center text-destructive">
              <XCircle className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-semibold">
                {isRTL ? 'لم يتم العثور على القطعة' : 'Item not found'}
              </p>
              <p className="text-sm mt-2">
                {isRTL ? `السيريال: ${searchedSerial}` : `Serial: ${searchedSerial}`}
              </p>
            </CardContent>
          </Card>
        )}
        
        {/* Item Found - Summary Card */}
        {item && (
          <>
            <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-xl flex items-center gap-2">
                      <Hash className="h-5 w-5" />
                      {item.serial_no}
                    </CardTitle>
                    <CardDescription>{item.description || (isRTL ? 'بدون وصف' : 'No description')}</CardDescription>
                  </div>
                  {currentStatus && (
                    <Badge className={`${currentStatus.color} text-white px-3 py-1`}>
                      {currentStatus.label}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">{isRTL ? 'كود المخزون' : 'Stock Code'}</Label>
                    <p className="font-medium">{item.stockcode || '-'}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">{isRTL ? 'الموديل' : 'Model'}</Label>
                    <p className="font-medium">{item.model || '-'}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">{isRTL ? 'فاتورة المورد' : 'Supplier Invoice'}</Label>
                    <p className="font-medium">{item.supp_ref || '-'}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">{isRTL ? 'العيار' : 'Karat'}</Label>
                    <p className="font-medium">{item.karat || '-'}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">{isRTL ? 'وزن الذهب' : 'Gold Weight'}</Label>
                    <p className="font-medium">{item.g_weight ? `${item.g_weight} g` : '-'}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">{isRTL ? 'الفرع الحالي' : 'Current Branch'}</Label>
                    <p className="font-medium flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {item.branches?.branch_name || '-'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">{isRTL ? 'تاريخ الإدخال' : 'Entry Date'}</Label>
                    <p className="font-medium">
                      {format(new Date(item.created_at), 'yyyy-MM-dd', { locale: isRTL ? ar : undefined })}
                    </p>
                  </div>
                </div>
                
                {/* Last Movement */}
                {lastMovement && (
                  <>
                    <Separator className="my-4" />
                    <div className="bg-muted/50 rounded-lg p-3">
                      <Label className="text-muted-foreground text-xs mb-2 block">{isRTL ? 'آخر حركة' : 'Last Movement'}</Label>
                      <div className="flex items-center gap-4 flex-wrap">
                        <Badge variant="outline" className={movementConfig[lastMovement.type].color}>
                          {movementConfig[lastMovement.type].label[language]}
                        </Badge>
                        <span className="text-sm">
                          {format(lastMovement.date, 'yyyy-MM-dd HH:mm', { locale: isRTL ? ar : undefined })}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {lastMovement.documentNumber}
                        </span>
                        {lastMovement.performedBy && (
                          <span className="text-sm text-muted-foreground flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {lastMovement.performedBy}
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            
            {/* Timeline Table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ArrowLeftRight className="h-5 w-5" />
                  {isRTL ? 'سجل الحركات' : 'Movement History'}
                  <Badge variant="secondary" className="ms-2">{filteredTimeline.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {filteredTimeline.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertTriangle className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>{isRTL ? 'لا توجد حركات مطابقة للفلاتر المحددة' : 'No movements match the selected filters'}</p>
                  </div>
                ) : (
                  <div className="relative overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                          <TableHead className="min-w-[140px]">{isRTL ? 'التاريخ والوقت' : 'Date & Time'}</TableHead>
                          <TableHead className="min-w-[120px]">{isRTL ? 'نوع الحركة' : 'Movement Type'}</TableHead>
                          <TableHead>{isRTL ? 'نوع المستند' : 'Document Type'}</TableHead>
                          <TableHead>{isRTL ? 'رقم المستند' : 'Document #'}</TableHead>
                          <TableHead>{isRTL ? 'من' : 'From'}</TableHead>
                          <TableHead>{isRTL ? 'إلى' : 'To'}</TableHead>
                          <TableHead className="text-center">{isRTL ? 'الكمية' : 'Qty'}</TableHead>
                          <TableHead>{isRTL ? 'المستخدم' : 'User'}</TableHead>
                          <TableHead className="text-center">{isRTL ? 'عرض' : 'View'}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTimeline.map((entry, index) => {
                          const config = movementConfig[entry.type];
                          const Icon = config.icon;
                          const isLast = index === filteredTimeline.length - 1;
                          
                          return (
                            <TableRow key={entry.id} className={isLast ? 'bg-primary/5' : ''}>
                              <TableCell className="font-mono text-sm">
                                {format(entry.date, 'yyyy-MM-dd HH:mm', { locale: isRTL ? ar : undefined })}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={`${config.color} flex items-center gap-1 w-fit`}>
                                  <Icon className="h-3 w-3" />
                                  {config.label[language]}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm">{entry.documentType}</TableCell>
                              <TableCell className="font-mono text-sm">{entry.documentNumber}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{entry.fromLocation || '-'}</TableCell>
                              <TableCell className="text-sm">{entry.toLocation || '-'}</TableCell>
                              <TableCell className="text-center">
                                <Badge variant={entry.quantity > 0 ? 'default' : 'destructive'} className="min-w-[40px]">
                                  {entry.quantity > 0 ? `+${entry.quantity}` : entry.quantity}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">{entry.performedBy || '-'}</TableCell>
                              <TableCell className="text-center">
                                {entry.documentId && (
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-8 w-8"
                                    onClick={() => setPreviewDocument({ type: entry.documentType, id: entry.documentId! })}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                )}
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
          </>
        )}
        
        {/* Document Preview Sheet */}
        <Sheet open={!!previewDocument} onOpenChange={() => setPreviewDocument(null)}>
          <SheetContent side={isRTL ? 'left' : 'right'} className="w-full sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>{isRTL ? 'معاينة المستند' : 'Document Preview'}</SheetTitle>
              <SheetDescription>
                {previewDocument?.type} - {previewDocument?.id?.slice(0, 8)}...
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 text-center text-muted-foreground py-12">
              <Eye className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>{isRTL ? 'معاينة المستند قيد التطوير' : 'Document preview coming soon'}</p>
              <Button 
                variant="link" 
                className="mt-4"
                onClick={() => {
                  // Navigate to document - to be implemented based on document type
                  toast.info(isRTL ? 'سيتم فتح المستند الكامل' : 'Will open full document');
                }}
              >
                {isRTL ? 'فتح المستند الكامل' : 'Open Full Document'}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </MainLayout>
  );
};

export default SerialTrackingPage;
