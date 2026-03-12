import { useQuery } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { PRApprovalHistoryView } from './PRApprovalHistoryView';
import { ScrollArea } from '@/components/ui/scroll-area';

interface PRDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requisition: any;
  statusConfig: Record<string, { label: string; color: string }>;
}

export function PRDetailsDialog({ open, onOpenChange, requisition, statusConfig }: PRDetailsDialogProps) {
  const { data: items = [] } = useQuery({
    queryKey: ['pr-items', requisition?.id],
    enabled: !!requisition?.id && open,
    queryFn: async () => {
      const { data, error } = await dataGateway.queryTable('purchase_requisition_items', {
        select: '*, suppliers(supplier_name), jewelry_items(item_code, description)',
        filters: [{ type: 'eq', column: 'requisition_id', value: requisition.id }],
      });
      if (error) throw error;
      return data;
    },
  });

  if (!requisition) return null;

  const status = statusConfig[requisition.status] || statusConfig.draft;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>تفاصيل طلب الشراء: {requisition.requisition_number}</DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="flex-1">
          <div className="space-y-6 p-1">
            {/* Basic Info */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <Label className="text-muted-foreground text-sm">الحالة</Label>
                <Badge className={status.color}>{status.label}</Badge>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">الفرع</Label>
                <p className="font-medium">{requisition.branches?.branch_name || '-'}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">القسم</Label>
                <p className="font-medium">{requisition.departments?.department_name || '-'}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">تاريخ الطلب</Label>
                <p>{format(new Date(requisition.request_date), 'dd/MM/yyyy', { locale: ar })}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">التاريخ المطلوب</Label>
                <p>{requisition.required_date 
                  ? format(new Date(requisition.required_date), 'dd/MM/yyyy', { locale: ar })
                  : '-'
                }</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">مستوى الموافقة</Label>
                <p>{requisition.current_approval_level || 0} / {requisition.required_approval_level || 1}</p>
              </div>
            </div>

            {/* Justification */}
            {requisition.justification && (
              <div>
                <Label className="text-muted-foreground text-sm">مبررات الطلب</Label>
                <p className="p-3 bg-muted rounded-lg">{requisition.justification}</p>
              </div>
            )}

            {/* Rejection Reason */}
            {requisition.rejection_reason && (
              <div className="p-4 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800">
                <Label className="text-red-600 font-semibold">سبب الرفض</Label>
                <p className="text-red-700 dark:text-red-400 mt-1">{requisition.rejection_reason}</p>
              </div>
            )}

            {/* Items Table */}
            <div>
              <Label className="text-lg font-semibold mb-2 block">البنود المطلوبة</Label>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>كود الصنف</TableHead>
                      <TableHead>الوصف</TableHead>
                      <TableHead>الكمية</TableHead>
                      <TableHead>الوحدة</TableHead>
                      <TableHead>السعر التقديري</TableHead>
                      <TableHead>الإجمالي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-sm">
                          {item.jewelry_items?.item_code || item.item_code || '-'}
                        </TableCell>
                        <TableCell>
                          {item.jewelry_items?.description || item.item_description}
                        </TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell>{item.estimated_unit_price?.toLocaleString()} ر.س</TableCell>
                        <TableCell className="font-medium">
                          {item.estimated_total?.toLocaleString()} ر.س
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="text-left text-lg font-bold mt-4 p-3 bg-muted rounded-lg">
                الإجمالي التقديري: {requisition.total_estimated_amount?.toLocaleString()} ر.س
              </div>
            </div>

            {/* Approval History */}
            <PRApprovalHistoryView requisitionId={requisition.id} />

            {/* Notes */}
            {requisition.notes && (
              <div>
                <Label className="text-muted-foreground text-sm">ملاحظات</Label>
                <p className="p-3 bg-muted rounded-lg">{requisition.notes}</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
