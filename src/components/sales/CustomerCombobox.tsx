import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import { Check, ChevronsUpDown, User, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
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
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';

interface CustomerComboboxProps {
  value: string;
  onSelect: (value: string) => void;
  onAddNew?: () => void;
  disabled?: boolean;
  placeholder?: string;
}

interface Customer {
  id: string;
  customer_code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  total_purchases: number | null;
  vat_number: string | null;
  address: string | null;
}

export default function CustomerCombobox({
  value,
  onSelect,
  onAddNew,
  disabled = false,
  placeholder,
}: CustomerComboboxProps) {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers-combobox'],
    queryFn: async () => {
      const res = await fetch('/api/customers-combobox', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch customers');
      return (await res.json()) as Customer[];
    },
  });

  const selectedCustomer = customers.find((c) => c.id === value);

  const filteredCustomers = customers.filter((customer) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      customer.full_name.toLowerCase().includes(searchLower) ||
      customer.customer_code.toLowerCase().includes(searchLower) ||
      customer.phone?.includes(search) ||
      customer.vat_number?.includes(search)
    );
  });

  const handleSelect = useCallback((customerId: string) => {
    onSelect(customerId);
    setOpen(false);
    setSearch('');
  }, [onSelect]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-auto min-h-[40px] py-2"
          disabled={disabled}
        >
          {selectedCustomer ? (
            <div className="flex items-center gap-2 text-right w-full">
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex flex-col items-start flex-1 min-w-0">
                <span className="font-medium truncate">{selectedCustomer.full_name}</span>
                <span className="text-xs text-muted-foreground">
                  {selectedCustomer.customer_code}
                  {selectedCustomer.phone && ` • ${selectedCustomer.phone}`}
                </span>
              </div>
            </div>
          ) : (
            <span className="text-muted-foreground">
              {placeholder || t.salesInvoices?.searchCustomer || 'اختر العميل'}
            </span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-[400px] p-0" 
        align={language === 'ar' ? 'end' : 'start'}
        onKeyDown={handleKeyDown}
      >
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <CommandInput
              ref={inputRef}
              placeholder={t.customers?.searchPlaceholder || 'بحث بالاسم أو الكود أو الهاتف...'}
              value={search}
              onValueChange={setSearch}
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <CommandList className="max-h-[300px]">
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t.common?.loading || 'جاري التحميل...'}
              </div>
            ) : filteredCustomers.length === 0 ? (
              <CommandEmpty>
                <div className="py-4 text-center">
                  <p className="text-sm text-muted-foreground mb-2">{t.common?.noResults || 'لا توجد نتائج'}</p>
                  {onAddNew && (
                    <Button variant="outline" size="sm" onClick={onAddNew}>
                      <Plus className="h-4 w-4 ml-1" />
                      {t.salesInvoices?.addNewCustomer || 'إضافة عميل جديد'}
                    </Button>
                  )}
                </div>
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {filteredCustomers.map((customer) => (
                  <CommandItem
                    key={customer.id}
                    value={customer.id}
                    onSelect={() => handleSelect(customer.id)}
                    className="flex items-center gap-3 py-3 cursor-pointer"
                  >
                    <Check
                      className={cn(
                        'h-4 w-4 shrink-0',
                        value === customer.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{customer.full_name}</span>
                        <Badge variant="outline" className="text-xs">
                          {customer.customer_code}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        {customer.phone && <span>{customer.phone}</span>}
                        {customer.total_purchases !== null && customer.total_purchases > 0 && (
                          <>
                            <span>•</span>
                            <span>
                              {t.customers?.totalPurchases || 'المشتريات'}: {formatCurrency(customer.total_purchases)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          {onAddNew && filteredCustomers.length > 0 && (
            <div className="p-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  setOpen(false);
                  onAddNew();
                }}
              >
                <Plus className="h-4 w-4 ml-1" />
                {t.salesInvoices?.addNewCustomer || 'إضافة عميل جديد'}
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
