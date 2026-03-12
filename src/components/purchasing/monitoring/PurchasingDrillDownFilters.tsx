import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import * as dataGateway from '@/lib/dataGateway';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { CalendarIcon, Search, X } from 'lucide-react';
import type { PurchasingDrillDownType, PurchasingDrillDownFilters } from './types';

interface Branch {
  id: string;
  name: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface Props {
  type: PurchasingDrillDownType;
  filters: PurchasingDrillDownFilters;
  onChange: (filters: PurchasingDrillDownFilters) => void;
  onSearch: () => void;
  onClear: () => void;
}

export function PurchasingDrillDownFiltersPanel({
  type,
  filters,
  onChange,
  onSearch,
  onClear,
}: Props) {
  const { language } = useLanguage();
  const isAr = language === 'ar';

  const [branches, setBranches] = useState<Branch[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // Determine which filters to show based on type
  const showDateFilters = ['draft_invoices', 'posted_no_je', 'paid_with_remaining', 'returns_pending_post', 'returns_ref_mismatch'].includes(type);
  const showBranchFilter = ['draft_invoices', 'posted_no_je', 'paid_with_remaining', 'returns_pending_post', 'returns_ref_mismatch'].includes(type);
  const showSupplierFilter = ['draft_invoices', 'posted_no_je', 'paid_with_remaining', 'returns_pending_post', 'returns_ref_mismatch', 'vendor_negative_balance'].includes(type);

  useEffect(() => {
    // Load branches
    const loadBranchesAndSuppliers = async () => {
      try {
        const branchResult = await dataGateway.queryTable('branches', {
          select: 'id, branch_name',
          filters: { is_active: true },
        });
        
        if (branchResult.data) {
          setBranches((branchResult.data as any[]).map((b: { id: string; branch_name: string }) => ({ 
            id: b.id, 
            name: b.branch_name 
          })));
        }

        const supplierResult = await dataGateway.queryTable('suppliers', {
          select: 'id, supplier_name',
          filters: { is_active: true },
          limit: 100,
        });
        
        if (supplierResult.data) {
          setSuppliers((supplierResult.data as any[]).map((s: { id: string; supplier_name: string }) => ({ 
            id: s.id, 
            name: s.supplier_name 
          })));
        }
      } catch (error) {
        console.error('Error loading filter data:', error);
      }
    };
    
    loadBranchesAndSuppliers();
  }, []);

  return (
    <div className="bg-muted/50 rounded-lg p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Date From */}
        {showDateFilters && (
          <div className="space-y-2">
            <Label>{isAr ? 'من تاريخ' : 'From Date'}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !filters.dateFrom && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.dateFrom ? format(new Date(filters.dateFrom), 'PPP') : (isAr ? 'اختر تاريخ' : 'Pick a date')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={filters.dateFrom ? new Date(filters.dateFrom) : undefined}
                  onSelect={(date) =>
                    onChange({ ...filters, dateFrom: date?.toISOString().split('T')[0] })
                  }
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Date To */}
        {showDateFilters && (
          <div className="space-y-2">
            <Label>{isAr ? 'إلى تاريخ' : 'To Date'}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !filters.dateTo && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.dateTo ? format(new Date(filters.dateTo), 'PPP') : (isAr ? 'اختر تاريخ' : 'Pick a date')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={filters.dateTo ? new Date(filters.dateTo) : undefined}
                  onSelect={(date) =>
                    onChange({ ...filters, dateTo: date?.toISOString().split('T')[0] })
                  }
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Branch Filter */}
        {showBranchFilter && (
          <div className="space-y-2">
            <Label>{isAr ? 'الفرع' : 'Branch'}</Label>
            <select
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              value={filters.branchId || ''}
              onChange={(e) => onChange({ ...filters, branchId: e.target.value || undefined })}
            >
              <option value="">{isAr ? 'كل الفروع' : 'All Branches'}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Supplier Filter */}
        {showSupplierFilter && (
          <div className="space-y-2">
            <Label>{isAr ? 'المورد' : 'Supplier'}</Label>
            <select
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              value={filters.supplierId || ''}
              onChange={(e) => onChange({ ...filters, supplierId: e.target.value || undefined })}
            >
              <option value="">{isAr ? 'كل الموردين' : 'All Suppliers'}</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClear}>
          <X className="h-4 w-4 mr-1" />
          {isAr ? 'مسح' : 'Clear'}
        </Button>
        <Button size="sm" onClick={onSearch}>
          <Search className="h-4 w-4 mr-1" />
          {isAr ? 'بحث' : 'Search'}
        </Button>
      </div>
    </div>
  );
}