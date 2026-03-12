import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { ArrowRight, ShoppingCart, Loader2, Check } from 'lucide-react';
import { format } from 'date-fns';
import SupplierSelect from '@/components/purchasing/SupplierSelect';
import {
  getPurchaseRequisitionsForConvert,
  getPRItemsForConvert,
  listBranchesDropdown,
  getUserProfileName,
} from '@/domain/purchasing/purchasingReadService';
import { convertPRToPO } from '@/domain/purchasing/purchasingWriteService';
import type { PRForConvertDTO, PRItemForConvertDTO, ConvertPRItemInput } from '@/domain/purchasing/commands';

interface SelectedItem extends PRItemForConvertDTO {
  selected: boolean;
  convertQuantity: number;
  actualPrice: number;
  selectedSupplierId: string;
  manuallySetSupplier: boolean;
}

export default function ConvertPRToPOPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const prIds = id ? [id] : searchParams.get('ids')?.split(',') || [];

  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>('');
  const [paymentTerms, setPaymentTerms] = useState<string>('');
  const [deliveryTerms, setDeliveryTerms] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Fetch PRs via service
  const { data: requisitions, isLoading: loadingPRs } = useQuery({
    queryKey: ['convert-prs', prIds],
    enabled: prIds.length > 0,
    queryFn: () => getPurchaseRequisitionsForConvert(prIds),
  });

  // Fetch PR items via service
  const { data: prItems, isLoading: loadingItems } = useQuery({
    queryKey: ['convert-pr-items', prIds],
    enabled: prIds.length > 0,
    queryFn: () => getPRItemsForConvert(prIds),
  });

  // Fetch branches via service
  const { data: branches } = useQuery({
    queryKey: ['branches-dropdown'],
    queryFn: listBranchesDropdown,
  });

  // Get user profile via service
  const { data: userProfile } = useQuery({
    queryKey: ['user-profile-name', user?.id],
    enabled: !!user?.id,
    queryFn: () => getUserProfileName(user!.id),
  });

  // Initialize selected items when PR items are loaded
  useEffect(() => {
    if (prItems) {
      setSelectedItems(
        prItems.map((item) => ({
          ...item,
          selected: true,
          convertQuantity: Math.max(0, item.remainingQuantity),
          actualPrice: item.estimatedPrice || 0,
          selectedSupplierId: '',
          manuallySetSupplier: false,
        }))
      );
    }
  }, [prItems]);

  const toggleItem = (itemId: string) => {
    setSelectedItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const updateItemQuantity = (itemId: string, quantity: number) => {
    setSelectedItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, convertQuantity: Math.min(quantity, item.remainingQuantity) }
          : item
      )
    );
  };

  const updateItemPrice = (itemId: string, price: number) => {
    setSelectedItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, actualPrice: price } : item
      )
    );
  };

  const updateItemSupplier = (itemId: string, supplierId: string, manual = false) => {
    setSelectedItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, selectedSupplierId: supplierId, manuallySetSupplier: manual } : item
      )
    );
  };

  // Handle default supplier change
  const handleDefaultSupplierChange = (supplierId: string) => {
    setSelectedSupplierId(supplierId);
    // Update items that don't have a manually set supplier
    setSelectedItems((prev) =>
      prev.map((item) => ({
        ...item,
        selectedSupplierId: item.manuallySetSupplier ? item.selectedSupplierId : supplierId,
      }))
    );
  };

  const selectAll = () => {
    setSelectedItems((prev) => prev.map((item) => ({ ...item, selected: true })));
  };

  const deselectAll = () => {
    setSelectedItems((prev) => prev.map((item) => ({ ...item, selected: false })));
  };

  // Create PO mutation via service
  const createPOMutation = useMutation({
    mutationFn: async () => {
      const itemsToConvert = selectedItems.filter((item) => item.selected && item.convertQuantity > 0);
      
      if (itemsToConvert.length === 0) {
        throw new Error('الرجاء تحديد بند واحد على الأقل');
      }

      const firstReq = requisitions?.[0];
      
      // Build command items
      const commandItems: ConvertPRItemInput[] = itemsToConvert.map(item => ({
        prItemId: item.id,
        requisitionId: item.requisitionId,
        convertQuantity: item.convertQuantity,
        actualPrice: item.actualPrice,
        supplierId: item.selectedSupplierId || null,
        description: item.description || '',
        warehouseId: null, // Not available in DTO, handled by service
        costCenterId: null, // Not available in DTO, handled by service
      }));

      const result = await convertPRToPO({
        clientRequestId: crypto.randomUUID(),
        prIds,
        targetBranchId: firstReq?.branchId || '',
        warehouseId: null,
        defaultSupplierId: selectedSupplierId || null,
        expectedDeliveryDate: expectedDeliveryDate || null,
        paymentTerms: paymentTerms || null,
        deliveryTerms: deliveryTerms || null,
        notes: notes || undefined,
        createdByUserId: user?.id || '',
        createdByName: userProfile?.fullName || user?.email || null,
        items: commandItems,
      });

      if (!result.success) {
        throw new Error(result.error || 'فشل في إنشاء أمر الشراء');
      }

      return result.createdPOs || [];
    },
    onSuccess: (data) => {
      toast.success(`تم إنشاء ${data.length} أمر/أوامر شراء بنجاح`);
      queryClient.invalidateQueries({ queryKey: ['purchase-requisitions'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      
      if (data.length === 1) {
        navigate(`/purchasing/orders/${data[0].poId}`);
      } else {
        navigate('/purchasing/orders');
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل في إنشاء أمر الشراء');
    },
  });

  const selectedItemsCount = selectedItems.filter((i) => i.selected && i.convertQuantity > 0).length;
  const totalAmount = selectedItems
    .filter((i) => i.selected)
    .reduce((sum, i) => sum + i.convertQuantity * i.actualPrice, 0);

  const isLoading = loadingPRs || loadingItems;

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  if (!requisitions || requisitions.length === 0) {
    return (
      <MainLayout>
        <div className="container mx-auto p-6">
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">لا توجد طلبات شراء معتمدة للتحويل</p>
              <Button onClick={() => navigate('/purchasing/requisitions')} className="mt-4">
                العودة لطلبات الشراء
              </Button>
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/purchasing/requisitions')}>
            <ArrowRight className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShoppingCart className="h-6 w-6 text-primary" />
              تحويل طلب الشراء إلى أمر شراء
            </h1>
            <p className="text-muted-foreground">
              {requisitions.map((r) => r.prNumber).join(', ')}
            </p>
          </div>
        </div>

        {/* PR Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">معلومات طلب/طلبات الشراء</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {requisitions.map((req) => (
                <div key={req.id} className="space-y-2 p-3 bg-muted/50 rounded-lg">
                  <div className="font-medium">{req.prNumber}</div>
                  <div className="text-sm text-muted-foreground">
                    {req.branchName}
                  </div>
                  <div className="text-sm">
                    تاريخ الإنشاء: {format(new Date(req.createdAt), 'yyyy-MM-dd')}
                  </div>
                  <Badge variant={req.status === 'approved' ? 'default' : 'secondary'}>
                    {req.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* PO Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">إعدادات أمر الشراء</CardTitle>
            <CardDescription>حدد المورد وشروط التوريد (اختياري - يمكن تحديد مورد مختلف لكل بند)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>المورد الافتراضي</Label>
                <SupplierSelect
                  value={selectedSupplierId}
                  onSelect={handleDefaultSupplierChange}
                  placeholder="اختر المورد"
                />
              </div>
              <div>
                <Label>تاريخ التسليم المتوقع</Label>
                <Input
                  type="date"
                  value={expectedDeliveryDate}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                />
              </div>
              <div>
                <Label>شروط الدفع</Label>
                <Input
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  placeholder="مثال: 30 يوم من تاريخ الفاتورة"
                />
              </div>
              <div>
                <Label>شروط التسليم</Label>
                <Input
                  value={deliveryTerms}
                  onChange={(e) => setDeliveryTerms(e.target.value)}
                  placeholder="مثال: تسليم في الموقع"
                />
              </div>
              <div className="md:col-span-2">
                <Label>ملاحظات</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات إضافية لأمر الشراء..."
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Items Selection */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">اختيار البنود للتحويل</CardTitle>
              <CardDescription>
                حدد البنود والكميات المراد تحويلها إلى أمر الشراء
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={selectAll}>
                تحديد الكل
              </Button>
              <Button variant="outline" size="sm" onClick={deselectAll}>
                إلغاء التحديد
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead>الكمية المطلوبة</TableHead>
                  <TableHead>تم تحويلها</TableHead>
                  <TableHead>كمية التحويل</TableHead>
                  <TableHead>السعر التقديري</TableHead>
                  <TableHead>السعر الفعلي</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>الإجمالي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedItems.map((item) => {
                  const isFullyConverted = item.remainingQuantity <= 0;

                  return (
                    <TableRow key={item.id} className={isFullyConverted ? 'opacity-50' : ''}>
                      <TableCell>
                        <Checkbox
                          checked={item.selected && !isFullyConverted}
                          onCheckedChange={() => !isFullyConverted && toggleItem(item.id)}
                          disabled={isFullyConverted}
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{item.description}</div>
                          {item.productCode && (
                            <div className="text-xs text-muted-foreground">{item.productCode}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{item.quantity} وحدة</TableCell>
                      <TableCell>
                        {item.convertedQuantity > 0 ? (
                          <Badge variant="secondary">{item.convertedQuantity}</Badge>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={item.remainingQuantity}
                          value={item.convertQuantity}
                          onChange={(e) => updateItemQuantity(item.id, Number(e.target.value))}
                          className="w-20"
                          disabled={isFullyConverted || !item.selected}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {(item.estimatedPrice || 0).toLocaleString()} ر.س
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.actualPrice}
                          onChange={(e) => updateItemPrice(item.id, Number(e.target.value))}
                          className="w-24"
                          disabled={isFullyConverted || !item.selected}
                        />
                      </TableCell>
                      <TableCell>
                        <SupplierSelect
                          value={item.selectedSupplierId}
                          onSelect={(v) => updateItemSupplier(item.id, v, true)}
                          disabled={isFullyConverted || !item.selected}
                          placeholder="اختر"
                          compact={true}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {(item.convertQuantity * item.actualPrice).toLocaleString()} ر.س
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Summary & Actions */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex gap-6">
                <div>
                  <div className="text-sm text-muted-foreground">البنود المحددة</div>
                  <div className="text-2xl font-bold">{selectedItemsCount}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">إجمالي القيمة</div>
                  <div className="text-2xl font-bold text-primary">
                    {totalAmount.toLocaleString()} ر.س
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => navigate('/purchasing/requisitions')}>
                  إلغاء
                </Button>
                <Button
                  onClick={() => createPOMutation.mutate()}
                  disabled={selectedItemsCount === 0 || createPOMutation.isPending}
                  className="gap-2"
                >
                  {createPOMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  إنشاء أمر الشراء
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
