import { useState } from 'react';
import * as dataGateway from '@/lib/dataGateway';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Building2, 
  Phone, 
  Mail, 
  Globe, 
  MapPin,
  FileText,
  CreditCard,
  User,
  Calendar,
  Hash,
  Wallet,
  Package,
  Edit,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { 
  Supplier,
  supplierTypeLabels,
  businessTypeLabels,
  paymentTermsLabels,
  paymentMethodLabels,
  statusLabels,
} from '@/types/supplier.types';
import { useQuery } from '@tanstack/react-query';
import { SupplierDocuments } from './SupplierDocuments';

interface SupplierViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: Supplier | null;
  onEdit?: () => void;
}

export function SupplierViewDialog({ open, onOpenChange, supplier, onEdit }: SupplierViewDialogProps) {
  const [activeTab, setActiveTab] = useState('info');

  // Fetch supplier items
  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['supplier-items', supplier?.id],
    queryFn: async () => {
      if (!supplier?.id) return [];
      const { data } = await dataGateway.queryTable('unique_items', {
        select: 'id, item_code, description, g_weight, tag_price, sale_status',
        filters: [{ type: 'eq', column: 'supplier_id', value: supplier.id }],
        order: { column: 'created_at', ascending: false },
        limit: 50,
      });
      return data || [];
    },
    enabled: !!supplier?.id && activeTab === 'items',
  });

  // Fetch supplier transactions (purchase invoices)
  const { data: transactions = [], isLoading: transactionsLoading } = useQuery({
    queryKey: ['supplier-transactions', supplier?.id],
    queryFn: async (): Promise<any[]> => {
      if (!supplier?.id) return [];
      const { data, error } = await dataGateway.queryTable('purchase_batches', {
        select: 'id, batch_number, total_amount, created_at, status',
        filters: [{ type: 'eq', column: 'supplier_id', value: supplier.id }],
        order: { column: 'created_at', ascending: false },
        limit: 20,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!supplier?.id && activeTab === 'transactions',
  });

  if (!supplier) return null;

  const statusColor = {
    active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
    suspended: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    archived: 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400',
  };

  const InfoRow = ({ label, value, icon: Icon }: { label: string; value?: string | number | null; icon?: any }) => (
    <div className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
      {Icon && <Icon className="w-4 h-4 text-muted-foreground mt-0.5" />}
      <div className="flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium">{value || '-'}</p>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              {supplier.supplier_name}
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Badge className={statusColor[supplier.status]}>
                {statusLabels[supplier.status]}
              </Badge>
              {onEdit && (
                <Button variant="outline" size="sm" onClick={onEdit}>
                  <Edit className="w-4 h-4 ml-1" />
                  تعديل
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-120px)]">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-5 mb-4">
              <TabsTrigger value="info">البيانات</TabsTrigger>
              <TabsTrigger value="financial">المالية</TabsTrigger>
              <TabsTrigger value="documents">المستندات</TabsTrigger>
              <TabsTrigger value="items">القطع</TabsTrigger>
              <TabsTrigger value="transactions">الحركات</TabsTrigger>
            </TabsList>

            <TabsContent value="info">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">البيانات الأساسية</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-0">
                    <InfoRow label="كود المورد" value={supplier.supplier_code} icon={Hash} />
                    <InfoRow label="فئة المورد" value={supplierTypeLabels[supplier.supplier_type]} icon={Building2} />
                    <InfoRow label="نوع المورد" value={businessTypeLabels[supplier.business_type]} icon={Package} />
                    <InfoRow label="النشاط التجاري" value={supplier.business_activity} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">معلومات الاتصال</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-0">
                    <InfoRow label="الهاتف المحمول" value={supplier.mobile_phone} icon={Phone} />
                    <InfoRow label="هاتف المكتب" value={supplier.office_phone} icon={Phone} />
                    <InfoRow label="البريد الإلكتروني" value={supplier.email} icon={Mail} />
                    <InfoRow label="الموقع الإلكتروني" value={supplier.website} icon={Globe} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">العنوان</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-0">
                    <InfoRow label="الدولة" value={supplier.country} icon={MapPin} />
                    <InfoRow label="المدينة" value={supplier.city} />
                    <InfoRow label="العنوان" value={supplier.address} />
                    <InfoRow label="العنوان التفصيلي" value={supplier.detailed_address} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">البيانات الرسمية</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-0">
                    <InfoRow label="الرقم الضريبي" value={supplier.vat_number} icon={FileText} />
                    <InfoRow label="السجل التجاري" value={supplier.commercial_register} />
                    <InfoRow label="رقم الهوية" value={supplier.national_id} icon={User} />
                    <InfoRow 
                      label="تاريخ انتهاء الترخيص" 
                      value={supplier.license_expiry_date ? format(new Date(supplier.license_expiry_date), 'dd/MM/yyyy') : null} 
                      icon={Calendar} 
                    />
                  </CardContent>
                </Card>

                {supplier.contact_person && (
                  <Card className="md:col-span-2">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">شخص الاتصال</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{supplier.contact_person}</p>
                          <p className="text-sm text-muted-foreground">{supplier.contact_position || 'غير محدد'}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            <TabsContent value="financial">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                        <Wallet className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">الرصيد الحالي</p>
                        <p className={`text-lg font-bold ${supplier.current_balance > 0 ? 'text-red-600' : supplier.current_balance < 0 ? 'text-emerald-600' : ''}`}>
                          {supplier.current_balance?.toLocaleString('ar-SA')} ر.س
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                        <CreditCard className="w-5 h-5 text-amber-600" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">الحد الائتماني</p>
                        <p className="text-lg font-bold">{supplier.credit_limit?.toLocaleString('ar-SA')} ر.س</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-900/30 flex items-center justify-center">
                        <Wallet className="w-5 h-5 text-slate-600" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">الرصيد الافتتاحي</p>
                        <p className="text-lg font-bold">{supplier.opening_balance?.toLocaleString('ar-SA')} ر.س</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">إعدادات الدفع</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <InfoRow label="العملة الافتراضية" value={supplier.default_currency} />
                    <InfoRow label="شروط الدفع" value={paymentTermsLabels[supplier.payment_terms]} />
                    <InfoRow label="طريقة الدفع الافتراضية" value={paymentMethodLabels[supplier.default_payment_method]} />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents">
              <SupplierDocuments supplierId={supplier.id} supplierName={supplier.supplier_name} />
            </TabsContent>

            <TabsContent value="items">
              <Card>
                <CardContent className="p-0">
                  {itemsLoading ? (
                    <div className="p-8 text-center">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                    </div>
                  ) : items.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <Package className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>لا توجد قطع مرتبطة بهذا المورد</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>كود القطعة</TableHead>
                          <TableHead>اسم القطعة</TableHead>
                          <TableHead>الوزن</TableHead>
                          <TableHead>السعر</TableHead>
                          <TableHead>الحالة</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item: any) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-mono">{item.item_code}</TableCell>
                            <TableCell>{item.description}</TableCell>
                            <TableCell>{item.g_weight?.toFixed(2)} جم</TableCell>
                            <TableCell>{item.tag_price?.toLocaleString('ar-SA')} ر.س</TableCell>
                            <TableCell>
                              <Badge variant={item.sale_status === 'available' ? 'default' : 'secondary'}>
                                {item.sale_status === 'available' ? 'متاح' : item.sale_status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="transactions">
              <Card>
                <CardContent className="p-0">
                  {transactionsLoading ? (
                    <div className="p-8 text-center">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                    </div>
                  ) : transactions.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>لا توجد حركات مالية لهذا المورد</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>رقم الدفعة</TableHead>
                          <TableHead>التاريخ</TableHead>
                          <TableHead>المبلغ</TableHead>
                          <TableHead>الحالة</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {transactions.map((tx: any) => (
                          <TableRow key={tx.id}>
                            <TableCell className="font-mono">{tx.batch_number}</TableCell>
                            <TableCell>
                              {format(new Date(tx.created_at), 'dd/MM/yyyy', { locale: ar })}
                            </TableCell>
                            <TableCell>{tx.total_amount?.toLocaleString('ar-SA')} ر.س</TableCell>
                            <TableCell>
                              <Badge variant={tx.status === 'completed' ? 'default' : 'secondary'}>
                                {tx.status === 'completed' ? 'مكتمل' : tx.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
