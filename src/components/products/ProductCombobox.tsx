import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Check, ChevronsUpDown, Plus, Search, Gem, Wrench, Box, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import ProductFormDialog from './ProductFormDialog';

interface Product {
  id: string;
  product_code: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  product_type: string;
  product_sub_type?: string | null;
  is_service: boolean;
  cost_price: number;
  selling_price: number;
  barcode?: string | null;
  sku?: string | null;
  inventory_account_id?: string | null;
  expense_account_id?: string | null;
  default_warehouse_id?: string | null;
}

interface ProductComboboxProps {
  value: string | null;
  onValueChange: (productId: string | null, product: Product | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const ProductCombobox = ({
  value,
  onValueChange,
  placeholder,
  disabled,
  className,
}: ProductComboboxProps) => {
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/products-active', { credentials: 'include' });
      if (res.status === 501) { setProducts([]); return; }
      if (!res.ok) throw new Error('Failed to fetch products');
      setProducts((await res.json()) || []);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const selectedProduct = products.find(p => p.id === value);

  const filteredProducts = products.filter(product => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      product.product_code.toLowerCase().includes(search) ||
      product.name_ar.toLowerCase().includes(search) ||
      (product.name_en?.toLowerCase().includes(search)) ||
      (product.description?.toLowerCase().includes(search))
    );
  });

  const getProductIcon = (product: Product) => {
    if (product.is_service) return <Wrench className="w-4 h-4 text-orange-500" />;
    if (product.product_type === 'jewelry') return <Gem className="w-4 h-4 text-purple-500" />;
    return <Box className="w-4 h-4 text-blue-500" />;
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat(language === 'ar' ? 'ar-SA' : 'en-SA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  };

  const handleProductCreated = (newProduct: Product) => {
    setProducts(prev => [newProduct, ...prev]);
    onValueChange(newProduct.id, newProduct);
    setDialogOpen(false);
    setOpen(false);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("w-full justify-between", className)}
            disabled={disabled}
          >
            {selectedProduct ? (
              <div className="flex items-center gap-2 truncate">
                {getProductIcon(selectedProduct)}
                <span className="truncate">
                  {selectedProduct.product_code} - {language === 'ar' ? selectedProduct.name_ar : (selectedProduct.name_en || selectedProduct.name_ar)}
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground">
                {placeholder || (language === 'ar' ? 'اختر منتج...' : 'Select product...')}
              </span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command shouldFilter={false}>
            <div className="flex items-center border-b px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
              <input
                className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                placeholder={language === 'ar' ? 'ابحث بالكود أو الاسم...' : 'Search by code or name...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <CommandList>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredProducts.length === 0 ? (
                <CommandEmpty>
                  <div className="text-center py-4">
                    <p className="text-muted-foreground mb-2">
                      {language === 'ar' ? 'لا توجد منتجات' : 'No products found'}
                    </p>
                  </div>
                </CommandEmpty>
              ) : (
                <CommandGroup>
                  {filteredProducts.map((product) => (
                    <CommandItem
                      key={product.id}
                      value={product.id}
                      onSelect={() => {
                        onValueChange(product.id, product);
                        setOpen(false);
                        setSearchTerm('');
                      }}
                      className="flex items-center justify-between py-3 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {getProductIcon(product)}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {product.product_code} - {product.name_ar}
                          </p>
                          {product.description && (
                            <p className="text-xs text-muted-foreground truncate">
                              {product.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground" dir="ltr">
                          {formatPrice(product.selling_price)} {language === 'ar' ? 'ر.س' : 'SAR'}
                        </span>
                        <Check
                          className={cn(
                            "h-4 w-4",
                            value === product.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    setDialogOpen(true);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2 py-3 cursor-pointer text-primary"
                >
                  <Plus className="h-4 w-4" />
                  <span className="font-medium">
                    {language === 'ar' ? 'إنشاء منتج جديد' : 'Create New Product'}
                  </span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <ProductFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={handleProductCreated}
      />
    </>
  );
};

export default ProductCombobox;
