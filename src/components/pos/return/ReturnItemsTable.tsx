import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Package, 
  Loader2, 
  AlertTriangle,
  CheckSquare,
  Square
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';

interface SaleItem {
  id: string;
  item_id: string;
  item_code: string;
  item_name: string;
  barcode?: string;
  original_quantity: number;
  previously_returned: number;
  available_quantity: number;
  return_quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
  return_reason: string;
  selected: boolean;
  supp_ref?: string | null;
}

interface ReturnItemsTableProps {
  items: SaleItem[];
  isLoading: boolean;
  onQuantityChange: (itemId: string, quantity: number) => void;
  onReasonChange: (itemId: string, reason: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

export function ReturnItemsTable({
  items,
  isLoading,
  onQuantityChange,
  onReasonChange,
  onSelectAll,
  onClearSelection
}: ReturnItemsTableProps) {
  const hasSelectedItems = items.some(item => item.return_quantity > 0);
  const allAvailableSelected = items.every(item => item.available_quantity === 0 || item.return_quantity === item.available_quantity);
  const hasPartiallyReturned = items.some(item => item.previously_returned > 0);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>جاري تحميل الأصناف...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Package className="w-12 h-12 mb-3 opacity-50" />
          <span>لا توجد أصناف متاحة للإرجاع</span>
        </CardContent>
      </Card>
    );
  }

  if (items.every(item => item.available_quantity === 0)) {
    return (
      <Card>
        <CardContent className="py-6">
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              تم إرجاع جميع أصناف هذه الفاتورة بالكامل. لا يمكن إنشاء مرتجع إضافي.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Package className="w-5 h-5 text-primary" />
            </div>
            <span>الأصناف المطلوب إرجاعها</span>
            {hasPartiallyReturned && (
              <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300">
                يوجد أصناف مرتجعة سابقاً
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onSelectAll}
              disabled={allAvailableSelected}
              className="gap-2"
            >
              <CheckSquare className="w-4 h-4" />
              اختيار الكل
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onClearSelection}
              disabled={!hasSelectedItems}
              className="gap-2"
            >
              <Square className="w-4 h-4" />
              إلغاء التحديد
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-12 text-center">✓</TableHead>
                  <TableHead className="min-w-[100px]">كود الصنف</TableHead>
                  <TableHead className="min-w-[150px]">اسم الصنف</TableHead>
                  <TableHead className="text-center w-24">الكمية المباعة</TableHead>
                  <TableHead className="text-center w-24">مرتجع سابقاً</TableHead>
                  <TableHead className="text-center w-24">المتبقي</TableHead>
                  <TableHead className="text-center w-32">الكمية المراد إرجاعها</TableHead>
                  <TableHead className="text-left w-24">السعر</TableHead>
                  <TableHead className="text-left w-24">الضريبة</TableHead>
                  <TableHead className="text-left w-28">الإجمالي</TableHead>
                  <TableHead className="min-w-[140px]">سبب الإرجاع</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(item => {
                  const isFullyReturned = item.available_quantity === 0;
                  const isPartiallyReturned = item.previously_returned > 0;
                  const isSelected = item.return_quantity > 0;

                  return (
                    <TableRow 
                      key={item.item_id} 
                      className={`
                        transition-colors
                        ${isSelected ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/50'} 
                        ${isFullyReturned ? 'opacity-50 bg-muted/30' : ''}
                        ${isPartiallyReturned && !isFullyReturned ? 'border-r-4 border-r-amber-400' : ''}
                      `}
                    >
                      <TableCell className="text-center">
                        <Checkbox 
                          checked={isSelected}
                          disabled={isFullyReturned}
                          onCheckedChange={(checked) => {
                            onQuantityChange(item.item_id, checked ? item.available_quantity : 0);
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm font-medium">{item.item_code}</TableCell>
                      <TableCell>
                        <div className="font-medium">{item.item_name}</div>
                        {item.barcode && (
                          <div className="text-xs text-muted-foreground font-mono">{item.barcode}</div>
                        )}
                        {item.supp_ref && (
                          <div className="text-xs text-muted-foreground">فاتورة المورد: {item.supp_ref}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-medium">{item.original_quantity}</TableCell>
                      <TableCell className="text-center">
                        {item.previously_returned > 0 ? (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-amber-300">
                            {item.previously_returned}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {isFullyReturned ? (
                          <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 text-xs">
                            مرتجع بالكامل
                          </Badge>
                        ) : (
                          <span className={`font-bold ${item.available_quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {item.available_quantity}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          max={item.available_quantity}
                          value={item.return_quantity}
                          disabled={isFullyReturned}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            if (val > item.available_quantity) {
                              toast.error(`الكمية المراد إرجاعها (${val}) أكبر من المتاح (${item.available_quantity})`);
                            }
                            onQuantityChange(item.item_id, val);
                          }}
                          className={`w-20 text-center ${isSelected ? 'border-primary' : ''}`}
                        />
                      </TableCell>
                      <TableCell className="text-left font-medium">{formatCurrency(item.unit_price)}</TableCell>
                      <TableCell className="text-left text-muted-foreground">{formatCurrency(item.tax_amount)}</TableCell>
                      <TableCell className="text-left">
                        <span className={`font-bold ${isSelected ? 'text-primary' : ''}`}>
                          {formatCurrency(item.line_total)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Input
                          placeholder="السبب..."
                          value={item.return_reason}
                          onChange={(e) => onReasonChange(item.item_id, e.target.value)}
                          className="text-sm"
                          disabled={isFullyReturned}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
