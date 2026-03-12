import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Eye, Printer, History, Package, FileText, User, Building2, Calendar, CreditCard, Loader2, Search } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { useReactToPrint } from 'react-to-print';
import POSReturnReceipt from '@/components/pos/POSReturnReceipt';
import * as dataGateway from '@/lib/dataGateway';

interface ReturnRecord {
  id: string;
  return_number: string;
  return_date: string;
  original_sale_id: string;
  sale_code?: string;
  customer_name?: string;
  branch_name?: string;
  notes?: string;
  total_amount: number;
  tax_amount: number;
  subtotal: number;
  created_by?: string;
  return_type?: string;
  items_count?: number;
}

interface ReturnItem {
  id: string;
  item_code: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  tax_amount: number;
  line_total: number;
  return_reason?: string;
}

interface AllReturnsSectionProps {
  branchId?: string;
}

export default function AllReturnsSection({ branchId }: AllReturnsSectionProps) {
  const [selectedReturn, setSelectedReturn] = useState<ReturnRecord | null>(null);
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const receiptRef = useRef<HTMLDivElement>(null);

  const { data: allReturns = [], isLoading } = useQuery({
    queryKey: ['all-pos-returns', branchId],
    queryFn: async () => {
      const filters: any[] = [];
      if (branchId) {
        filters.push({ type: 'eq', column: 'branch_id', value: branchId });
      }

      const { data: returnsData, error } = await dataGateway.queryTable<any[]>('returns', {
        select: 'id, return_number, return_date, original_sale_id, total_amount, tax_amount, subtotal, return_type, branch_id, customer_id, notes, created_by, status',
        filters,
        order: { column: 'return_date', ascending: false },
        limit: 50,
      });

      if (error) {
        console.error('Error fetching returns:', error);
        return [];
      }

      const returns = returnsData || [];
      if (returns.length === 0) return [];

      const saleIds = [...new Set(returns.map((r: any) => r.original_sale_id).filter(Boolean))];
      const branchIds = [...new Set(returns.map((r: any) => r.branch_id).filter(Boolean))];
      const customerIds = [...new Set(returns.map((r: any) => r.customer_id).filter(Boolean))];

      const [salesRes, invoicesRes, branchesRes, customersRes] = await Promise.all([
        saleIds.length > 0
          ? dataGateway.queryTable<any[]>('sales', {
              select: 'id, sale_code',
              filters: [{ type: 'in', column: 'id', value: saleIds }],
            })
          : { data: [], error: null },
        saleIds.length > 0
          ? dataGateway.queryTable<any[]>('invoices', {
              select: 'sale_id, invoice_number',
              filters: [{ type: 'in', column: 'sale_id', value: saleIds }, { type: 'eq', column: 'invoice_type', value: 'sales' }],
            })
          : { data: [], error: null },
        branchIds.length > 0
          ? dataGateway.queryTable<any[]>('branches', {
              select: 'id, name',
              filters: [{ type: 'in', column: 'id', value: branchIds }],
            })
          : { data: [], error: null },
        customerIds.length > 0
          ? dataGateway.queryTable<any[]>('customers', {
              select: 'id, full_name',
              filters: [{ type: 'in', column: 'id', value: customerIds }],
            })
          : { data: [], error: null },
      ]);

      const salesMap = new Map((salesRes.data || []).map((s: any) => [s.id, s.sale_code]));
      const invoiceMap = new Map((invoicesRes.data || []).map((i: any) => [i.sale_id, i.invoice_number]));
      const branchesMap = new Map((branchesRes.data || []).map((b: any) => [b.id, b.name]));
      const customersMap = new Map((customersRes.data || []).map((c: any) => [c.id, c.full_name]));

      const returnsWithCounts = await Promise.all(
        returns.map(async (ret: any) => {
          const { count } = await dataGateway.queryTable('return_items', {
            select: '*',
            count: 'exact',
            head: true,
            filters: [{ type: 'eq', column: 'return_id', value: ret.id }],
          });

          return {
            id: ret.id,
            return_number: ret.return_number,
            return_date: ret.return_date,
            original_sale_id: ret.original_sale_id,
            sale_code: invoiceMap.get(ret.original_sale_id) || salesMap.get(ret.original_sale_id),
            customer_name: customersMap.get(ret.customer_id),
            branch_name: branchesMap.get(ret.branch_id),
            notes: ret.notes,
            total_amount: ret.total_amount,
            tax_amount: ret.tax_amount,
            subtotal: ret.subtotal,
            created_by: ret.created_by,
            return_type: ret.return_type,
            items_count: count || 0,
          };
        })
      );

      return returnsWithCounts;
    },
  });

  const filteredReturns = allReturns.filter((ret) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      ret.return_number?.toLowerCase().includes(search) ||
      ret.sale_code?.toLowerCase().includes(search) ||
      ret.customer_name?.toLowerCase().includes(search) ||
      ret.branch_name?.toLowerCase().includes(search) ||
      ret.created_by?.toLowerCase().includes(search)
    );
  });

  const handlePreview = async (returnData: ReturnRecord) => {
    setSelectedReturn(returnData);
    setIsLoadingItems(true);
    setShowPreviewDialog(true);

    try {
      const { data: items } = await dataGateway.queryTable<any[]>('return_items', {
        select: '*',
        filters: [{ type: 'eq', column: 'return_id', value: returnData.id }],
      });

      setReturnItems(
        (items || []).map((item: any) => ({
          id: item.id,
          item_code: item.item_code || '',
          item_name: item.item_name || '',
          quantity: item.quantity || 1,
          unit_price: item.unit_price || item.return_price || 0,
          tax_amount: item.tax_amount || 0,
          line_total: item.line_total || 0,
          return_reason: item.return_reason,
        }))
      );
    } catch (error) {
      console.error('Error fetching return items:', error);
    } finally {
      setIsLoadingItems(false);
    }
  };

  const handlePrint = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: `Return-${selectedReturn?.return_number || ''}`,
  });

  const handleDirectPrint = async (returnData: ReturnRecord) => {
    setSelectedReturn(returnData);
    setIsLoadingItems(true);

    try {
      const { data: items } = await dataGateway.queryTable<any[]>('return_items', {
        select: '*',
        filters: [{ type: 'eq', column: 'return_id', value: returnData.id }],
      });

      setReturnItems(
        (items || []).map((item: any) => ({
          id: item.id,
          item_code: item.item_code || '',
          item_name: item.item_name || '',
          quantity: item.quantity || 1,
          unit_price: item.unit_price || item.return_price || 0,
          tax_amount: item.tax_amount || 0,
          line_total: item.line_total || 0,
          return_reason: item.return_reason,
        }))
      );

      setTimeout(() => {
        handlePrint();
        setIsLoadingItems(false);
      }, 300);
    } catch (error) {
      console.error('Error fetching return items:', error);
      setIsLoadingItems(false);
    }
  };

  const getRefundMethodText = (method: string) => {
    const methods: Record<string, string> = {
      cash: 'نقداً',
      card: 'شبكة',
      store_credit: 'رصيد عميل',
      mixed: 'مختلط',
    };
    return methods[method] || method;
  };

  const getRefundMethodVariant = (method: string): 'default' | 'secondary' | 'outline' | 'destructive' => {
    const variants: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
      cash: 'default',
      card: 'secondary',
      store_credit: 'outline',
    };
    return variants[method] || 'outline';
  };

  const getCompletedReturnData = () => {
    if (!selectedReturn) return null;

    return {
      returnCode: selectedReturn.return_number,
      returnDate: new Date(selectedReturn.return_date),
      branchName: selectedReturn.branch_name || '',
      originalInvoice: selectedReturn.sale_code || '',
      customerName: selectedReturn.customer_name,
      items: returnItems.map(item => ({
        item_code: item.item_code,
        item_name: item.item_name,
        return_quantity: item.quantity,
        unit_price: item.unit_price,
        tax_amount: item.tax_amount,
        line_total: item.line_total,
        return_reason: item.return_reason,
      })),
      subtotalBeforeTax: selectedReturn.subtotal || 0,
      taxAmount: selectedReturn.tax_amount || 0,
      totalAmount: selectedReturn.total_amount || 0,
      refundMethod: 'cash',
      returnReason: selectedReturn.notes || '',
      processedBy: selectedReturn.created_by || '',
      returnType: (selectedReturn.return_type as 'partial' | 'full') || 'partial',
    };
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <History className="w-5 h-5" />
            <Skeleton className="h-6 w-40" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              تفاصيل المرتجعات
              {allReturns.length > 0 && (
                <Badge variant="secondary" className="mr-2">
                  {allReturns.length}
                </Badge>
              )}
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pr-9 h-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredReturns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>لا توجد مرتجعات سابقة</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-right whitespace-nowrap">رقم المرتجع</TableHead>
                      <TableHead className="text-right whitespace-nowrap">التاريخ</TableHead>
                      <TableHead className="text-right whitespace-nowrap">فاتورة البيع</TableHead>
                      <TableHead className="text-right whitespace-nowrap">العميل</TableHead>
                      <TableHead className="text-right whitespace-nowrap">الفرع</TableHead>
                      <TableHead className="text-right whitespace-nowrap">ملاحظات</TableHead>
                      <TableHead className="text-right whitespace-nowrap">عدد القطع</TableHead>
                      <TableHead className="text-right whitespace-nowrap">المبلغ</TableHead>
                      <TableHead className="text-right whitespace-nowrap">الموظف</TableHead>
                      <TableHead className="text-center whitespace-nowrap">الإجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReturns.map((ret) => (
                      <TableRow key={ret.id} className="hover:bg-muted/30">
                        <TableCell className="font-mono font-bold text-destructive whitespace-nowrap">
                          {ret.return_number}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-muted-foreground" />
                            {new Date(ret.return_date).toLocaleDateString('ar-SA')}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <FileText className="w-3 h-3 text-muted-foreground" />
                            {ret.sale_code || '-'}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3 text-muted-foreground" />
                            {ret.customer_name || 'نقدي'}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Building2 className="w-3 h-3 text-muted-foreground" />
                            {ret.branch_name || '-'}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm max-w-[120px] truncate" title={ret.notes || ''}>
                          {ret.notes || '-'}
                        </TableCell>
                        <TableCell className="text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <Package className="w-3 h-3 text-muted-foreground" />
                            <span className="font-medium">{ret.items_count || 0}</span>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="font-bold text-destructive">
                            {formatCurrency(ret.total_amount)}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {ret.created_by || '-'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handlePreview(ret)}
                              title="معاينة المرتجع"
                            >
                              <Eye className="w-4 h-4 text-primary" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleDirectPrint(ret)}
                              disabled={isLoadingItems && selectedReturn?.id === ret.id}
                              title="طباعة المرتجع"
                            >
                              {isLoadingItems && selectedReturn?.id === ret.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Printer className="w-4 h-4 text-muted-foreground" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-primary" />
              معاينة المرتجع - {selectedReturn?.return_number}
            </DialogTitle>
          </DialogHeader>
          
          {isLoadingItems ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div ref={receiptRef}>
                {getCompletedReturnData() && (
                  <POSReturnReceipt return={getCompletedReturnData()!} />
                )}
              </div>
              
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setShowPreviewDialog(false)}>
                  إغلاق
                </Button>
                <Button onClick={() => handlePrint()}>
                  <Printer className="w-4 h-4 ml-2" />
                  طباعة
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Hidden receipt for direct print */}
      <div className="hidden">
        <div ref={receiptRef}>
          {getCompletedReturnData() && (
            <POSReturnReceipt return={getCompletedReturnData()!} />
          )}
        </div>
      </div>
    </>
  );
}
