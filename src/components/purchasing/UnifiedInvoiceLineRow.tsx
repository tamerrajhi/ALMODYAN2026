import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { UnifiedItemCombobox, ItemType, UnifiedItem } from './UnifiedItemCombobox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface UnifiedInvoiceLine {
  id: string;
  line_number: number;
  item_id: string | null;
  item_type: ItemType | null;
  item_code: string;
  description: string;
  quantity: number;
  unit_price: number;
  is_inclusive: boolean;
  discount_amount: number;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  gl_account_id?: string | null;
  warehouse_account_id?: string | null;
}

interface Props {
  line: UnifiedInvoiceLine;
  jewelryItems: { id: string; item_code: string; description: string | null }[];
  costEntries: { id: string; cost_code: string; name_ar: string; cost_type: string; gl_account_id: string; tax_rate: number | null }[];
  products: { id: string; product_code: string; name_ar: string; product_type: string; inventory_account_id: string | null; expense_account_id: string | null; tax_rate: number | null }[];
  onUpdate: (line: UnifiedInvoiceLine) => void;
  onDelete: () => void;
  onAddNewJewelry?: () => void;
  // Props for return quantity validation
  availableQty?: number;
  showAvailableColumn?: boolean;
  isOverLimit?: boolean;
}

export const calculateUnifiedLine = (line: UnifiedInvoiceLine): UnifiedInvoiceLine => {
  const quantity = line.quantity || 0;
  const unitPrice = line.unit_price || 0;
  const discount = line.discount_amount || 0;
  const taxRate = line.tax_rate || 15;

  let subtotal: number;
  let taxAmount: number;
  let totalAmount: number;

  if (line.is_inclusive) {
    const grossTotal = quantity * unitPrice - discount;
    subtotal = grossTotal / (1 + taxRate / 100);
    taxAmount = grossTotal - subtotal;
    totalAmount = grossTotal;
  } else {
    subtotal = quantity * unitPrice - discount;
    taxAmount = subtotal * (taxRate / 100);
    totalAmount = subtotal + taxAmount;
  }

  return {
    ...line,
    subtotal: Math.round(subtotal * 100) / 100,
    tax_amount: Math.round(taxAmount * 100) / 100,
    total_amount: Math.round(totalAmount * 100) / 100,
  };
};

const typeColors: Record<ItemType, string> = {
  jewelry: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  cost: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  product: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
};

export const UnifiedInvoiceLineRow = ({ 
  line, 
  jewelryItems, 
  costEntries, 
  products, 
  onUpdate, 
  onDelete,
  onAddNewJewelry,
  availableQty,
  showAvailableColumn,
  isOverLimit
}: Props) => {
  const { t, language } = useLanguage();

  const handleItemChange = (itemId: string | null, item: UnifiedItem | null) => {
    const taxRate = item?.tax_rate ?? line.tax_rate;
    const updatedLine = calculateUnifiedLine({
      ...line,
      item_id: itemId,
      item_type: item?.type || null,
      item_code: item?.code || '',
      description: item?.name || line.description,
      gl_account_id: item?.gl_account_id || null,
      warehouse_account_id: item?.warehouse_account_id || null,
      tax_rate: taxRate,
    });
    onUpdate(updatedLine);
  };

  const handleFieldChange = (field: keyof UnifiedInvoiceLine, value: any) => {
    const updatedLine = calculateUnifiedLine({
      ...line,
      [field]: value,
    });
    onUpdate(updatedLine);
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const typeLabels = {
    jewelry: language === 'ar' ? 'مجوهرات' : 'Jewelry',
    cost: language === 'ar' ? 'تكلفة' : 'Cost',
    product: language === 'ar' ? 'منتج' : 'Product',
  };

  return (
    <tr className="border-b">
      <td className="p-2 text-center">{line.line_number}</td>
      <td className="p-2">
        <div className="space-y-1">
          <UnifiedItemCombobox
            jewelryItems={jewelryItems}
            costEntries={costEntries}
            products={products}
            value={line.item_id}
            itemType={line.item_type}
            onValueChange={handleItemChange}
            onAddNewJewelry={onAddNewJewelry}
            placeholder={t.purchaseInvoices.selectProduct}
            className="min-w-[180px] w-[220px]"
          />
          {line.item_type && (
            <Badge variant="secondary" className={cn('text-xs', typeColors[line.item_type])}>
              {typeLabels[line.item_type]}
            </Badge>
          )}
        </div>
      </td>
      <td className="p-2">
        <Input
          value={line.description}
          onChange={(e) => handleFieldChange('description', e.target.value)}
          className="min-w-[120px] w-[180px]"
        />
      </td>
      <td className="p-2">
        <Input
          type="number"
          min="0"
          max={availableQty}
          step="1"
          value={line.quantity}
          onChange={(e) => handleFieldChange('quantity', parseFloat(e.target.value) || 0)}
          className={cn(
            "w-20 text-center",
            isOverLimit && "border-destructive bg-destructive/10 text-destructive"
          )}
        />
        {isOverLimit && (
          <span className="text-xs text-destructive block mt-1">
            {language === 'ar' ? `الحد الأقصى: ${availableQty}` : `Max: ${availableQty}`}
          </span>
        )}
      </td>
      {showAvailableColumn && (
        <td className="p-2 text-center">
          <span className={cn(
            "text-sm font-medium",
            availableQty === 0 ? "text-muted-foreground" : "text-orange-600"
          )}>
            {availableQty ?? '-'}
          </span>
        </td>
      )}
      <td className="p-2">
        <Input
          type="number"
          min="0"
          step="0.01"
          value={line.unit_price}
          onChange={(e) => handleFieldChange('unit_price', parseFloat(e.target.value) || 0)}
          className="w-28"
          dir="ltr"
        />
      </td>
      <td className="p-2 text-center">
        <Checkbox
          checked={line.is_inclusive}
          onCheckedChange={(checked) => handleFieldChange('is_inclusive', !!checked)}
        />
      </td>
      <td className="p-2">
        <Input
          type="number"
          min="0"
          step="0.01"
          value={line.discount_amount}
          onChange={(e) => handleFieldChange('discount_amount', parseFloat(e.target.value) || 0)}
          className="w-24"
          dir="ltr"
        />
      </td>
      <td className="p-2 text-center font-medium" dir="ltr">
        {formatNumber(line.subtotal)}
      </td>
      <td className="p-2">
        <Input
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={line.tax_rate}
          onChange={(e) => handleFieldChange('tax_rate', parseFloat(e.target.value) || 0)}
          className="w-20 text-center"
          dir="ltr"
        />
      </td>
      <td className="p-2 text-center" dir="ltr">
        {formatNumber(line.tax_amount)}
      </td>
      <td className="p-2 text-center font-bold" dir="ltr">
        {formatNumber(line.total_amount)}
      </td>
      <td className="p-2">
        <Button variant="ghost" size="icon" onClick={onDelete} className="text-destructive">
          <Trash2 className="w-4 h-4" />
        </Button>
      </td>
    </tr>
  );
};

export default UnifiedInvoiceLineRow;
