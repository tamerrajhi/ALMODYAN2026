/**
 * Phase 3-B: HB Legacy Cases Cleanup Dialog
 */

import { useState, useCallback, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import * as dataGateway from '@/lib/dataGateway';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { RefreshCw, Check, AlertTriangle, FileText, Clock, DollarSign } from 'lucide-react';
import type { HBLegacyRecord, HBLegacyClassification } from './types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCleanupComplete?: () => void;
}

interface Invoice {
  id: string;
  invoice_number: string;
  total_amount: number;
  remaining_amount: number;
}

export function HBLegacyCleanupDialog({ open, onOpenChange, onCleanupComplete }: Props) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const isAr = language === 'ar';
  
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<HBLegacyRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<HBLegacyRecord | null>(null);
  const [classification, setClassification] = useState<HBLegacyClassification>('pending');
  const [notes, setNotes] = useState('');
  const [supplierInvoices, setSupplierInvoices] = useState<Invoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [backfillAmount, setBackfillAmount] = useState<number>(0);
  const [processing, setProcessing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: result, error } = await dataGateway.rpc('get_hb_legacy_list', {
        p_from_date: null,
        p_to_date: null,
        p_branch_id: null,
        p_supplier_id: null,
      });
      
      if (error) throw error;
      setData((result || []) as HBLegacyRecord[]);
    } catch (err: any) {
      console.error('HB Legacy fetch error:', err);
      toast.error(isAr ? 'فشل في تحميل البيانات' : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [isAr]);

  const fetchSupplierInvoices = useCallback(async (supplierId: string) => {
    try {
      const res = await fetch(`/api/invoices-unpaid/${supplierId}`, { credentials: 'include' });
      if (res.status === 501) { setSupplierInvoices([]); return; }
      if (!res.ok) throw new Error('Failed to fetch invoices');
      setSupplierInvoices((await res.json()) || []);
    } catch (err) {
      console.error('Failed to fetch invoices:', err);
      setSupplierInvoices([]);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open, fetchData]);

  useEffect(() => {
    if (selectedRecord) {
      fetchSupplierInvoices(selectedRecord.supplier_id);
      setClassification(selectedRecord.hb_legacy_classification || 'pending');
      setNotes(selectedRecord.hb_legacy_notes || '');
      setBackfillAmount(selectedRecord.amount || 0);
      setSelectedInvoice(null);
    }
  }, [selectedRecord, fetchSupplierInvoices]);

  // Generate idempotency key for each RPC call
  const generateClientRequestId = () => crypto.randomUUID();

  const handleClassify = async () => {
    if (!selectedRecord) return;
    
    setProcessing(true);
    try {
      const clientRequestId = generateClientRequestId();
      
      if (classification === 'backfilled') {
        if (!selectedInvoice || backfillAmount <= 0) {
          toast.error(isAr ? 'يرجى اختيار فاتورة ومبلغ' : 'Please select invoice and amount');
          setProcessing(false);
          return;
        }

        const { data: result, error } = await dataGateway.rpc('backfill_payment_allocation', {
          p_client_request_id: clientRequestId,
          p_payment_id: selectedRecord.payment_id,
          p_invoice_id: selectedInvoice,
          p_amount: backfillAmount,
          p_notes: notes,
          p_created_by: user?.id || null,
        });

        if (error) throw error;
        const res = result as any;
        if (!res?.success) throw new Error(res?.error || 'Unknown error');

        toast.success(isAr ? 'تم توزيع الدفعة بنجاح' : 'Payment allocated successfully');
      } else {
        const { data: result, error } = await dataGateway.rpc('classify_hb_legacy_payment', {
          p_client_request_id: clientRequestId,
          p_payment_id: selectedRecord.payment_id,
          p_classification: classification,
          p_notes: notes,
          p_approved_by: classification === 'approved_exception' ? user?.id : null,
        });

        if (error) throw error;
        const res = result as any;
        if (!res?.success) throw new Error(res?.error || 'Unknown error');

        toast.success(isAr ? 'تم تصنيف الدفعة بنجاح' : 'Payment classified successfully');
      }

      setSelectedRecord(null);
      fetchData();
      onCleanupComplete?.();
    } catch (err: any) {
      console.error('Classification error:', err);
      toast.error(err.message || (isAr ? 'فشل في التصنيف' : 'Classification failed'));
    } finally {
      setProcessing(false);
    }
  };

  const pendingCount = data.filter(r => !r.hb_legacy_classification || r.hb_legacy_classification === 'pending').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] w-[1200px] h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {isAr ? 'تنظيف السجلات القديمة' : 'HB Legacy Cases Cleanup'}
            <Badge variant="secondary">{data.length} {isAr ? 'حالة' : 'cases'}</Badge>
            {pendingCount > 0 && (
              <Badge variant="destructive">{pendingCount} {isAr ? 'معلقة' : 'pending'}</Badge>
            )}
            <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </DialogTitle>
          <DialogDescription>
            {isAr 
              ? 'دفعات موردين قبل 2026-01-19 بدون توزيعات - يمكن تصنيفها كتوزيع بأثر رجعي، دفعة مقدمة، أو استثناء معتمد'
              : 'Supplier payments before 2026-01-19 without allocations - classify as backfill, advance, or exception'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex gap-4 min-h-0">
          {/* List Panel */}
          <div className="flex-1 min-w-0">
            <ScrollArea className="h-full border rounded-lg">
              {loading ? (
                <div className="p-4 space-y-2">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : data.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
                  <Check className="h-12 w-12 text-primary" />
                  {isAr ? 'لا توجد حالات معلقة' : 'No pending cases'}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{isAr ? 'رقم الدفعة' : 'Payment #'}</TableHead>
                      <TableHead>{isAr ? 'التاريخ' : 'Date'}</TableHead>
                      <TableHead>{isAr ? 'المبلغ' : 'Amount'}</TableHead>
                      <TableHead>{isAr ? 'المورد' : 'Supplier'}</TableHead>
                      <TableHead>{isAr ? 'التصنيف' : 'Status'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((record) => (
                      <TableRow 
                        key={record.payment_id}
                        className={`cursor-pointer ${selectedRecord?.payment_id === record.payment_id ? 'bg-muted' : ''}`}
                        onClick={() => setSelectedRecord(record)}
                      >
                        <TableCell className="font-mono">{record.payment_number}</TableCell>
                        <TableCell>{record.payment_date}</TableCell>
                        <TableCell className="font-mono">{record.amount?.toLocaleString()}</TableCell>
                        <TableCell>{record.supplier_name}</TableCell>
                        <TableCell>
                          <Badge variant={
                            !record.hb_legacy_classification || record.hb_legacy_classification === 'pending' 
                              ? 'secondary' 
                              : 'outline'
                          }>
                            {record.hb_legacy_classification || 'pending'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>
          </div>

          {/* Detail/Action Panel */}
          <div className="w-[400px] flex-shrink-0">
            {selectedRecord ? (
              <Card className="h-full flex flex-col">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    {selectedRecord.payment_number}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-4">
                  {/* Payment Info */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <Label className="text-xs text-muted-foreground">{isAr ? 'المبلغ' : 'Amount'}</Label>
                      <p className="font-mono">{selectedRecord.amount?.toLocaleString()}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">{isAr ? 'التاريخ' : 'Date'}</Label>
                      <p>{selectedRecord.payment_date}</p>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs text-muted-foreground">{isAr ? 'المورد' : 'Supplier'}</Label>
                      <p>{selectedRecord.supplier_name}</p>
                    </div>
                  </div>

                  {/* Classification */}
                  <div>
                    <Label>{isAr ? 'التصنيف' : 'Classification'}</Label>
                    <Select value={classification} onValueChange={(v) => setClassification(v as HBLegacyClassification)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">{isAr ? 'معلق' : 'Pending'}</SelectItem>
                        <SelectItem value="backfilled">{isAr ? 'توزيع بأثر رجعي' : 'Backfill Allocation'}</SelectItem>
                        <SelectItem value="advance_payment">{isAr ? 'دفعة مقدمة' : 'Advance Payment'}</SelectItem>
                        <SelectItem value="approved_exception">{isAr ? 'استثناء معتمد' : 'Approved Exception'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Backfill Invoice Selection */}
                  {classification === 'backfilled' && (
                    <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
                      <Label>{isAr ? 'اختر الفاتورة' : 'Select Invoice'}</Label>
                      <Select value={selectedInvoice || ''} onValueChange={setSelectedInvoice}>
                        <SelectTrigger>
                          <SelectValue placeholder={isAr ? 'اختر فاتورة' : 'Select invoice'} />
                        </SelectTrigger>
                        <SelectContent>
                          {supplierInvoices.map((inv) => (
                            <SelectItem key={inv.id} value={inv.id}>
                              {inv.invoice_number} - {inv.remaining_amount?.toLocaleString()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      
                      <div>
                        <Label>{isAr ? 'المبلغ' : 'Amount'}</Label>
                        <input
                          type="number"
                          className="w-full px-3 py-2 border rounded-md"
                          value={backfillAmount}
                          onChange={(e) => setBackfillAmount(Number(e.target.value))}
                          max={selectedRecord.amount}
                        />
                      </div>
                    </div>
                  )}

                  {/* Warning for Exception */}
                  {classification === 'approved_exception' && (
                    <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg flex gap-2">
                      <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
                      <p className="text-sm">
                        {isAr 
                          ? 'الاستثناء المعتمد يتطلب موافقة إدارية. سيتم تسجيل اسمك كمعتمد.'
                          : 'Approved exception requires management authorization. Your name will be recorded as approver.'}
                      </p>
                    </div>
                  )}

                  {/* Notes */}
                  <div>
                    <Label>{isAr ? 'ملاحظات' : 'Notes'}</Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={isAr ? 'أضف ملاحظات...' : 'Add notes...'}
                      rows={3}
                    />
                  </div>

                  {/* Actions */}
                  <div className="mt-auto">
                    <Button 
                      className="w-full" 
                      onClick={handleClassify}
                      disabled={processing || (classification === 'backfilled' && (!selectedInvoice || backfillAmount <= 0))}
                    >
                      {processing ? (
                        <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Check className="h-4 w-4 mr-2" />
                      )}
                      {isAr ? 'حفظ التصنيف' : 'Save Classification'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="h-full flex items-center justify-center">
                <div className="text-center text-muted-foreground p-4">
                  <FileText className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>{isAr ? 'اختر دفعة للمعالجة' : 'Select a payment to process'}</p>
                </div>
              </Card>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
