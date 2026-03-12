import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useReactToPrint } from 'react-to-print';
import { Loader2, Printer, ArrowRight, CreditCard, FileText, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import PrintableInvoice from '@/components/invoices/PrintableInvoice';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';

const statusLabels: Record<string, string> = {
  pending: 'معلقة',
  partial: 'مدفوعة جزئياً',
  paid: 'مدفوعة',
  cancelled: 'ملغاة',
  draft: 'مسودة',
};

const statusColors: Record<string, string> = {
  paid: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  partial: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  pending: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

export default function SalesInvoiceViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isPosPath = location.pathname.startsWith('/pos/');
  const printRef = useRef<HTMLDivElement>(null);

  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ['sales-invoice-view', id],
    queryFn: async () => {
      if (!id) throw new Error('معرف الفاتورة مطلوب');

      const endpoint = isPosPath ? `/api/pos/invoice/${id}` : `/api/invoice-with-customer/${id}`;
      const res = await fetch(endpoint, { credentials: 'include' });
      if (res.status === 501) throw new Error('الفاتورة غير موجودة');
      if (!res.ok) throw new Error('Failed to fetch invoice');
      const raw = await res.json();
      if (!raw) throw new Error('الفاتورة غير موجودة');

      return {
        ...raw,
        customer: raw.customer || null,
        branch: raw.branch_name ? { id: raw.branch_id, branch_name: raw.branch_name, branch_code: raw.branch_code } : null,
        journal_entry: raw.je_id ? { id: raw.je_id, entry_number: raw.entry_number } : null,
      };
    },
    enabled: !!id,
  });

  const { data: rawItems = [] } = useQuery({
    queryKey: ['sales-invoice-raw-items', id, invoice?.sale_id],
    queryFn: async () => {
      if (!id) return [];

      const params: Record<string, string> = {};
      if (invoice?.sale_id) {
        params.sale_id = invoice.sale_id;
      }
      params.invoice_id = id;

      const itemsEndpoint = isPosPath ? '/api/pos/invoice-items' : '/api/sales-invoice-items';
      const response = await fetch(`${itemsEndpoint}?${new URLSearchParams(params)}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch invoice items');
      const data = await response.json();

      const isSaleItemsFormat = data?.length > 0 && 'sale_price' in data[0];
      const isReturn = invoice?.invoice_type === 'sales_return';

      return (data || []).map((item: any) => {
        const price = isSaleItemsFormat ? (item.sale_price || 0) : (item.unit_price || 0);
        return {
          id: item.id,
          ...(isReturn ? { return_price: price } : { sale_price: price }),
          jewelry_items: item.jewelry_items || null,
        };
      });
    },
    enabled: !!id && !!invoice,
  });

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `فاتورة-${invoice?.invoice_number || ''}`,
  });

  useEffect(() => {
    if (error) {
      toast.error(error instanceof Error ? error.message : 'حدث خطأ في تحميل الفاتورة');
      navigate(-1);
    }
  }, [error, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" data-testid="loader-invoice" />
          <p className="text-muted-foreground">جاري تحميل بيانات الفاتورة...</p>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return null;
  }

  const paidAmount = invoice.paid_amount || 0;
  const grandTotal = invoice.total_amount || 0;
  const remainingAmount = invoice.remaining_amount || 0;
  const paymentStatus = paidAmount >= grandTotal ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

  const printInvoiceData = {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    invoice_type: invoice.invoice_type,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date,
    total_amount: invoice.total_amount,
    paid_amount: invoice.paid_amount,
    remaining_amount: invoice.remaining_amount,
    subtotal: invoice.subtotal,
    tax_amount: invoice.tax_amount,
    discount_amount: invoice.discount_amount,
    status: invoice.status,
    notes: invoice.notes,
    customer: invoice.customer,
    branch: invoice.branch,
  };

  return (
    <>
      <div className="rtl-mode content-full-width page-container space-y-4 pb-8">
        {/* Action Bar */}
        <Card className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => isPosPath ? navigate('/pos/invoices') : navigate(-1)}
                data-testid="button-back"
              >
                <ArrowRight className="w-4 h-4 ml-1" />
                رجوع
              </Button>
              <div className="h-6 w-px bg-border" />
              <span className="font-mono text-sm font-medium" data-testid="text-invoice-number">
                {invoice.invoice_number}
              </span>
              <Badge className={statusColors[invoice.status] || ''} data-testid="badge-status">
                {statusLabels[invoice.status] || invoice.status}
              </Badge>
              {invoice.sale_id && (
                <Badge variant="outline" data-testid="badge-pos-source">
                  POS
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CreditCard className="w-4 h-4" />
                <span>
                  {paymentStatus === 'paid' ? 'مدفوعة بالكامل' :
                   paymentStatus === 'partial' ? `متبقي: ${formatCurrency(remainingAmount)}` :
                   `المبلغ: ${formatCurrency(grandTotal)}`}
                </span>
              </div>
              {invoice.journal_entry_id && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/accounting/journal/${invoice.journal_entry_id}`)}
                  data-testid="button-journal-entry"
                >
                  <BookOpen className="w-4 h-4 ml-1" />
                  القيد
                </Button>
              )}
              <Button
                variant="default"
                size="sm"
                onClick={() => handlePrint()}
                data-testid="button-print"
              >
                <Printer className="w-4 h-4 ml-1" />
                طباعة
              </Button>
            </div>
          </div>
        </Card>

        {/* Invoice Preview - A4 Format */}
        <div className="flex justify-center">
          <div className="w-full max-w-[210mm] shadow-lg border rounded-md overflow-hidden">
            <PrintableInvoice
              invoice={printInvoiceData}
              items={rawItems}
            />
          </div>
        </div>
      </div>

      {/* Hidden Print Component */}
      <div style={{ display: 'none' }}>
        <PrintableInvoice
          ref={printRef}
          invoice={printInvoiceData}
          items={rawItems}
        />
      </div>
    </>
  );
}
