import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Package, AlertCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface InvoiceItem {
  id: string;
  productCode: string;
  productName: string;
  description?: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  discountPercentage: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  returnedQuantity?: number;
  warehouseName?: string;
  goldWeight?: number;
  source?: 'jewelry' | 'product';
  supp_ref?: string | null;
}

interface InvoiceItemsTableProps {
  items: InvoiceItem[];
  showWarehouse?: boolean;
  showReturnedQty?: boolean;
}

export default function InvoiceItemsTable({
  items,
  showWarehouse = false,
  showReturnedQty = false,
}: InvoiceItemsTableProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Package className="w-4 h-4" />
          تفاصيل الأصناف
          <Badge variant="secondary" className="mr-2">
            {items.length} صنف
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-right w-12">#</TableHead>
                <TableHead className="text-right">كود الصنف</TableHead>
                <TableHead className="text-right">اسم الصنف</TableHead>
                <TableHead className="text-right">فاتورة المورد</TableHead>
                <TableHead className="text-center">الوحدة</TableHead>
                <TableHead className="text-center">الكمية</TableHead>
                <TableHead className="text-center">السعر</TableHead>
                <TableHead className="text-center">الخصم</TableHead>
                <TableHead className="text-center">الضريبة</TableHead>
                <TableHead className="text-center">الإجمالي</TableHead>
                {showReturnedQty && (
                  <TableHead className="text-center">المرتجع</TableHead>
                )}
                {showWarehouse && (
                  <TableHead className="text-center">المخزن</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell 
                    colSpan={showWarehouse && showReturnedQty ? 12 : showWarehouse || showReturnedQty ? 11 : 10} 
                    className="text-center py-8 text-muted-foreground"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <AlertCircle className="w-8 h-8" />
                      <p>لا توجد أصناف في هذه الفاتورة</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item, index) => {
                  const hasDiscount = item.discountAmount > 0 || item.discountPercentage > 0;
                  const hasReturns = (item.returnedQuantity || 0) > 0;

                  return (
                    <TableRow key={item.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium text-muted-foreground">
                        {index + 1}
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {item.productCode || '-'}
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium">{item.productName}</p>
                          {item.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {item.description}
                            </p>
                          )}
                          {item.goldWeight && item.goldWeight > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {item.goldWeight.toFixed(2)} جم
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.supp_ref || '-'}
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        {item.unit === 'piece' ? 'قطعة' : item.unit}
                      </TableCell>
                      <TableCell className="text-center font-mono">
                        {item.quantity}
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">
                        {formatCurrency(item.unitPrice)}
                      </TableCell>
                      <TableCell className="text-center">
                        {hasDiscount ? (
                          <span className="text-destructive font-mono text-sm">
                            {item.discountPercentage > 0 
                              ? `${item.discountPercentage}%`
                              : formatCurrency(item.discountAmount)
                            }
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="text-sm">
                          <span className="font-mono">{formatCurrency(item.taxAmount)}</span>
                          <span className="text-xs text-muted-foreground block">
                            ({(item.taxRate * 100).toFixed(0)}%)
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-mono font-medium">
                        {formatCurrency(item.totalAmount)}
                      </TableCell>
                      {showReturnedQty && (
                        <TableCell className="text-center">
                          {hasReturns ? (
                            <Badge variant="destructive" className="text-xs">
                              {item.returnedQuantity}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      )}
                      {showWarehouse && (
                        <TableCell className="text-center text-sm">
                          {item.warehouseName || '-'}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Items Summary Footer */}
        {items.length > 0 && (
          <div className="border-t bg-muted/30 px-4 py-3">
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-muted-foreground">إجمالي الأصناف:</span>
                <span className="font-medium mr-2">{items.length}</span>
              </div>
              <div>
                <span className="text-muted-foreground">إجمالي الكميات:</span>
                <span className="font-medium mr-2">
                  {items.reduce((sum, item) => sum + item.quantity, 0)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">إجمالي القيمة:</span>
                <span className="font-medium font-mono mr-2">
                  {formatCurrency(items.reduce((sum, item) => sum + item.totalAmount, 0))}
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
