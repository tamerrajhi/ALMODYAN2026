/**
 * Phase 3-B: Main Drill-Down Dialog Component
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import * as dataGateway from '@/lib/dataGateway';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { DrillDownFiltersPanel } from './DrillDownFilters';
import { RunbookPanel } from './RunbookPanel';
import type { DrillDownType, DrillDownFilters, RUNBOOKS } from './types';
import { RUNBOOKS as runbooks } from './types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: DrillDownType;
}

const RPC_MAP: Record<DrillDownType, string> = {
  hb_legacy: 'get_hb_legacy_list',
  hb_new_violations: 'get_hb_new_violations_list',
  allow_unallocated: 'get_allow_unallocated_list',
  formula_mismatch: 'get_formula_mismatch_list',
  negative_remaining: 'get_negative_remaining_list',
  overpaid: 'get_overpaid_list',
  stuck_workflows: 'get_stuck_workflows_list',
  unbalanced_je: 'get_unbalanced_je_list',
};

export function DrillDownDialog({ open, onOpenChange, type }: Props) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const isAr = language === 'ar';
  
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any[]>([]);
  const [filters, setFilters] = useState<DrillDownFilters>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const rpcName = RPC_MAP[type] as any;
      let params: any = {};
      
      if (type === 'stuck_workflows') {
        params = {
          p_workflow_type: filters.workflowType || null,
          p_from_date: filters.fromDate || null,
          p_to_date: filters.toDate || null,
        };
      } else if (type === 'unbalanced_je') {
        params = {
          p_from_date: filters.fromDate || null,
          p_to_date: filters.toDate || null,
          p_reference_type: filters.referenceType || null,
        };
      } else {
        params = {
          p_from_date: filters.fromDate || null,
          p_to_date: filters.toDate || null,
          p_branch_id: filters.branchId || null,
          p_supplier_id: filters.supplierId || null,
        };
      }

      const { data: result, error } = await dataGateway.rpc(rpcName, params);
      
      if (error) throw error;
      setData((result as any[]) || []);
    } catch (err: any) {
      console.error('Drill-down fetch error:', err);
      toast.error(isAr ? 'فشل في تحميل البيانات' : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [type, filters, isAr]);

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open, fetchData]);

  const handleClearFilters = () => {
    setFilters({});
  };

  const handleNavigate = (record: any) => {
    if (type === 'hb_legacy' || type === 'hb_new_violations' || type === 'allow_unallocated') {
      navigate('/purchasing/payment-vouchers');
    } else if (['formula_mismatch', 'negative_remaining', 'overpaid'].includes(type)) {
      navigate(`/purchasing/invoices/${record.invoice_id}/view`);
    } else if (type === 'stuck_workflows') {
      // No specific page for workflows, show toast
      toast.info(isAr ? 'راجع السجلات التقنية' : 'Check technical logs');
    } else if (type === 'unbalanced_je') {
      navigate('/accounting/journal-entries');
    }
    onOpenChange(false);
  };

  const runbook = runbooks[type];
  const dialogTitle = runbook ? (isAr ? runbook.whatAr : runbook.what) : type;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px] h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {dialogTitle}
            <Badge variant={data.length > 0 ? 'destructive' : 'secondary'}>{data.length}</Badge>
            <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex gap-4 min-h-0">
          {/* Main Content */}
          <div className="flex-1 flex flex-col min-w-0">
            <DrillDownFiltersPanel
              type={type}
              filters={filters}
              onChange={setFilters}
              onSearch={fetchData}
              onClear={handleClearFilters}
            />

            <ScrollArea className="flex-1 border rounded-lg">
              {loading ? (
                <div className="p-4 space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : data.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {isAr ? 'لا توجد نتائج' : 'No results found'}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {type === 'hb_legacy' && (
                        <>
                          <TableHead>{isAr ? 'رقم الدفعة' : 'Payment #'}</TableHead>
                          <TableHead>{isAr ? 'التاريخ' : 'Date'}</TableHead>
                          <TableHead>{isAr ? 'المبلغ' : 'Amount'}</TableHead>
                          <TableHead>{isAr ? 'المورد' : 'Supplier'}</TableHead>
                          <TableHead>{isAr ? 'الفرع' : 'Branch'}</TableHead>
                          <TableHead>{isAr ? 'التصنيف' : 'Classification'}</TableHead>
                          <TableHead>{isAr ? 'الإجراء' : 'Action'}</TableHead>
                        </>
                      )}
                      {(type === 'hb_new_violations' || type === 'allow_unallocated') && (
                        <>
                          <TableHead>{isAr ? 'رقم الدفعة' : 'Payment #'}</TableHead>
                          <TableHead>{isAr ? 'التاريخ' : 'Date'}</TableHead>
                          <TableHead>{isAr ? 'المبلغ' : 'Amount'}</TableHead>
                          <TableHead>{isAr ? 'المورد' : 'Supplier'}</TableHead>
                          <TableHead>{isAr ? 'الفرع' : 'Branch'}</TableHead>
                          <TableHead>{isAr ? 'الإجراء' : 'Action'}</TableHead>
                        </>
                      )}
                      {(type === 'formula_mismatch' || type === 'negative_remaining' || type === 'overpaid') && (
                        <>
                          <TableHead>{isAr ? 'رقم الفاتورة' : 'Invoice #'}</TableHead>
                          <TableHead>{isAr ? 'التاريخ' : 'Date'}</TableHead>
                          <TableHead>{isAr ? 'الإجمالي' : 'Total'}</TableHead>
                          <TableHead>{isAr ? 'المدفوع' : 'Paid'}</TableHead>
                          <TableHead>{isAr ? 'المتبقي' : 'Remaining'}</TableHead>
                          <TableHead>{isAr ? 'المورد' : 'Supplier'}</TableHead>
                          <TableHead>{isAr ? 'الإجراء' : 'Action'}</TableHead>
                        </>
                      )}
                      {type === 'stuck_workflows' && (
                        <>
                          <TableHead>{isAr ? 'النوع' : 'Type'}</TableHead>
                          <TableHead>{isAr ? 'تاريخ الإنشاء' : 'Created At'}</TableHead>
                          <TableHead>{isAr ? 'دقائق معلقة' : 'Minutes Stuck'}</TableHead>
                          <TableHead>{isAr ? 'كود الخطأ' : 'Error Code'}</TableHead>
                          <TableHead>{isAr ? 'رسالة الخطأ' : 'Error Message'}</TableHead>
                        </>
                      )}
                      {type === 'unbalanced_je' && (
                        <>
                          <TableHead>{isAr ? 'رقم القيد' : 'Entry #'}</TableHead>
                          <TableHead>{isAr ? 'التاريخ' : 'Date'}</TableHead>
                          <TableHead>{isAr ? 'المدين' : 'Debit'}</TableHead>
                          <TableHead>{isAr ? 'الدائن' : 'Credit'}</TableHead>
                          <TableHead>{isAr ? 'الفرق' : 'Imbalance'}</TableHead>
                          <TableHead>{isAr ? 'نوع المرجع' : 'Ref Type'}</TableHead>
                          <TableHead>{isAr ? 'الإجراء' : 'Action'}</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((record, idx) => (
                      <TableRow key={idx}>
                        {type === 'hb_legacy' && (
                          <>
                            <TableCell className="font-mono">{record.payment_number}</TableCell>
                            <TableCell>{record.payment_date}</TableCell>
                            <TableCell className="font-mono">{record.amount?.toLocaleString()}</TableCell>
                            <TableCell>{record.supplier_name}</TableCell>
                            <TableCell>{record.branch_name}</TableCell>
                            <TableCell>
                              <Badge variant={record.hb_legacy_classification === 'pending' ? 'secondary' : 'outline'}>
                                {record.hb_legacy_classification || 'pending'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm" onClick={() => handleNavigate(record)}>
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </>
                        )}
                        {(type === 'hb_new_violations' || type === 'allow_unallocated') && (
                          <>
                            <TableCell className="font-mono">{record.payment_number}</TableCell>
                            <TableCell>{record.payment_date}</TableCell>
                            <TableCell className="font-mono">{record.amount?.toLocaleString()}</TableCell>
                            <TableCell>{record.supplier_name}</TableCell>
                            <TableCell>{record.branch_name}</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm" onClick={() => handleNavigate(record)}>
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </>
                        )}
                        {(type === 'formula_mismatch' || type === 'negative_remaining' || type === 'overpaid') && (
                          <>
                            <TableCell className="font-mono">{record.invoice_number}</TableCell>
                            <TableCell>{record.invoice_date}</TableCell>
                            <TableCell className="font-mono">{record.total_amount?.toLocaleString()}</TableCell>
                            <TableCell className="font-mono">{record.paid_amount?.toLocaleString()}</TableCell>
                            <TableCell className="font-mono text-destructive">
                              {record.remaining_amount?.toLocaleString()}
                            </TableCell>
                            <TableCell>{record.supplier_name}</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm" onClick={() => handleNavigate(record)}>
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </>
                        )}
                        {type === 'stuck_workflows' && (
                          <>
                            <TableCell className="font-mono">{record.workflow_type}</TableCell>
                            <TableCell>{new Date(record.created_at).toLocaleString()}</TableCell>
                            <TableCell className="font-mono text-warning">{Math.round(record.minutes_stuck)}</TableCell>
                            <TableCell>{record.error_code || '-'}</TableCell>
                            <TableCell className="max-w-[200px] truncate" title={record.error_message}>
                              {record.error_message || '-'}
                            </TableCell>
                          </>
                        )}
                        {type === 'unbalanced_je' && (
                          <>
                            <TableCell className="font-mono">{record.entry_number}</TableCell>
                            <TableCell>{record.entry_date}</TableCell>
                            <TableCell className="font-mono">{record.total_debit?.toLocaleString()}</TableCell>
                            <TableCell className="font-mono">{record.total_credit?.toLocaleString()}</TableCell>
                            <TableCell className="font-mono text-destructive">
                              {record.imbalance_amount?.toLocaleString()}
                            </TableCell>
                            <TableCell>{record.reference_type}</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm" onClick={() => handleNavigate(record)}>
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>

            <div className="pt-2 text-sm text-muted-foreground">
              {isAr ? `عدد النتائج: ${data.length}` : `Results: ${data.length}`}
            </div>
          </div>

          {/* Runbook Panel */}
          <div className="w-[320px] flex-shrink-0">
            <RunbookPanel type={type} runbook={runbook} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
