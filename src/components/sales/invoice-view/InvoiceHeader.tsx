import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { 
  FileText, 
  Calendar, 
  Building2, 
  User, 
  Clock,
  Hash
} from 'lucide-react';

interface InvoiceHeaderProps {
  invoiceNumber: string;
  invoiceType: string;
  status: string;
  invoiceDate: Date;
  dueDate: Date;
  branchName?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  referenceNumber?: string;
  saleId?: string;
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'مسودة', variant: 'secondary' },
  pending: { label: 'غير مدفوعة', variant: 'outline' },
  partial: { label: 'مدفوعة جزئياً', variant: 'default' },
  paid: { label: 'مدفوعة', variant: 'default' },
  cancelled: { label: 'ملغاة', variant: 'destructive' },
  approved: { label: 'معتمدة', variant: 'default' },
};

const typeConfig: Record<string, { label: string; color: string }> = {
  sales: { label: 'فاتورة مبيعات', color: 'bg-blue-500' },
  purchase: { label: 'فاتورة مشتريات', color: 'bg-green-500' },
  sales_return: { label: 'مرتجع مبيعات', color: 'bg-orange-500' },
  purchase_return: { label: 'مرتجع مشتريات', color: 'bg-red-500' },
};

export default function InvoiceHeader({
  invoiceNumber,
  invoiceType,
  status,
  invoiceDate,
  dueDate,
  branchName,
  createdBy,
  createdAt,
  updatedAt,
  referenceNumber,
  saleId,
}: InvoiceHeaderProps) {
  const statusInfo = statusConfig[status] || { label: status, variant: 'outline' as const };
  const typeInfo = typeConfig[invoiceType] || { label: invoiceType, color: 'bg-gray-500' };

  return (
    <Card className="border-2 border-primary/20">
      <CardContent className="pt-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Section - Invoice Identity */}
          <div className="space-y-4">
            {/* Invoice Number - Prominent */}
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <FileText className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">رقم الفاتورة</p>
                <p className="text-xl font-bold font-mono tracking-wide">{invoiceNumber}</p>
              </div>
            </div>

            {/* Type and Status Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={`${typeInfo.color} text-white`}>
                {typeInfo.label}
              </Badge>
              <Badge variant={statusInfo.variant}>
                {statusInfo.label}
              </Badge>
              {saleId && (
                <Badge variant="outline" className="text-xs">
                  POS
                </Badge>
              )}
            </div>

            {/* Reference Number */}
            {referenceNumber && (
              <div className="flex items-center gap-2 text-sm">
                <Hash className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">المرجع:</span>
                <span className="font-mono">{referenceNumber}</span>
              </div>
            )}
          </div>

          {/* Right Section - Dates & Meta */}
          <div className="space-y-3 text-sm">
            {/* Invoice Date */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">تاريخ الفاتورة:</span>
              </div>
              <span className="font-medium">
                {format(invoiceDate, 'dd MMMM yyyy', { locale: ar })}
              </span>
            </div>

            {/* Due Date */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">تاريخ الاستحقاق:</span>
              </div>
              <span className="font-medium">
                {format(dueDate, 'dd MMMM yyyy', { locale: ar })}
              </span>
            </div>

            {/* Branch */}
            {branchName && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">الفرع:</span>
                </div>
                <span className="font-medium">{branchName}</span>
              </div>
            )}

            {/* Created By */}
            {createdBy && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">أنشئت بواسطة:</span>
                </div>
                <span className="font-medium">{createdBy}</span>
              </div>
            )}

            {/* Timestamps */}
            {createdAt && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  <span>تاريخ الإنشاء:</span>
                </div>
                <span>{format(new Date(createdAt), 'dd/MM/yyyy HH:mm')}</span>
              </div>
            )}
            {updatedAt && updatedAt !== createdAt && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  <span>آخر تعديل:</span>
                </div>
                <span>{format(new Date(updatedAt), 'dd/MM/yyyy HH:mm')}</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
