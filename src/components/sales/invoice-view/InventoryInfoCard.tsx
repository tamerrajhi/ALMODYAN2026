import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package, CheckCircle2, XCircle, Calendar, Warehouse } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

interface InventoryInfoCardProps {
  isDeducted: boolean;
  deductionDate?: string | null;
  warehouseName?: string | null;
  status: string;
}

export default function InventoryInfoCard({
  isDeducted,
  deductionDate,
  warehouseName,
  status,
}: InventoryInfoCardProps) {
  // Draft invoices don't affect inventory
  const isDraft = status === 'draft';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Package className="w-4 h-4" />
          معلومات المخزون
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* Inventory Deduction Status */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">حالة الخصم من المخزون:</span>
          {isDraft ? (
            <Badge variant="outline" className="gap-1">
              <XCircle className="w-3 h-3" />
              لم يخصم (مسودة)
            </Badge>
          ) : isDeducted ? (
            <Badge variant="default" className="gap-1 bg-green-500">
              <CheckCircle2 className="w-3 h-3" />
              تم الخصم
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="w-3 h-3" />
              لم يخصم
            </Badge>
          )}
        </div>

        {/* Deduction Date */}
        {isDeducted && deductionDate && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              تاريخ الخصم:
            </span>
            <span className="font-medium">
              {format(new Date(deductionDate), 'dd MMM yyyy HH:mm', { locale: ar })}
            </span>
          </div>
        )}

        {/* Warehouse */}
        {warehouseName && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Warehouse className="w-3 h-3" />
              المستودع:
            </span>
            <span className="font-medium">{warehouseName}</span>
          </div>
        )}

        {/* Info message for draft */}
        {isDraft && (
          <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              الفواتير بحالة المسودة لا تؤثر على المخزون حتى يتم اعتمادها.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
