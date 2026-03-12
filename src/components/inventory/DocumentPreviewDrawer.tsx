import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetDescription 
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  ExternalLink, 
  FileText, 
  User, 
  Building2, 
  Calendar,
  Package,
  DollarSign,
  Receipt
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { 
  useDocumentDetails, 
  getDocumentRoute, 
  type ReferenceType,
  type DocumentSummary 
} from '@/hooks/useItemMovements';

interface DocumentPreviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  referenceType: ReferenceType | null;
  referenceId: string | null;
}

const typeLabels: Record<string, { ar: string; en: string }> = {
  sale: { ar: 'فاتورة مبيعات', en: 'Sales Invoice' },
  return: { ar: 'مرتجع', en: 'Return' },
  transfer: { ar: 'نقل', en: 'Transfer' },
  purchase_invoice: { ar: 'فاتورة مشتريات', en: 'Purchase Invoice' },
  batch: { ar: 'دفعة استيراد', en: 'Import Batch' },
};

const statusLabels: Record<string, { ar: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  paid: { ar: 'مدفوع', variant: 'default' },
  pending: { ar: 'معلق', variant: 'outline' },
  partial: { ar: 'جزئي', variant: 'secondary' },
  completed: { ar: 'مكتمل', variant: 'default' },
  draft: { ar: 'مسودة', variant: 'outline' },
  posted: { ar: 'مرحّل', variant: 'default' },
  cancelled: { ar: 'ملغي', variant: 'destructive' },
  approved: { ar: 'معتمد', variant: 'default' },
};

export function DocumentPreviewDrawer({
  open,
  onOpenChange,
  referenceType,
  referenceId,
}: DocumentPreviewDrawerProps) {
  const navigate = useNavigate();
  const { data: document, isLoading, error } = useDocumentDetails(referenceType, referenceId);

  const handleOpenDocument = () => {
    const route = getDocumentRoute(referenceType, referenceId);
    if (route) {
      onOpenChange(false);
      navigate(route);
    }
  };

  const getStatusBadge = (status?: string) => {
    if (!status) return null;
    const config = statusLabels[status] || { ar: status, variant: 'outline' as const };
    return <Badge variant={config.variant}>{config.ar}</Badge>;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="text-right">
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            معاينة المستند
          </SheetTitle>
          <SheetDescription>
            تفاصيل مختصرة للمستند المرتبط بالحركة
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {isLoading ? (
            <LoadingSkeleton />
          ) : error ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>تعذر تحميل تفاصيل المستند</p>
              <Button 
                variant="outline" 
                className="mt-4"
                onClick={handleOpenDocument}
              >
                <ExternalLink className="h-4 w-4 ml-2" />
                فتح المستند
              </Button>
            </div>
          ) : !document ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>لا تتوفر معاينة لهذا المستند</p>
              {referenceId && (
                <Button 
                  variant="outline" 
                  className="mt-4"
                  onClick={handleOpenDocument}
                >
                  <ExternalLink className="h-4 w-4 ml-2" />
                  فتح المستند
                </Button>
              )}
            </div>
          ) : (
            <DocumentContent 
              document={document} 
              onOpenDocument={handleOpenDocument}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
      <Separator />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <Separator />
      <Skeleton className="h-24" />
    </div>
  );
}

interface DocumentContentProps {
  document: DocumentSummary;
  onOpenDocument: () => void;
}

function DocumentContent({ document, onOpenDocument }: DocumentContentProps) {
  const typeLabel = typeLabels[document.type]?.ar || document.type;
  
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{typeLabel}</p>
          <p className="text-xl font-bold font-mono">{document.code}</p>
        </div>
        {document.status && (
          <Badge variant={statusLabels[document.status]?.variant || 'outline'}>
            {statusLabels[document.status]?.ar || document.status}
          </Badge>
        )}
      </div>

      <Separator />

      {/* Key Info Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Date */}
        <div className="flex items-start gap-2">
          <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">التاريخ</p>
            <p className="text-sm font-medium">
              {format(new Date(document.date), 'yyyy/MM/dd', { locale: ar })}
            </p>
          </div>
        </div>

        {/* Branch */}
        {document.branch_name && (
          <div className="flex items-start gap-2">
            <Building2 className="h-4 w-4 mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">الفرع</p>
              <p className="text-sm font-medium">{document.branch_name}</p>
            </div>
          </div>
        )}

        {/* Party (Customer/Supplier) */}
        {document.party_name && (
          <div className="flex items-start gap-2">
            <User className="h-4 w-4 mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">
                {document.party_type === 'customer' ? 'العميل' : 'المورد'}
              </p>
              <p className="text-sm font-medium">{document.party_name}</p>
            </div>
          </div>
        )}

        {/* Items Count */}
        {document.items_count !== undefined && (
          <div className="flex items-start gap-2">
            <Package className="h-4 w-4 mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">عدد القطع</p>
              <p className="text-sm font-medium">{document.items_count}</p>
            </div>
          </div>
        )}
      </div>

      {/* Amounts */}
      {(document.total_amount !== undefined || document.tax_amount !== undefined) && (
        <>
          <Separator />
          <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
            {document.tax_amount !== undefined && document.tax_amount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">الضريبة</span>
                <span>{formatCurrency(document.tax_amount)}</span>
              </div>
            )}
            {document.total_amount !== undefined && (
              <div className="flex justify-between text-lg font-bold">
                <span>الإجمالي</span>
                <span className="text-primary">{formatCurrency(document.total_amount)}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Top Items Preview */}
      {document.top_items && document.top_items.length > 0 && (
        <>
          <Separator />
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                البنود
              </h4>
              {document.items_count && document.items_count > 5 && (
                <span className="text-xs text-muted-foreground">
                  (أول 5 من {document.items_count})
                </span>
              )}
            </div>
            <div className="space-y-2">
              {document.top_items.map((item, index) => (
                <div 
                  key={index} 
                  className="flex justify-between items-center p-2 bg-muted/30 rounded text-sm"
                >
                  <span className="truncate flex-1">{item.description}</span>
                  {item.price > 0 && (
                    <span className="font-medium mr-2">{formatCurrency(item.price)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Actions */}
      <div className="pt-4">
        <Button onClick={onOpenDocument} className="w-full">
          <ExternalLink className="h-4 w-4 ml-2" />
          فتح المستند الكامل
        </Button>
      </div>
    </>
  );
}

export default DocumentPreviewDrawer;
