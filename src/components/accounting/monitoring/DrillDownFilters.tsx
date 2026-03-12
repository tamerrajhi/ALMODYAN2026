/**
 * Phase 3-B: Drill-Down Filters Component
 */

import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Search, X } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { DrillDownFilters as Filters, DrillDownType } from './types';

interface Branch {
  id: string;
  branch_name: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface Props {
  type: DrillDownType;
  filters: Filters;
  onChange: (filters: Filters) => void;
  onSearch: () => void;
  onClear: () => void;
}

export function DrillDownFiltersPanel({ type, filters, onChange, onSearch, onClear }: Props) {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [branches, setBranches] = useState<Branch[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/active-branches', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setBranches((data || []) as Branch[]);
        }
      } catch (e) {
        console.error('Failed to load branches', e);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/suppliers', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setSuppliers((data || []).map((s: any) => ({
            id: s.id,
            name: s.supplier_name
          })));
        }
      } catch (e) {
        console.error('Failed to load suppliers', e);
      }
    })();
  }, []);

  const showBranch = !['stuck_workflows', 'unbalanced_je'].includes(type);
  const showSupplier = ['hb_legacy', 'hb_new_violations', 'allow_unallocated', 'formula_mismatch', 'negative_remaining', 'overpaid'].includes(type);
  const showWorkflowType = type === 'stuck_workflows';
  const showReferenceType = type === 'unbalanced_je';

  return (
    <div className="flex flex-wrap gap-4 p-4 bg-muted/50 rounded-lg mb-4">
      <div className="flex gap-2 items-end">
        <div>
          <Label className="text-xs">{isAr ? 'من تاريخ' : 'From Date'}</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-[140px] justify-start text-left font-normal", !filters.fromDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {filters.fromDate ? format(new Date(filters.fromDate), 'yyyy-MM-dd') : '-'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={filters.fromDate ? new Date(filters.fromDate) : undefined} onSelect={(date) => onChange({ ...filters, fromDate: date?.toISOString().split('T')[0] })} initialFocus />
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <Label className="text-xs">{isAr ? 'إلى تاريخ' : 'To Date'}</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-[140px] justify-start text-left font-normal", !filters.toDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {filters.toDate ? format(new Date(filters.toDate), 'yyyy-MM-dd') : '-'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={filters.toDate ? new Date(filters.toDate) : undefined} onSelect={(date) => onChange({ ...filters, toDate: date?.toISOString().split('T')[0] })} initialFocus />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {showBranch && (
        <div>
          <Label className="text-xs">{isAr ? 'الفرع' : 'Branch'}</Label>
          <select className="flex h-10 w-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm" value={filters.branchId || ''} onChange={(e) => onChange({ ...filters, branchId: e.target.value || undefined })}>
            <option value="">{isAr ? 'جميع الفروع' : 'All Branches'}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
          </select>
        </div>
      )}

      {showSupplier && (
        <div>
          <Label className="text-xs">{isAr ? 'المورد' : 'Supplier'}</Label>
          <select className="flex h-10 w-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm" value={filters.supplierId || ''} onChange={(e) => onChange({ ...filters, supplierId: e.target.value || undefined })}>
            <option value="">{isAr ? 'جميع الموردين' : 'All Suppliers'}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {showWorkflowType && (
        <div>
          <Label className="text-xs">{isAr ? 'نوع العملية' : 'Workflow Type'}</Label>
          <select className="flex h-10 w-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm" value={filters.workflowType || ''} onChange={(e) => onChange({ ...filters, workflowType: e.target.value || undefined })}>
            <option value="">{isAr ? 'الكل' : 'All'}</option>
            <option value="purchase_invoice_create">Invoice Create</option>
            <option value="payment_voucher">Payment Voucher</option>
          </select>
        </div>
      )}

      {showReferenceType && (
        <div>
          <Label className="text-xs">{isAr ? 'نوع المرجع' : 'Reference Type'}</Label>
          <select className="flex h-10 w-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm" value={filters.referenceType || ''} onChange={(e) => onChange({ ...filters, referenceType: e.target.value || undefined })}>
            <option value="">{isAr ? 'الكل' : 'All'}</option>
            <option value="purchase_invoice">Purchase Invoice</option>
            <option value="supplier_payment">Supplier Payment</option>
          </select>
        </div>
      )}

      <div className="flex gap-2 items-end ml-auto">
        <Button variant="outline" size="sm" onClick={onClear}><X className="h-4 w-4 mr-1" />{isAr ? 'مسح' : 'Clear'}</Button>
        <Button size="sm" onClick={onSearch}><Search className="h-4 w-4 mr-1" />{isAr ? 'بحث' : 'Search'}</Button>
      </div>
    </div>
  );
}
