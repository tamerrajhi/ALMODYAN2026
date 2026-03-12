import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Search, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLanguage } from '@/contexts/LanguageContext';
import JewelryItemFormDialog from '@/components/products/JewelryItemFormDialog';

export type JewelryItemOption = {
  id: string;
  item_code: string;
  description: string | null;
};

type Props = {
  items: JewelryItemOption[];
  value: string | null;
  onValueChange: (itemId: string | null, item: JewelryItemOption | null) => void;
  onItemCreated?: (item: JewelryItemOption) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function JewelryItemCombobox({
  items,
  value,
  onValueChange,
  onItemCreated,
  placeholder,
  disabled,
  className,
}: Props) {
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const selected = useMemo(() => items.find((i) => i.id === value) || null, [items, value]);

  const filtered = useMemo(() => {
    if (!searchTerm) return items;
    const q = searchTerm.toLowerCase();
    return items.filter((i) => {
      return (
        i.item_code.toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q)
      );
    });
  }, [items, searchTerm]);

  const handleItemCreated = (item: JewelryItemOption) => {
    onValueChange(item.id, item);
    onItemCreated?.(item);
    setOpen(false);
    setSearchTerm('');
  };

  return (
    <>
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
              <span className="truncate" dir="ltr">
                {selected.item_code}
                {selected.description ? ` — ${selected.description}` : ''}
              </span>
            ) : (
              <span className="text-muted-foreground truncate">
                {placeholder || (language === 'ar' ? 'اختر صنف...' : 'Select item...')}
              </span>
            )}
            <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[420px] p-0" align="start">
          <Command shouldFilter={false}>
            <div className="flex items-center border-b px-3">
              <Search className="me-2 h-4 w-4 shrink-0 opacity-50" />
              <input
                className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                placeholder={language === 'ar' ? 'ابحث بالكود أو الوصف...' : 'Search by code or description...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <CommandList>
              {/* Add new item option */}
              <CommandGroup>
                <CommandItem
                  value="__create_new__"
                  onSelect={() => {
                    setDialogOpen(true);
                    setOpen(false);
                  }}
                  className="cursor-pointer text-primary"
                >
                  <Plus className="me-2 h-4 w-4" />
                  {language === 'ar' ? 'إضافة صنف جديد...' : 'Add new item...'}
                </CommandItem>
              </CommandGroup>

              {filtered.length === 0 ? (
                <CommandEmpty>
                  <div className="text-center py-4 text-muted-foreground">
                    {language === 'ar' ? 'لا توجد أصناف' : 'No items found'}
                  </div>
                </CommandEmpty>
              ) : (
                <CommandGroup>
                  {filtered.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onSelect={() => {
                        onValueChange(item.id, item);
                        setOpen(false);
                        setSearchTerm('');
                      }}
                      className="cursor-pointer"
                    >
                      <div className="flex w-full items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate" dir="ltr">{item.item_code}</p>
                          {item.description ? (
                            <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                          ) : null}
                        </div>
                        <Check className={cn('h-4 w-4 shrink-0', value === item.id ? 'opacity-100' : 'opacity-0')} />
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <JewelryItemFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={handleItemCreated}
        defaultCode={searchTerm}
        context="purchase-invoice"
      />
    </>
  );
}
