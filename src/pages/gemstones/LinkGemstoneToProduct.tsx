import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  Search,
  Gem,
  Link2,
  Unlink,
  Package,
  ArrowLeft,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface JewelryItem {
  id: string;
  serial_no: string;
  description: string | null;
  metal: string | null;
  g_weight: number | null;
  cost: number | null;
  gemstone_cost: number | null;
  sale_id: string | null;
}

interface LinkedGemstone {
  id: string;
  gemstone_id: string;
  setting_type: string | null;
  setting_cost: number | null;
  gemstone_inventory: {
    stone_code: string;
    carat_weight: number;
    purchase_price: number;
    gemstone_types: {
      type_name: string;
    };
  };
}

interface AvailableGemstone {
  id: string;
  stone_code: string;
  carat_weight: number;
  purchase_price: number;
  color: string | null;
  clarity: string | null;
  gemstone_types: {
    type_name: string;
  };
}

const SETTING_TYPES = [
  { value: 'prong', label: 'تثبيت بالأسنان (Prong)' },
  { value: 'bezel', label: 'تثبيت بالإطار (Bezel)' },
  { value: 'channel', label: 'تثبيت قناة (Channel)' },
  { value: 'pave', label: 'تثبيت مرصوف (Pavé)' },
  { value: 'tension', label: 'تثبيت بالضغط (Tension)' },
  { value: 'flush', label: 'تثبيت مستوي (Flush)' },
];

export default function LinkGemstoneToProduct() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<JewelryItem | null>(null);
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [selectedGemstoneId, setSelectedGemstoneId] = useState('');
  const [settingType, setSettingType] = useState('');
  const [settingCost, setSettingCost] = useState(0);

  const { data: jewelryItems = [], isLoading: loadingItems } = useQuery({
    queryKey: ['jewelry-items-for-linking'],
    queryFn: async () => {
      const res = await fetch('/api/available-unique-items', { credentials: 'include' });
      if (res.status === 501) {
        toast.info('هذه الخدمة غير متاحة حالياً');
        return [];
      }
      if (!res.ok) throw new Error('Failed to fetch jewelry items');
      return (await res.json()) as JewelryItem[];
    },
  });

  const { data: linkedGemstones = [], isLoading: loadingLinked } = useQuery({
    queryKey: ['linked-gemstones', selectedItem?.id],
    queryFn: async () => {
      if (!selectedItem) return [];
      const res = await fetch(`/api/item-linked-gemstones/${selectedItem.id}`, { credentials: 'include' });
      if (res.status === 501) {
        return [];
      }
      if (!res.ok) throw new Error('Failed to fetch linked gemstones');
      return (await res.json()) as LinkedGemstone[];
    },
    enabled: !!selectedItem,
  });

  const { data: availableGemstones = [] } = useQuery({
    queryKey: ['available-gemstones'],
    queryFn: async () => {
      const res = await fetch('/api/available-gemstones-for-linking', { credentials: 'include' });
      if (res.status === 501) {
        return [];
      }
      if (!res.ok) throw new Error('Failed to fetch available gemstones');
      return (await res.json()) as AvailableGemstone[];
    },
  });

  const linkMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem || !selectedGemstoneId) throw new Error('بيانات غير مكتملة');

      forbidDirectWrite('insert', 'LinkGemstoneToProduct.tsx:linkMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linked-gemstones'] });
      queryClient.invalidateQueries({ queryKey: ['available-gemstones'] });
      queryClient.invalidateQueries({ queryKey: ['jewelry-items-for-linking'] });
      toast.success('تم ربط الحجر بالمنتج بنجاح');
      setIsLinkDialogOpen(false);
      setSelectedGemstoneId('');
      setSettingType('');
      setSettingCost(0);
    },
    onError: (error) => {
      toast.error('فشل في ربط الحجر: ' + error.message);
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      const link = linkedGemstones.find((l) => l.id === linkId);
      if (!link) throw new Error('الرابط غير موجود');

      forbidDirectWrite('delete', 'LinkGemstoneToProduct.tsx:unlinkMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linked-gemstones'] });
      queryClient.invalidateQueries({ queryKey: ['available-gemstones'] });
      queryClient.invalidateQueries({ queryKey: ['jewelry-items-for-linking'] });
      toast.success('تم فك ربط الحجر بنجاح');
    },
    onError: (error) => {
      toast.error('فشل في فك الربط: ' + error.message);
    },
  });

  const filteredItems = jewelryItems.filter(
    (item) =>
      item.serial_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const calculateTotalCost = () => {
    if (!selectedItem) return 0;
    const baseCost = selectedItem.cost || 0;
    const gemstoneCost = linkedGemstones.reduce(
      (sum, link) =>
        sum + link.gemstone_inventory.purchase_price + (link.setting_cost || 0),
      0
    );
    return baseCost + gemstoneCost;
  };

  return (
    <MainLayout>
      <div className="p-6 space-y-6" dir="rtl">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">ربط الأحجار بالمنتجات</h1>
              <p className="text-muted-foreground">إضافة الأحجار الكريمة للمجوهرات</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Products List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                المنتجات
              </CardTitle>
              <CardDescription>اختر منتج لربط الأحجار به</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="بحث بالكود أو الوصف..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pr-10"
                />
              </div>
              <div className="max-h-[500px] overflow-y-auto space-y-2">
                {loadingItems ? (
                  <p className="text-center py-4 text-muted-foreground">جاري التحميل...</p>
                ) : filteredItems.length === 0 ? (
                  <p className="text-center py-4 text-muted-foreground">لا توجد منتجات</p>
                ) : (
                  filteredItems.map((item) => (
                    <div
                      key={item.id}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedItem?.id === item.id
                          ? 'border-primary bg-primary/5'
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setSelectedItem(item)}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-mono font-medium">{item.serial_no}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.description || 'بدون وصف'}
                          </p>
                        </div>
                        <div className="text-left text-sm">
                          <p>{item.metal}</p>
                          <p className="text-muted-foreground">{item.g_weight} جم</p>
                        </div>
                      </div>
                      {item.gemstone_cost ? (
                        <Badge variant="secondary" className="mt-2">
                          <Gem className="h-3 w-3 ml-1" />
                          تكلفة الأحجار: {item.gemstone_cost.toLocaleString()} ر.س
                        </Badge>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Linked Gemstones */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Gem className="h-5 w-5" />
                    الأحجار المرتبطة
                  </CardTitle>
                  <CardDescription>
                    {selectedItem
                      ? `المنتج: ${selectedItem.serial_no}`
                      : 'اختر منتج من القائمة'}
                  </CardDescription>
                </div>
                {selectedItem && (
                  <Button onClick={() => setIsLinkDialogOpen(true)}>
                    <Link2 className="h-4 w-4 ml-2" />
                    ربط حجر
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!selectedItem ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Gem className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>اختر منتج لعرض الأحجار المرتبطة</p>
                </div>
              ) : loadingLinked ? (
                <p className="text-center py-8 text-muted-foreground">جاري التحميل...</p>
              ) : linkedGemstones.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>لا توجد أحجار مرتبطة بهذا المنتج</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الحجر</TableHead>
                        <TableHead>القيراط</TableHead>
                        <TableHead>التثبيت</TableHead>
                        <TableHead>التكلفة</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linkedGemstones.map((link) => (
                        <TableRow key={link.id}>
                          <TableCell>
                            <div>
                              <p className="font-mono text-sm">
                                {link.gemstone_inventory.stone_code}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {link.gemstone_inventory.gemstone_types.type_name}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>{link.gemstone_inventory.carat_weight}</TableCell>
                          <TableCell>
                            {SETTING_TYPES.find((s) => s.value === link.setting_type)?.label ||
                              '-'}
                          </TableCell>
                          <TableCell>
                            {(
                              link.gemstone_inventory.purchase_price + (link.setting_cost || 0)
                            ).toLocaleString()}{' '}
                            ر.س
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => unlinkMutation.mutate(link.id)}
                              disabled={unlinkMutation.isPending}
                            >
                              <Unlink className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* Cost Summary */}
                  <div className="border-t pt-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>تكلفة المنتج الأساسية:</span>
                      <span>{(selectedItem.cost || 0).toLocaleString()} ر.س</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>تكلفة الأحجار والتثبيت:</span>
                      <span>
                        {linkedGemstones
                          .reduce(
                            (sum, l) =>
                              sum + l.gemstone_inventory.purchase_price + (l.setting_cost || 0),
                            0
                          )
                          .toLocaleString()}{' '}
                        ر.س
                      </span>
                    </div>
                    <div className="flex justify-between font-bold border-t pt-2">
                      <span>التكلفة الإجمالية:</span>
                      <span>{calculateTotalCost().toLocaleString()} ر.س</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Link Gemstone Dialog */}
        <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>ربط حجر بالمنتج</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>اختر الحجر</Label>
                <Select value={selectedGemstoneId} onValueChange={setSelectedGemstoneId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر حجر متاح" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableGemstones.map((gem) => (
                      <SelectItem key={gem.id} value={gem.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{gem.stone_code}</span>
                          <span className="text-muted-foreground">-</span>
                          <span>{gem.gemstone_types.type_name}</span>
                          <span className="text-muted-foreground">
                            ({gem.carat_weight} قيراط)
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>نوع التثبيت</Label>
                <Select value={settingType} onValueChange={setSettingType}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر نوع التثبيت" />
                  </SelectTrigger>
                  <SelectContent>
                    {SETTING_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>تكلفة التثبيت (ر.س)</Label>
                <Input
                  type="number"
                  value={settingCost}
                  onChange={(e) => setSettingCost(parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setIsLinkDialogOpen(false)}>
                  إلغاء
                </Button>
                <Button
                  onClick={() => linkMutation.mutate()}
                  disabled={!selectedGemstoneId || linkMutation.isPending}
                >
                  {linkMutation.isPending ? 'جاري الربط...' : 'ربط الحجر'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
