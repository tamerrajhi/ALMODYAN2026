import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { JewelryItemCombobox } from '@/components/purchasing/JewelryItemCombobox';

export interface InvoiceLine {
  id: string;
  line_number: number;
  product_id: string | null;
  product_code: string;
  description: string;
  quantity: number;
  unit_price: number;
  is_inclusive: boolean;
  discount_amount: number;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
}

interface InvoiceLineRowProps {
  line: InvoiceLine;
  products: { id: string; item_code: string; description: string | null }[];
  onUpdate: (line: InvoiceLine) => void;
  onDelete: () => void;
  onItemCreated?: (item: { id: string; item_code: string; description: string | null }) => void;
}

export const calculateLine = (line: InvoiceLine): InvoiceLine => {
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

export const InvoiceLineRow = ({ line, products, onUpdate, onDelete, onItemCreated }: InvoiceLineRowProps) => {
  const { t, language } = useLanguage();

  const handleProductChange = (itemId: string | null, item: any) => {
    const updatedLine = calculateLine({
      ...line,
      product_id: itemId,
      product_code: item?.item_code || '',
      description: item?.description || line.description,
    });
    onUpdate(updatedLine);
  };

  const handleFieldChange = (field: keyof InvoiceLine, value: any) => {
    const updatedLine = calculateLine({
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

  return (
    <tr className="border-b">
      <td className="p-2 text-center">{line.line_number}</td>
      <td className="p-2">
        <JewelryItemCombobox
          items={products}
          value={line.product_id}
          onValueChange={handleProductChange}
          onItemCreated={onItemCreated}
          placeholder={t.purchaseInvoices.selectProduct}
          className="min-w-[220px]"
        />
      </td>
      <td className="p-2">
        <Input
          value={line.description}
          onChange={(e) => handleFieldChange('description', e.target.value)}
          className="min-w-[150px]"
        />
      </td>
      <td className="p-2">
        <Input
          type="number"
          min="0"
          step="1"
          value={line.quantity}
          onChange={(e) => handleFieldChange('quantity', parseFloat(e.target.value) || 0)}
          className="w-20 text-center"
        />
      </td>
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

export default InvoiceLineRow;
