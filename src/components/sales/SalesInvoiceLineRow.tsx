import { memo, useCallback, useRef } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Trash2, Copy, MoreHorizontal, AlertTriangle } from 'lucide-react';
import { ProductSearchCombobox, Product } from './ProductSearchCombobox';
import { formatCurrency } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';

export interface InvoiceLine {
  id: string;
  productId: string;
  productCode: string;
  description: string;
  branchId: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountType: 'value' | 'percentage';
  discountValue: number;
  taxRate: number;
  taxAmount: number;
  subtotalBeforeDiscount: number;
  subtotalAfterDiscount: number;
  totalBeforeTax: number;
  total: number;
  notes: string;
  availableStock: number;
  goldWeight: number;
  source: 'jewelry' | 'product';
  isService: boolean;
}

interface SalesInvoiceLineRowProps {
  line: InvoiceLine;
  index: number;
  branchId?: string;
  taxInclusive: boolean;
  defaultTaxRate: number;
  onUpdate: (updatedLine: InvoiceLine) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  canRemove: boolean;
  readOnly?: boolean;
}

export default function SalesInvoiceLineRow({
  line,
  index,
  branchId,
  taxInclusive,
  defaultTaxRate,
  onUpdate,
  onRemove,
  onDuplicate,
  canRemove,
  readOnly = false,
}: SalesInvoiceLineRowProps) {
  const { t } = useLanguage();
  const quantityRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  const handleProductSelect = useCallback((productId: string, product: Product | null) => {
    if (product) {
      onUpdate({
        ...line,
        productId: product.id,
        productCode: product.item_code,
        description: product.description || product.model || product.item_code,
        unitPrice: product.tag_price || 0,
        taxRate: product.tax_rate || defaultTaxRate,
        availableStock: product.is_service ? 999 : 1, // Services have unlimited stock
        goldWeight: product.g_weight || 0,
        branchId: product.branch_id || branchId || '',
        source: product.source,
        isService: product.is_service,
      });
      setTimeout(() => quantityRef.current?.select(), 100);
    }
  }, [line, onUpdate, defaultTaxRate, branchId]);

  const handleQuantityChange = useCallback((value: string) => {
    const qty = Math.max(1, parseInt(value) || 1);
    onUpdate({ ...line, quantity: qty });
  }, [line, onUpdate]);

  const handlePriceChange = useCallback((value: string) => {
    const price = parseFloat(value) || 0;
    onUpdate({ ...line, unitPrice: Math.max(0, price) });
  }, [line, onUpdate]);

  const handleDiscountChange = useCallback((value: string) => {
    const discount = parseFloat(value) || 0;
    onUpdate({ ...line, discountValue: Math.max(0, discount) });
  }, [line, onUpdate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, field: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (field === 'quantity') {
        priceRef.current?.focus();
      }
    }
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      onDuplicate();
    }
  }, [onDuplicate]);

  const isOutOfStock = line.productId && line.quantity > line.availableStock;

  return (
    <div className="border rounded-lg p-3 bg-card hover:bg-muted/30 transition-colors">
      {/* Main Row */}
      <div className="grid grid-cols-12 gap-2 items-start">
        {/* Product Selection - spans 3 cols */}
        <div className="col-span-12 lg:col-span-3">
          {readOnly ? (
            <div className="p-2 bg-muted rounded-md text-sm">
              {line.productCode || line.description || '-'}
            </div>
          ) : (
            <ProductSearchCombobox
              value={line.productId}
              onValueChange={handleProductSelect}
              branchId={branchId}
              excludeIds={[]}
              placeholder={t.salesInvoices?.searchProduct || 'ابحث بالاسم أو الكود'}
            />
          )}
        </div>

        {/* Description - spans 2 cols */}
        <div className="col-span-6 lg:col-span-2">
          {readOnly ? (
            <div className="p-2 bg-muted rounded-md text-sm">
              {line.description || '-'}
            </div>
          ) : (
            <Input
              value={line.description}
              onChange={(e) => onUpdate({ ...line, description: e.target.value })}
              placeholder={t.salesInvoices?.productDescription || 'الوصف'}
              className="h-9 text-sm"
            />
          )}
        </div>

        {/* Quantity - spans 1 col */}
        <div className="col-span-3 lg:col-span-1">
          {readOnly ? (
            <div className="p-2 bg-muted rounded-md text-sm text-center">
              {line.quantity}
            </div>
          ) : (
            <div className="relative">
              <Input
                ref={quantityRef}
                type="number"
                value={line.quantity}
                onChange={(e) => handleQuantityChange(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, 'quantity')}
                className="h-9 text-sm text-center"
                min={1}
                max={1}
              />
              {isOutOfStock && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertTriangle className="h-4 w-4 text-destructive absolute -top-1 -right-1" />
                    </TooltipTrigger>
                    <TooltipContent>
                      {t.salesInvoices?.insufficientStock || 'غير متوفر'}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          )}
        </div>

        {/* Unit Price - spans 1 col */}
        <div className="col-span-3 lg:col-span-1">
          {readOnly ? (
            <div className="p-2 bg-muted rounded-md text-sm text-center font-mono">
              {formatCurrency(line.unitPrice)}
            </div>
          ) : (
            <Input
              ref={priceRef}
              type="number"
              value={line.unitPrice || ''}
              onChange={(e) => handlePriceChange(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'price')}
              className="h-9 text-sm text-center"
              min={0}
              step={0.01}
            />
          )}
        </div>

        {/* Discount - spans 2 cols */}
        <div className="col-span-6 lg:col-span-2">
          {readOnly ? (
            <div className="p-2 bg-muted rounded-md text-sm text-center">
              {line.discountValue > 0 
                ? `${line.discountValue}${line.discountType === 'percentage' ? '%' : ' ر.س'}`
                : '-'}
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                value={line.discountValue || ''}
                onChange={(e) => handleDiscountChange(e.target.value)}
                className="h-9 text-sm text-center flex-1"
                min={0}
                placeholder="0"
              />
              <Select
                value={line.discountType}
                onValueChange={(v: 'value' | 'percentage') => onUpdate({ ...line, discountType: v })}
              >
                <SelectTrigger className="h-9 w-14 text-xs px-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="value">ر.س</SelectItem>
                  <SelectItem value="percentage">%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Tax Amount - spans 1 col */}
        <div className="col-span-3 lg:col-span-1 flex items-center justify-center h-9">
          <span className="text-sm font-mono text-muted-foreground">
            {formatCurrency(line.taxAmount)}
          </span>
        </div>

        {/* Line Total - spans 1 col */}
        <div className="col-span-6 lg:col-span-1 flex items-center justify-center h-9">
          <span className="text-sm font-bold font-mono text-primary">
            {formatCurrency(line.total)}
          </span>
        </div>

        {/* Actions - spans 1 col */}
        <div className="col-span-3 lg:col-span-1 flex items-center justify-end h-9">
          {!readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy className="h-4 w-4 ml-2" />
                  {t.salesInvoices?.duplicateLine || 'نسخ السطر'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={onRemove}
                  disabled={!canRemove}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 ml-2" />
                  {t.salesInvoices?.removeLine || 'حذف'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Additional Info Row */}
      {line.productId && (
        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t text-xs text-muted-foreground">
          <Badge variant="outline" className="font-mono">
            {line.productCode}
          </Badge>
          {line.goldWeight > 0 && (
            <span>{line.goldWeight.toFixed(2)} جرام</span>
          )}
          <span className="text-primary">
            {t.salesInvoices?.taxRate || 'الضريبة'}: {(line.taxRate * 100).toFixed(0)}%
          </span>
          {taxInclusive && (
            <Badge variant="secondary" className="text-xs">
              {t.salesInvoices?.taxInclusive || 'شامل الضريبة'}
            </Badge>
          )}
        </div>
      )}

      {/* Notes (Collapsible) - hide in readOnly mode */}
      {line.productId && !readOnly && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="mt-2 h-6 text-xs px-2">
              {t.salesInvoices?.lineNotes || 'ملاحظات'}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Textarea
              value={line.notes}
              onChange={(e) => onUpdate({ ...line, notes: e.target.value })}
              placeholder={t.salesInvoices?.lineNotes || 'ملاحظات البند'}
              rows={2}
              className="mt-2 text-sm"
            />
          </CollapsibleContent>
        </Collapsible>
      )}
      {/* Show notes as read-only if exists */}
      {line.productId && readOnly && line.notes && (
        <div className="mt-2 p-2 bg-muted rounded-md text-sm text-muted-foreground">
          {line.notes}
        </div>
      )}
    </div>
  );
}
