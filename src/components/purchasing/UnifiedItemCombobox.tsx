import { useMemo, useState, useEffect } from 'react';
import { Check, ChevronsUpDown, Search, Plus, Package, DollarSign, Gem } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLanguage } from '@/contexts/LanguageContext';
import { Badge } from '@/components/ui/badge';

export type ItemType = 'jewelry' | 'cost' | 'product';

export interface UnifiedItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: ItemType;
  gl_account_id?: string | null;
  warehouse_account_id?: string | null;
  tax_rate?: number | null;
}

type Props = {
  jewelryItems: { id: string; item_code: string; description: string | null }[];
  costEntries: { id: string; cost_code: string; name_ar: string; cost_type: string; gl_account_id: string; tax_rate: number | null }[];
  products: { id: string; product_code: string; name_ar: string; product_type: string; inventory_account_id: string | null; expense_account_id: string | null; tax_rate: number | null }[];
  value: string | null;
  itemType: ItemType | null;
  onValueChange: (itemId: string | null, item: UnifiedItem | null) => void;
  onAddNewJewelry?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

const typeLabels = {
  ar: {
    jewelry: 'مجوهرات',
    cost: 'تكلفة',
    product: 'منتج',
  },
  en: {
    jewelry: 'Jewelry',
    cost: 'Cost',
    product: 'Product',
  },
};

const typeColors: Record<ItemType, string> = {
  jewelry: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  cost: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  product: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
};

export function UnifiedItemCombobox({
  jewelryItems,
  costEntries,
  products,
  value,
  itemType,
  onValueChange,
  onAddNewJewelry,
  placeholder,
  disabled,
  className,
}: Props) {
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const labels = typeLabels[language === 'ar' ? 'ar' : 'en'];

  // Combine all items into unified format
  const allItems: UnifiedItem[] = useMemo(() => {
    const items: UnifiedItem[] = [];

    // Add jewelry items
    jewelryItems.forEach((item) => {
      items.push({
        id: item.id,
        code: item.item_code,
        name: item.description || item.item_code,
        description: item.description,
        type: 'jewelry',
      });
    });

    // Add cost entries
    costEntries.forEach((entry) => {
      items.push({
        id: entry.id,
        code: entry.cost_code,
        name: entry.name_ar,
        description: `${entry.cost_type}`,
        type: 'cost',
        gl_account_id: entry.gl_account_id,
        tax_rate: entry.tax_rate,
      });
    });

    // Add products
    products.forEach((product) => {
      items.push({
        id: product.id,
        code: product.product_code,
        name: product.name_ar,
        description: product.product_type,
        type: 'product',
        gl_account_id: product.inventory_account_id || product.expense_account_id,
        warehouse_account_id: product.inventory_account_id,
        tax_rate: product.tax_rate,
      });
    });

    return items;
  }, [jewelryItems, costEntries, products]);

  // Find selected item
  const selected = useMemo(() => {
    if (!value || !itemType) return null;
    return allItems.find((i) => i.id === value && i.type === itemType) || null;
  }, [allItems, value, itemType]);

  // Filter items based on search
  const filtered = useMemo(() => {
    if (!searchTerm) return allItems;
    const q = searchTerm.toLowerCase();
    return allItems.filter((i) => {
      return (
        i.code.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q)
      );
    });
  }, [allItems, searchTerm]);

  // Group items by type for better display
  const groupedItems = useMemo(() => {
    const groups: Record<ItemType, UnifiedItem[]> = {
      jewelry: [],
      cost: [],
      product: [],
    };
    filtered.forEach((item) => {
      groups[item.type].push(item);
    });
    return groups;
  }, [filtered]);

  const handleSelect = (item: UnifiedItem) => {
    onValueChange(item.id, item);
    setOpen(false);
    setSearchTerm('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between', className)}
        >
          {selected ? (
            <div className="flex items-center gap-2 truncate">
              <Badge variant="secondary" className={cn('text-xs shrink-0', typeColors[selected.type])}>
                {labels[selected.type]}
              </Badge>
              <span className="truncate" dir="ltr">
                {selected.code}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground truncate">
              {placeholder || (language === 'ar' ? 'اختر صنف...' : 'Select item...')}
            </span>
          )}
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[480px] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="me-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={language === 'ar' ? 'ابحث بالكود أو الاسم...' : 'Search by code or name...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <CommandList className="max-h-[350px]">
            {/* Add new jewelry option */}
            {onAddNewJewelry && (
              <CommandGroup>
                <CommandItem
                  value="__create_new_jewelry__"
                  onSelect={() => {
                    onAddNewJewelry();
                    setOpen(false);
                  }}
                  className="cursor-pointer text-primary"
                >
                  <Plus className="me-2 h-4 w-4" />
                  {language === 'ar' ? 'إضافة صنف مجوهرات جديد...' : 'Add new jewelry item...'}
                </CommandItem>
              </CommandGroup>
            )}

            {/* Jewelry Items */}
            {groupedItems.jewelry.length > 0 && (
              <CommandGroup heading={
                <div className="flex items-center gap-2">
                  <Gem className="h-4 w-4" />
                  {language === 'ar' ? 'المجوهرات' : 'Jewelry'}
                </div>
              }>
                {groupedItems.jewelry.map((item) => (
                  <CommandItem
                    key={`jewelry-${item.id}`}
                    value={item.id}
                    onSelect={() => handleSelect(item)}
                    className="cursor-pointer"
                  >
                    <div className="flex w-full items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate" dir="ltr">{item.code}</p>
                        {item.name && item.name !== item.code && (
                          <p className="text-xs text-muted-foreground truncate">{item.name}</p>
                        )}
                      </div>
                      <Check className={cn('h-4 w-4 shrink-0', value === item.id && itemType === 'jewelry' ? 'opacity-100' : 'opacity-0')} />
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Cost Entries */}
            {groupedItems.cost.length > 0 && (
              <CommandGroup heading={
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  {language === 'ar' ? 'التكاليف' : 'Costs'}
                </div>
              }>
                {groupedItems.cost.map((item) => (
                  <CommandItem
                    key={`cost-${item.id}`}
                    value={item.id}
                    onSelect={() => handleSelect(item)}
                    className="cursor-pointer"
                  >
                    <div className="flex w-full items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate" dir="ltr">{item.code}</p>
                          <Badge variant="outline" className="text-xs">{item.description}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{item.name}</p>
                      </div>
                      <Check className={cn('h-4 w-4 shrink-0', value === item.id && itemType === 'cost' ? 'opacity-100' : 'opacity-0')} />
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Products */}
            {groupedItems.product.length > 0 && (
              <CommandGroup heading={
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  {language === 'ar' ? 'المنتجات' : 'Products'}
                </div>
              }>
                {groupedItems.product.map((item) => (
                  <CommandItem
                    key={`product-${item.id}`}
                    value={item.id}
                    onSelect={() => handleSelect(item)}
                    className="cursor-pointer"
                  >
                    <div className="flex w-full items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate" dir="ltr">{item.code}</p>
                          <Badge variant="outline" className="text-xs">{item.description}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{item.name}</p>
                      </div>
                      <Check className={cn('h-4 w-4 shrink-0', value === item.id && itemType === 'product' ? 'opacity-100' : 'opacity-0')} />
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {filtered.length === 0 && (
              <CommandEmpty>
                <div className="text-center py-4 text-muted-foreground">
                  {language === 'ar' ? 'لا توجد عناصر' : 'No items found'}
                </div>
              </CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
