import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import { queryTable } from '@/lib/dataGateway';
import { Check, ChevronsUpDown, Package, Search, AlertCircle, Gem, Wrench } from 'lucide-react';
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

interface ProductSearchComboboxProps {
  value: string;
  onValueChange: (productId: string, product: Product | null) => void;
  branchId?: string;
  disabled?: boolean;
  placeholder?: string;
  excludeIds?: string[];
}

export interface Product {
  id: string;
  item_code: string;
  model: string | null;
  description: string | null;
  tag_price: number | null;
  g_weight: number | null;
  branch_id: string | null;
  category: string | null;
  source: 'jewelry' | 'product';
  is_service: boolean;
  tax_rate: number | null;
}

export function ProductSearchCombobox({
  value,
  onValueChange,
  branchId,
  disabled = false,
  placeholder,
  excludeIds = [],
}: ProductSearchComboboxProps) {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch jewelry items from unique_items table
  const { data: jewelryItems = [], isLoading: isLoadingJewelry } = useQuery({
    queryKey: ['jewelry-items-for-sale', branchId],
    queryFn: async () => {
      const filters: any[] = [
        { column: 'sold_at', type: 'is', value: null },
      ];
      if (branchId) {
        filters.push({ column: 'branch_id', type: 'eq', value: branchId });
      }

      const { data, error } = await queryTable('unique_items', {
        select: 'id, serial_no, model, description, tag_price, g_weight, branch_id, type',
        filters,
        limit: 500,
      });
      if (error) throw error;
      
      return (data || []).map((item: any) => ({
        id: item.id,
        item_code: item.serial_no,
        model: item.model,
        description: item.description,
        tag_price: item.tag_price,
        g_weight: item.g_weight,
        branch_id: item.branch_id,
        category: item.type,
        source: 'jewelry' as const,
        is_service: false,
        tax_rate: 0.15,
      }));
    },
  });

  // Fetch products from products table
  const { data: generalProducts = [], isLoading: isLoadingProducts } = useQuery({
    queryKey: ['products-for-sale', branchId],
    queryFn: async () => {
      const url = branchId ? `/api/products-combobox?branch=${branchId}` : '/api/products-combobox';
      const res = await fetch(url, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch products');
      const data = await res.json();
      
      return (data || []).map((item: any) => ({
        id: item.id,
        item_code: item.product_code,
        model: language === 'ar' ? item.name_ar : (item.name_en || item.name_ar),
        description: item.description,
        tag_price: item.selling_price,
        g_weight: item.weight_grams,
        branch_id: item.branch_id,
        category: item.product_type,
        source: 'product' as const,
        is_service: item.is_service || false,
        tax_rate: item.tax_rate || 0.15,
      }));
    },
  });

  // Combine all products
  const allProducts: Product[] = [...jewelryItems, ...generalProducts];
  const isLoading = isLoadingJewelry || isLoadingProducts;

  const availableProducts = allProducts.filter((p) => !excludeIds.includes(p.id));

  const selectedProduct = allProducts.find((p) => p.id === value);

  const filteredProducts = availableProducts.filter((product) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      product.item_code.toLowerCase().includes(searchLower) ||
      product.model?.toLowerCase().includes(searchLower) ||
      product.description?.toLowerCase().includes(searchLower) ||
      product.category?.toLowerCase().includes(searchLower)
    );
  });

  // Group products by source
  const jewelryProducts = filteredProducts.filter(p => p.source === 'jewelry');
  const otherProducts = filteredProducts.filter(p => p.source === 'product');

  const handleSelect = useCallback((productId: string) => {
    const product = allProducts.find((p) => p.id === productId) || null;
    onValueChange(productId, product);
    setOpen(false);
    setSearch('');
  }, [allProducts, onValueChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
    }
    if (e.key === 'Enter' && filteredProducts.length === 1) {
      e.preventDefault();
      handleSelect(filteredProducts[0].id);
    }
  }, [filteredProducts, handleSelect]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const getProductIcon = (product: Product) => {
    if (product.source === 'jewelry') {
      return <Gem className="h-3.5 w-3.5 text-amber-500" />;
    }
    if (product.is_service) {
      return <Wrench className="h-3.5 w-3.5 text-blue-500" />;
    }
    return <Package className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  const getSourceBadge = (product: Product) => {
    if (product.source === 'jewelry') {
      return <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">مجوهرات</Badge>;
    }
    if (product.is_service) {
      return <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">خدمة</Badge>;
    }
    return <Badge variant="outline" className="text-xs">منتج</Badge>;
  };

  const renderProductItem = (product: Product) => (
    <CommandItem
      key={product.id}
      value={product.id}
      onSelect={() => handleSelect(product.id)}
      className="flex items-center gap-3 py-2.5 cursor-pointer"
    >
      <Check
        className={cn(
          'h-4 w-4 shrink-0',
          value === product.id ? 'opacity-100' : 'opacity-0'
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {getProductIcon(product)}
          <Badge variant="secondary" className="text-xs font-mono">
            {product.item_code}
          </Badge>
          {product.model && (
            <span className="text-sm font-medium truncate">{product.model}</span>
          )}
          {getSourceBadge(product)}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          {product.description && (
            <span className="truncate max-w-[150px]">{product.description}</span>
          )}
          {product.g_weight && product.g_weight > 0 && (
            <span>{product.g_weight}g</span>
          )}
          <span className="font-medium text-foreground">
            {formatCurrency(product.tag_price || 0)}
          </span>
        </div>
      </div>
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-auto min-h-[36px] py-1.5 text-sm"
          disabled={disabled}
        >
          {selectedProduct ? (
            <div className="flex items-center gap-2 text-right w-full">
              {getProductIcon(selectedProduct)}
              <span className="truncate">
                {selectedProduct.item_code}
                {selectedProduct.model && ` - ${selectedProduct.model}`}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">
              {placeholder || t.purchaseInvoices?.selectProduct || 'اختر المنتج'}
            </span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[450px] p-0"
        align={language === 'ar' ? 'end' : 'start'}
        onKeyDown={handleKeyDown}
      >
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <CommandInput
              ref={inputRef}
              placeholder="بحث بالكود أو الاسم أو الباركود..."
              value={search}
              onValueChange={setSearch}
              className="flex h-9 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <CommandList className="max-h-[350px]">
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t.common.loading}
              </div>
            ) : filteredProducts.length === 0 ? (
              <CommandEmpty>
                <div className="py-4 text-center">
                  <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {t.common.noResults}
                  </p>
                </div>
              </CommandEmpty>
            ) : (
              <>
                {/* Jewelry Items Group */}
                {jewelryProducts.length > 0 && (
                  <CommandGroup heading={
                    <div className="flex items-center gap-2 text-amber-600">
                      <Gem className="h-4 w-4" />
                      <span>المجوهرات ({jewelryProducts.length})</span>
                    </div>
                  }>
                    {jewelryProducts.slice(0, 30).map(renderProductItem)}
                  </CommandGroup>
                )}

                {/* Other Products Group */}
                {otherProducts.length > 0 && (
                  <CommandGroup heading={
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Package className="h-4 w-4" />
                      <span>المنتجات والخدمات ({otherProducts.length})</span>
                    </div>
                  }>
                    {otherProducts.slice(0, 30).map(renderProductItem)}
                  </CommandGroup>
                )}

                {filteredProducts.length > 60 && (
                  <div className="py-2 px-3 text-xs text-muted-foreground text-center border-t">
                    {t.common.showing || 'يظهر'} 60 {t.common.of || 'من'} {filteredProducts.length} {t.common.items || 'عنصر'}
                  </div>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
