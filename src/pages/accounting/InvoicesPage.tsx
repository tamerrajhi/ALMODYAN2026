import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as apiClient from '@/lib/apiClient';
import { useLanguage } from '@/contexts/LanguageContext';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { FileText, Clock, CheckCircle, Banknote, Eye, Printer, Building2, User, Calendar, Receipt, Share2, MessageCircle, Mail } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { formatCurrency } from '@/lib/utils';
import { useReactToPrint } from 'react-to-print';
import PrintableInvoice from '@/components/invoices/PrintableInvoice';

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: string;
  invoice_date: string;
  due_date: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  sale_id: string | null;
  return_id: string | null;
  branch_id: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  subtotal: number | null;
  tax_amount: number | null;
  discount_amount: number | null;
  status: string;
  notes: string | null;
  created_at: string | null;
  customer?: { full_name: string; customer_code: string; phone?: string; email?: string };
  supplier?: { supplier_name: string };
  branch?: { branch_name: string };
}

export default function InvoicesPage() {
  const { t, language } = useLanguage();
  const dateLocale = language === 'ar' ? ar : enUS;
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const invoiceTypeLabels: Record<string, string> = {
    sales: t.invoices.sales,
    purchase: t.invoices.purchase,
    sales_return: t.invoices.salesReturn,
    purchase_return: t.invoices.purchaseReturn,
  };

  const statusLabels: Record<string, { label: string; color: string }> = {
    pending: { label: t.invoices.pending, color: 'bg-yellow-500/20 text-yellow-400' },
    partial: { label: t.invoices.partial, color: 'bg-blue-500/20 text-blue-400' },
    paid: { label: t.invoices.paid, color: 'bg-green-500/20 text-green-400' },
    cancelled: { label: t.invoices.cancelled, color: 'bg-red-500/20 text-red-400' },
  };

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: selectedInvoice ? `فاتورة-${selectedInvoice.invoice_number}` : 'فاتورة',
  });

  const generateInvoiceMessage = (invoice: Invoice) => {
    const customerName = invoice.customer?.full_name || 'عميل';
    const invoiceType = invoiceTypeLabels[invoice.invoice_type] || invoice.invoice_type;
    const date = format(new Date(invoice.invoice_date), 'yyyy/MM/dd');
    
    return `مرحباً ${customerName}،

نشكركم على تعاملكم معنا.

تفاصيل الفاتورة:
━━━━━━━━━━━━━━━
📄 رقم الفاتورة: ${invoice.invoice_number}
📋 النوع: ${invoiceType}
📅 التاريخ: ${date}
💰 الإجمالي: ${formatCurrency(invoice.total_amount)}
✅ المدفوع: ${formatCurrency(invoice.paid_amount)}
⏳ المتبقي: ${formatCurrency(invoice.remaining_amount)}
━━━━━━━━━━━━━━━

شكراً لثقتكم بنا! 🙏`;
  };

  const handleShareWhatsApp = (invoice: Invoice) => {
    const phone = invoice.customer?.phone?.replace(/[^0-9]/g, '') || '';
    const message = encodeURIComponent(generateInvoiceMessage(invoice));
    
    const whatsappUrl = phone 
      ? `https://wa.me/${phone}?text=${message}`
      : `https://wa.me/?text=${message}`;
    
    window.open(whatsappUrl, '_blank');
    toast.success('تم فتح WhatsApp لمشاركة الفاتورة');
  };

  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const handleShareEmail = async (invoice: Invoice) => {
    const customerEmail = invoice.customer?.email;
    
    if (!customerEmail) {
      toast.error('لا يوجد بريد إلكتروني للعميل');
      return;
    }

    setIsSendingEmail(true);
    
    try {
      const emailRes = await fetch('/api/email/send-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: customerEmail,
          customerName: invoice.customer?.full_name || 'عميل',
          invoiceNumber: invoice.invoice_number,
          invoiceType: invoiceTypeLabels[invoice.invoice_type] || invoice.invoice_type,
          invoiceDate: format(new Date(invoice.invoice_date), 'yyyy/MM/dd'),
          totalAmount: formatCurrency(invoice.total_amount),
          paidAmount: formatCurrency(invoice.paid_amount),
          remainingAmount: formatCurrency(invoice.remaining_amount),
        }),
      });
      const { data, error } = await emailRes.json();

      if (error) throw new Error(error.message);

      toast.success('تم إرسال الفاتورة بنجاح إلى البريد الإلكتروني');
    } catch (error: any) {
      console.error('Error sending email:', error);
      toast.error(`فشل إرسال البريد: ${error.message}`);
    } finally {
      setIsSendingEmail(false);
    }
  };

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: async () => {
      const { data, error } = await apiClient.get<Invoice[]>('/api/invoices-with-relations');
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: saleItems = [] } = useQuery({
    queryKey: ['invoice-sale-items', selectedInvoice?.sale_id],
    queryFn: async () => {
      if (!selectedInvoice?.sale_id) return [];
      const { data, error } = await apiClient.get<any[]>('/api/sale-items', { sale_id: selectedInvoice.sale_id });
      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!selectedInvoice?.sale_id,
  });

  const { data: returnItems = [] } = useQuery({
    queryKey: ['invoice-return-items', selectedInvoice?.return_id],
    queryFn: async () => {
      if (!selectedInvoice?.return_id) return [];
      const { data, error } = await apiClient.get<any[]>('/api/return-items', { return_id: selectedInvoice.return_id });
      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!selectedInvoice?.return_id,
  });

  const stats = {
    total: invoices.length,
    pending: invoices.filter(i => i.status === 'pending').length,
    partial: invoices.filter(i => i.status === 'partial').length,
    paid: invoices.filter(i => i.status === 'paid').length,
    totalAmount: invoices.reduce((sum, i) => sum + (i.total_amount || 0), 0),
    paidAmount: invoices.reduce((sum, i) => sum + (i.paid_amount || 0), 0),
    remainingAmount: invoices.reduce((sum, i) => sum + (i.remaining_amount || 0), 0),
  };

  const filteredInvoices = invoices.filter(invoice => {
    const matchesSearch = 
      invoice.invoice_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      invoice.customer?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      invoice.supplier?.supplier_name?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesType = typeFilter === 'all' || invoice.invoice_type === typeFilter;
    const matchesStatus = statusFilter === 'all' || invoice.status === statusFilter;

    return matchesSearch && matchesType && matchesStatus;
  });

  const currentInvoiceItems = selectedInvoice?.invoice_type === 'sales' || selectedInvoice?.invoice_type === 'sales_return' 
    ? (selectedInvoice?.sale_id ? saleItems : returnItems)
    : returnItems;

  return (
    <MainLayout>
      <div className="space-y-4 md:space-y-6">
        <div className="action-bar">
          <div>
            <h1 className="page-title">{t.invoices.title}</h1>
            <p className="page-description">{t.invoices.subtitle}</p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 px-3 md:px-6 pt-3 md:pt-6">
              <CardTitle className="text-xs md:text-sm font-medium">{t.invoices.totalInvoices}</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-3 md:px-6 pb-3 md:pb-6">
              <div className="stat-value">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 px-3 md:px-6 pt-3 md:pt-6">
              <CardTitle className="text-xs md:text-sm font-medium">{t.invoices.totalAmount}</CardTitle>
              <Banknote className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-3 md:px-6 pb-3 md:pb-6">
              <div className="stat-value-currency">{formatCurrency(stats.totalAmount)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 px-3 md:px-6 pt-3 md:pt-6">
              <CardTitle className="text-xs md:text-sm font-medium">{t.invoices.collectedAmount}</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent className="px-3 md:px-6 pb-3 md:pb-6">
              <div className="stat-value-currency text-green-500">{formatCurrency(stats.paidAmount)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 px-3 md:px-6 pt-3 md:pt-6">
              <CardTitle className="text-xs md:text-sm font-medium">{t.invoices.remainingBalance}</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent className="px-3 md:px-6 pb-3 md:pb-6">
              <div className="stat-value-currency text-yellow-500">{formatCurrency(stats.remainingAmount)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2 md:gap-4">
          <Input
            placeholder={t.invoices.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full sm:max-w-sm min-h-[44px] sm:min-h-0"
          />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-48 min-h-[44px] sm:min-h-0">
              <SelectValue placeholder={t.invoices.invoiceType} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.invoices.allTypes}</SelectItem>
              <SelectItem value="sales">{t.invoices.sales}</SelectItem>
              <SelectItem value="purchase">{t.invoices.purchase}</SelectItem>
              <SelectItem value="sales_return">{t.invoices.salesReturn}</SelectItem>
              <SelectItem value="purchase_return">{t.invoices.purchaseReturn}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-40 min-h-[44px] sm:min-h-0">
              <SelectValue placeholder={t.invoices.invoiceStatus} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.invoices.allStatuses}</SelectItem>
              <SelectItem value="pending">{t.invoices.pending}</SelectItem>
              <SelectItem value="partial">{t.invoices.partial}</SelectItem>
              <SelectItem value="paid">{t.invoices.paid}</SelectItem>
              <SelectItem value="cancelled">{t.invoices.cancelled}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Invoices Table */}
        <div className="border rounded-lg table-container">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs md:text-sm">{t.invoices.invoiceNumber}</TableHead>
                <TableHead className="text-xs md:text-sm hidden sm:table-cell">{t.invoices.type}</TableHead>
                <TableHead className="text-xs md:text-sm hidden md:table-cell">{t.invoices.date}</TableHead>
                <TableHead className="text-xs md:text-sm">{t.invoices.customerSupplier}</TableHead>
                <TableHead className="text-left text-xs md:text-sm">{t.invoices.amount}</TableHead>
                <TableHead className="text-left text-xs md:text-sm hidden lg:table-cell">{t.invoices.paidAmount}</TableHead>
                <TableHead className="text-left text-xs md:text-sm hidden lg:table-cell">{t.invoices.remainingAmount}</TableHead>
                <TableHead className="text-xs md:text-sm">{t.invoices.status}</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    {t.common.loading}
                  </TableCell>
                </TableRow>
              ) : filteredInvoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    {t.invoices.noInvoices}
                  </TableCell>
                </TableRow>
              ) : (
                filteredInvoices.map((invoice) => (
                  <TableRow 
                    key={invoice.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => {
                      setSelectedInvoice(invoice);
                      setViewDialogOpen(true);
                    }}
                  >
                    <TableCell className="font-mono text-xs md:text-sm">{invoice.invoice_number}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="text-xs">
                        {invoiceTypeLabels[invoice.invoice_type] || invoice.invoice_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs md:text-sm hidden md:table-cell">
                      {format(new Date(invoice.invoice_date), 'yyyy/MM/dd')}
                    </TableCell>
                    <TableCell className="text-xs md:text-sm truncate max-w-[100px] md:max-w-none">
                      {invoice.customer?.full_name || invoice.supplier?.supplier_name || '-'}
                    </TableCell>
                    <TableCell className="text-left font-mono text-xs md:text-sm">
                      {formatCurrency(invoice.total_amount)}
                    </TableCell>
                    <TableCell className="text-left font-mono text-xs md:text-sm text-green-500 hidden lg:table-cell">
                      {formatCurrency(invoice.paid_amount)}
                    </TableCell>
                    <TableCell className="text-left font-mono text-xs md:text-sm text-yellow-500 hidden lg:table-cell">
                      {formatCurrency(invoice.remaining_amount)}
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${statusLabels[invoice.status]?.color || ''}`}>
                        {statusLabels[invoice.status]?.label || invoice.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedInvoice(invoice);
                          setViewDialogOpen(true);
                        }}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Invoice View Dialog */}
        <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Receipt className="w-5 h-5" />
                {t.invoices.invoiceDetails}
              </DialogTitle>
            </DialogHeader>
            {selectedInvoice && (
              <div className="space-y-4 md:space-y-6">
                {/* Invoice Header */}
                <div className="bg-muted/50 p-3 md:p-4 rounded-lg">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                    <div>
                      <p className="text-xl md:text-2xl font-bold font-mono">{selectedInvoice.invoice_number}</p>
                      <Badge variant="outline" className="mt-1 text-xs">
                        {invoiceTypeLabels[selectedInvoice.invoice_type] || selectedInvoice.invoice_type}
                      </Badge>
                    </div>
                    <Badge className={`text-sm md:text-lg px-3 md:px-4 py-1 self-start sm:self-auto ${statusLabels[selectedInvoice.status]?.color || ''}`}>
                      {statusLabels[selectedInvoice.status]?.label || selectedInvoice.status}
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-muted-foreground text-xs">{t.invoices.invoiceDate}</p>
                        <p className="font-medium truncate">{format(new Date(selectedInvoice.invoice_date), 'dd MMMM yyyy', { locale: dateLocale })}</p>
                      </div>
                    </div>
                    {selectedInvoice.due_date && (
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-muted-foreground text-xs">{t.invoices.dueDate}</p>
                          <p className="font-medium truncate">{format(new Date(selectedInvoice.due_date), 'dd MMMM yyyy', { locale: dateLocale })}</p>
                        </div>
                      </div>
                    )}
                    {selectedInvoice.branch?.branch_name && (
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-muted-foreground text-xs">{t.invoices.branch}</p>
                          <p className="font-medium truncate">{selectedInvoice.branch.branch_name}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Customer/Supplier Info */}
                {(selectedInvoice.customer || selectedInvoice.supplier) && (
                  <div className="border rounded-lg p-3 md:p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <User className="w-4 h-4" />
                      <h3 className="font-semibold text-sm md:text-base">
                        {selectedInvoice.customer ? t.invoices.customerData : t.invoices.supplierData}
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">{t.invoices.name}</p>
                        <p className="font-medium">
                          {selectedInvoice.customer?.full_name || selectedInvoice.supplier?.supplier_name}
                        </p>
                      </div>
                      {selectedInvoice.customer?.customer_code && (
                        <div>
                          <p className="text-muted-foreground text-xs">{t.invoices.customerCode}</p>
                          <p className="font-mono">{selectedInvoice.customer.customer_code}</p>
                        </div>
                      )}
                      {selectedInvoice.customer?.phone && (
                        <div>
                          <p className="text-muted-foreground text-xs">{t.invoices.phone}</p>
                          <p className="font-mono">{selectedInvoice.customer.phone}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Invoice Items */}
                {(saleItems.length > 0 || returnItems.length > 0) && (
                  <div className="border rounded-lg">
                    <div className="p-3 md:p-4 border-b">
                      <h3 className="font-semibold flex items-center gap-2 text-sm md:text-base">
                        <FileText className="w-4 h-4" />
                        {t.invoices.invoiceItems}
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs md:text-sm">#</TableHead>
                            <TableHead className="text-xs md:text-sm">{t.invoices.itemCode}</TableHead>
                            <TableHead className="text-xs md:text-sm hidden sm:table-cell">{t.invoices.model}</TableHead>
                            <TableHead className="text-xs md:text-sm hidden md:table-cell">{t.invoices.itemType}</TableHead>
                            <TableHead className="text-left text-xs md:text-sm">{t.invoices.price}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(selectedInvoice.invoice_type === 'sales' ? saleItems : returnItems).map((item: any, index: number) => (
                            <TableRow key={item.id}>
                              <TableCell className="text-xs md:text-sm">{index + 1}</TableCell>
                              <TableCell className="font-mono text-xs md:text-sm">{item.unique_items?.serial_no}</TableCell>
                              <TableCell className="text-xs md:text-sm hidden sm:table-cell">{item.unique_items?.model || '-'}</TableCell>
                              <TableCell className="text-xs md:text-sm hidden md:table-cell">{item.unique_items?.type || '-'}</TableCell>
                              <TableCell className="text-left font-mono text-xs md:text-sm">
                                {formatCurrency(item.sale_price || item.return_price)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                <Separator />

                {/* Invoice Totals */}
                <div className="space-y-2 text-sm md:text-base">
                  {selectedInvoice.subtotal && selectedInvoice.subtotal !== selectedInvoice.total_amount && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.invoices.subtotal}</span>
                      <span className="font-mono">{formatCurrency(selectedInvoice.subtotal)}</span>
                    </div>
                  )}
                  {selectedInvoice.discount_amount && selectedInvoice.discount_amount > 0 && (
                    <div className="flex justify-between text-red-500">
                      <span>{t.invoices.discount}</span>
                      <span className="font-mono">- {formatCurrency(selectedInvoice.discount_amount)}</span>
                    </div>
                  )}
                  {selectedInvoice.tax_amount && selectedInvoice.tax_amount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.invoices.tax} (15%)</span>
                      <span className="font-mono">{formatCurrency(selectedInvoice.tax_amount)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between text-base md:text-lg font-bold">
                    <span>{t.invoices.total}</span>
                    <span className="font-mono text-primary">{formatCurrency(selectedInvoice.total_amount)}</span>
                  </div>
                  <div className="flex justify-between text-green-500">
                    <span>{t.invoices.paidAmount}</span>
                    <span className="font-mono">{formatCurrency(selectedInvoice.paid_amount)}</span>
                  </div>
                  <div className="flex justify-between text-yellow-500">
                    <span>{t.invoices.remainingAmount}</span>
                    <span className="font-mono">{formatCurrency(selectedInvoice.remaining_amount)}</span>
                  </div>
                </div>

                {/* Notes */}
                {selectedInvoice.notes && (
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <p className="text-xs md:text-sm text-muted-foreground">{t.common.notes}</p>
                    <p className="text-sm">{selectedInvoice.notes}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-col sm:flex-row justify-end gap-2">
                  <Button variant="outline" onClick={() => setViewDialogOpen(false)} className="min-h-[44px] sm:min-h-0">
                    {t.invoices.close}
                  </Button>
                  
                  {/* Share Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="min-h-[44px] sm:min-h-0">
                        <Share2 className="w-4 h-4 ml-2" />
                        {t.invoices.share}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleShareWhatsApp(selectedInvoice)} className="cursor-pointer">
                        <MessageCircle className="w-4 h-4 ml-2 text-green-500" />
                        WhatsApp
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleShareEmail(selectedInvoice)} 
                        className="cursor-pointer"
                        disabled={isSendingEmail}
                      >
                        <Mail className="w-4 h-4 ml-2 text-blue-500" />
                        {isSendingEmail ? t.invoices.sendingEmail : t.invoices.email}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  
                  <Button onClick={() => handlePrint()} className="min-h-[44px] sm:min-h-0">
                    <Printer className="w-4 h-4 ml-2" />
                    {t.invoices.print}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Hidden Printable Invoice */}
        {selectedInvoice && (
          <div className="hidden print:block">
            <PrintableInvoice 
              ref={printRef}
              invoice={selectedInvoice}
              items={currentInvoiceItems}
            />
          </div>
        )}
      </div>
    </MainLayout>
  );
}
