import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Check, ChevronsUpDown, Plus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import QuickSupplierDialog from './QuickSupplierDialog';
import { searchSuppliersForSelect, getSupplierById, SupplierSelectDTO } from '@/domain/purchasing/purchasingReadService';

interface SupplierSelectProps {
  value: string;
  onSelect: (supplierId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  showAddButton?: boolean;
  compact?: boolean;
}

// Debounce hook
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export default function SupplierSelect({
  value,
  onSelect,
  disabled = false,
  placeholder = 'اختر المورد',
  showAddButton = true,
  compact = false,
}: SupplierSelectProps) {
  const [open, setOpen] = useState(false);
  const [quickDialogOpen, setQuickDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const queryClient = useQueryClient();

  // Server-side search for suppliers via read service
  const { data: suppliers, isLoading, isError, refetch } = useQuery({
    queryKey: ['suppliers-for-select', debouncedSearch],
    queryFn: () => searchSuppliersForSelect({ q: debouncedSearch }),
  });

  // Fetch the selected supplier if not in the list
  const { data: selectedSupplier } = useQuery({
    queryKey: ['selected-supplier', value],
    queryFn: () => getSupplierById(value),
    enabled: !!value && !suppliers?.find(s => s.id === value),
  });

  // Single display source - checks list first, then selectedSupplier
  const displaySupplier: SupplierSelectDTO | null = useMemo(() => {
    if (!value) return null;
    const fromList = suppliers?.find(s => s.id === value);
    if (fromList) return fromList;
    if (selectedSupplier) return selectedSupplier;
    return null;
  }, [value, suppliers, selectedSupplier]);

  const handleSupplierCreated = (newSupplierId: string) => {
    // Refetch suppliers list
    refetch().then(() => {
      // Select the new supplier
      onSelect(newSupplierId);
      setQuickDialogOpen(false);
    });
    queryClient.invalidateQueries({ queryKey: ['suppliers-list'] });
  };

  if (isError) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className={cn(
            'justify-between text-destructive',
            compact ? 'h-8 text-sm w-32' : 'w-full'
          )}
          disabled
        >
          خطأ في التحميل
        </Button>
        {showAddButton && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className={cn('shrink-0', compact ? 'h-8 w-8' : 'h-10 w-10')}
                  onClick={() => setQuickDialogOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>إضافة مورد جديد</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'justify-between',
              compact ? 'h-8 text-sm w-32' : 'w-full',
              !value && 'text-muted-foreground'
            )}
            disabled={disabled || isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : displaySupplier ? (
              <div className="flex flex-col items-start truncate">
                <span className="truncate">{displaySupplier.supplierName}</span>
                {displaySupplier.supplierRef && (
                  <span className="text-xs text-muted-foreground truncate">{displaySupplier.supplierRef}</span>
                )}
              </div>
            ) : (
              <span>{placeholder}</span>
            )}
            <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <Command dir="rtl" shouldFilter={false}>
            <CommandInput 
              placeholder="ابحث عن مورد..." 
              className="text-right" 
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              <CommandEmpty>
                <div className="py-4 text-center text-sm text-muted-foreground">
                  لا توجد بيانات – برجاء إضافة مورد جديد
                </div>
              </CommandEmpty>
              <CommandGroup>
                {suppliers?.map((supplier) => (
                  <CommandItem
                    key={supplier.id}
                    value={`${supplier.supplierName} ${supplier.supplierRef || ''} ${supplier.phone || ''} ${supplier.vatNumber || ''}`}
                    onSelect={() => {
                      onSelect(supplier.id);
                      setOpen(false);
                    }}
                    className="text-right"
                  >
                    <Check
                      className={cn(
                        'ml-2 h-4 w-4',
                        value === supplier.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <div className="flex flex-col">
                      <span>{supplier.supplierName}</span>
                      {supplier.supplierRef && (
                        <span className="text-xs text-muted-foreground">
                          {supplier.supplierRef}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {showAddButton && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className={cn(
                  'shrink-0 rounded-full',
                  compact ? 'h-8 w-8' : 'h-10 w-10'
                )}
                onClick={() => setQuickDialogOpen(true)}
                disabled={disabled}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>إضافة مورد جديد</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      <QuickSupplierDialog
        open={quickDialogOpen}
        onOpenChange={setQuickDialogOpen}
        onSupplierCreated={handleSupplierCreated}
      />
    </div>
  );
}
