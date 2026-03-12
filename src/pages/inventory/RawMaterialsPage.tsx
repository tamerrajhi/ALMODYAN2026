import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import {
  Plus,
  Package,
  ArrowDownCircle,
  ArrowUpCircle,
  Loader2,
  Search,
  RefreshCw,
  Box,
  AlertTriangle,
} from 'lucide-react';
import { logAudit } from '@/lib/audit';
import { createRawMaterialsPurchaseJournalEntry, createRawMaterialsConsumptionJournalEntry } from '@/lib/accounting';

interface RawMaterial {
  id: string;
  material_code: string;
  material_name: string;
  material_name_en: string | null;
  category: string;
  unit: string;
  minimum_stock: number;
  is_active: boolean;
  description: string | null;
}

interface RawMaterialStock {
  id: string;
  material_id: string;
  branch_id: string | null;
  quantity: number;
  average_cost: number;
  last_purchase_price: number;
  branches?: { branch_name: string } | null;
  raw_materials?: RawMaterial | null;
}

interface RawMaterialTransaction {
  id: string;
  material_id: string;
  branch_id: string | null;
  transaction_type: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  reference_type: string | null;
  supplier_id: string | null;
  performed_by: string | null;
  notes: string | null;
  transaction_date: string;
  raw_materials?: RawMaterial | null;
  suppliers?: { supplier_name: string } | null;
  branches?: { branch_name: string } | null;
}

const categoryLabels: Record<string, string> = {
  general: 'عام',
  gemstones: 'أحجار كريمة',
  metals: 'معادن',
  packaging: 'تغليف',
  tools: 'أدوات',
  chemicals: 'مواد كيميائية',
};

const unitLabels: Record<string, string> = {
  piece: 'قطعة',
  gram: 'جرام',
  kg: 'كيلوجرام',
  meter: 'متر',
  liter: 'لتر',
};

const transactionTypeLabels: Record<string, string> = {
  purchase: 'شراء',
  issue_to_production: 'صرف للإنتاج',
  return: 'مرتجع',
  adjustment: 'تسوية',
  transfer_in: 'تحويل وارد',
  transfer_out: 'تحويل صادر',
};

export default function RawMaterialsPage() {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<RawMaterial | null>(null);

  // Fetch materials
  const { data: materials = [], isLoading: loadingMaterials } = useQuery({
    queryKey: ['raw-materials'],
    queryFn: async () => {
      const res = await fetch('/api/raw-materials-list', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed');
      return await res.json() as RawMaterial[];
    },
  });

  // Fetch stock
  const { data: stockData = [], isLoading: loadingStock } = useQuery({
    queryKey: ['raw-materials-stock'],
    queryFn: async () => {
      const res = await fetch('/api/raw-materials-stock-list', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed');
      return await res.json() as RawMaterialStock[];
    },
  });

  // Fetch transactions
  const { data: transactions = [], isLoading: loadingTransactions } = useQuery({
    queryKey: ['raw-materials-transactions'],
    queryFn: async () => {
      const res = await fetch('/api/raw-materials-transactions-list', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed');
      return await res.json() as RawMaterialTransaction[];
    },
  });

  // Fetch suppliers
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const res = await fetch('/api/suppliers', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    },
  });

  // Fetch branches
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    },
  });

  // Create/Update material mutation
  const materialMutation = useMutation({
    mutationFn: async (data: Partial<RawMaterial> & { id?: string }) => {
      throw new Error('هذه الميزة غير جاهزة بعد - المواد الخام');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['raw-materials'] });
      setMaterialDialogOpen(false);
      setEditingMaterial(null);
      toast.success('تم حفظ المادة الخام بنجاح');
    },
    onError: (error) => {
      toast.error('فشل في حفظ المادة الخام');
      console.error(error);
    },
  });

  // Create transaction mutation
  const transactionMutation = useMutation({
    mutationFn: async (data: {
      material_id: string;
      branch_id: string;
      transaction_type: string;
      quantity: number;
      unit_price: number;
      supplier_id?: string;
      notes?: string;
    }) => {
      throw new Error('هذه الميزة غير جاهزة بعد - المواد الخام');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['raw-materials-stock'] });
      queryClient.invalidateQueries({ queryKey: ['raw-materials-transactions'] });
      setTransactionDialogOpen(false);
      toast.success('تم تسجيل الحركة بنجاح');
    },
    onError: (error) => {
      toast.error('فشل في تسجيل الحركة');
      console.error(error);
    },
  });

  // Filter materials
  const filteredMaterials = useMemo(() => {
    return materials.filter(m =>
      m.material_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.material_code.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [materials, searchTerm]);

  // Low stock items
  const lowStockItems = useMemo(() => {
    return stockData.filter(s => 
      s.raw_materials && s.quantity < (s.raw_materials.minimum_stock || 0)
    );
  }, [stockData]);

  // Statistics
  const stats = useMemo(() => ({
    totalMaterials: materials.length,
    activeMaterials: materials.filter(m => m.is_active).length,
    lowStockCount: lowStockItems.length,
    totalTransactions: transactions.length,
  }), [materials, lowStockItems, transactions]);

  if (loadingMaterials || loadingStock) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">مستودع المواد الخام</h1>
            <p className="text-muted-foreground">إدارة المواد الخام والمستلزمات</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setMaterialDialogOpen(true)}>
              <Plus className="w-4 h-4 ml-2" />
              إضافة مادة
            </Button>
            <Button variant="outline" onClick={() => setTransactionDialogOpen(true)}>
              <ArrowDownCircle className="w-4 h-4 ml-2" />
              حركة جديدة
            </Button>
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Package className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalMaterials}</p>
                  <p className="text-xs text-muted-foreground">إجمالي المواد</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <Box className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.activeMaterials}</p>
                  <p className="text-xs text-muted-foreground">مواد نشطة</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <AlertTriangle className="w-5 h-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.lowStockCount}</p>
                  <p className="text-xs text-muted-foreground">نقص مخزون</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <RefreshCw className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalTransactions}</p>
                  <p className="text-xs text-muted-foreground">إجمالي الحركات</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Low Stock Alert */}
        {lowStockItems.length > 0 && (
          <Card className="border-orange-500/50 bg-orange-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-orange-600">
                <AlertTriangle className="w-4 h-4" />
                تنبيه: مواد بحاجة لإعادة تزويد
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {lowStockItems.slice(0, 5).map(item => (
                  <Badge key={item.id} variant="outline" className="border-orange-500 text-orange-600">
                    {item.raw_materials?.material_name} ({item.quantity} / {item.raw_materials?.minimum_stock})
                  </Badge>
                ))}
                {lowStockItems.length > 5 && (
                  <Badge variant="outline">+{lowStockItems.length - 5} أخرى</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue="materials" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="materials">المواد الخام</TabsTrigger>
            <TabsTrigger value="stock">المخزون</TabsTrigger>
            <TabsTrigger value="transactions">الحركات</TabsTrigger>
          </TabsList>

          {/* Materials Tab */}
          <TabsContent value="materials" className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="بحث..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pr-9"
                />
              </div>
            </div>

            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الكود</TableHead>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الفئة</TableHead>
                    <TableHead>الوحدة</TableHead>
                    <TableHead>الحد الأدنى</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMaterials.map((material) => (
                    <TableRow key={material.id}>
                      <TableCell className="font-mono">{material.material_code}</TableCell>
                      <TableCell className="font-medium">{material.material_name}</TableCell>
                      <TableCell>{categoryLabels[material.category] || material.category}</TableCell>
                      <TableCell>{unitLabels[material.unit] || material.unit}</TableCell>
                      <TableCell>{material.minimum_stock}</TableCell>
                      <TableCell>
                        <Badge variant={material.is_active ? 'default' : 'secondary'}>
                          {material.is_active ? 'نشط' : 'غير نشط'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingMaterial(material);
                            setMaterialDialogOpen(true);
                          }}
                        >
                          تعديل
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredMaterials.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        لا توجد مواد خام
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Stock Tab */}
          <TabsContent value="stock" className="space-y-4">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المادة</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead>الكمية</TableHead>
                    <TableHead>آخر سعر شراء</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stockData.map((stock) => {
                    const isLow = stock.raw_materials && stock.quantity < (stock.raw_materials.minimum_stock || 0);
                    return (
                      <TableRow key={stock.id}>
                        <TableCell className="font-medium">
                          {stock.raw_materials?.material_name}
                        </TableCell>
                        <TableCell>{stock.branches?.branch_name || 'غير محدد'}</TableCell>
                        <TableCell>
                          {stock.quantity} {stock.raw_materials ? unitLabels[stock.raw_materials.unit] : ''}
                        </TableCell>
                        <TableCell>{stock.last_purchase_price?.toFixed(2)} ر.س</TableCell>
                        <TableCell>
                          {isLow ? (
                            <Badge variant="destructive">نقص</Badge>
                          ) : (
                            <Badge variant="default">متوفر</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {stockData.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        لا يوجد مخزون
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Transactions Tab */}
          <TabsContent value="transactions" className="space-y-4">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>المادة</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>الكمية</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead>المورد</TableHead>
                    <TableHead>الإجمالي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell>
                        {format(new Date(tx.transaction_date), 'yyyy/MM/dd HH:mm', { locale: ar })}
                      </TableCell>
                      <TableCell className="font-medium">
                        {tx.raw_materials?.material_name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {transactionTypeLabels[tx.transaction_type] || tx.transaction_type}
                        </Badge>
                      </TableCell>
                      <TableCell>{tx.quantity}</TableCell>
                      <TableCell>{tx.branches?.branch_name || '-'}</TableCell>
                      <TableCell>{tx.suppliers?.supplier_name || '-'}</TableCell>
                      <TableCell>{tx.total_amount?.toFixed(2)} ر.س</TableCell>
                    </TableRow>
                  ))}
                  {transactions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        لا توجد حركات
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Material Dialog */}
        <MaterialDialog
          open={materialDialogOpen}
          onOpenChange={(open) => {
            setMaterialDialogOpen(open);
            if (!open) setEditingMaterial(null);
          }}
          material={editingMaterial}
          onSave={(data) => materialMutation.mutate(data)}
          isLoading={materialMutation.isPending}
        />

        {/* Transaction Dialog */}
        <TransactionDialog
          open={transactionDialogOpen}
          onOpenChange={setTransactionDialogOpen}
          materials={materials}
          branches={branches}
          suppliers={suppliers}
          onSave={(data) => transactionMutation.mutate(data)}
          isLoading={transactionMutation.isPending}
        />
      </div>
    </MainLayout>
  );
}

// Material Dialog Component
function MaterialDialog({
  open,
  onOpenChange,
  material,
  onSave,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  material: RawMaterial | null;
  onSave: (data: Partial<RawMaterial> & { id?: string }) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    material_code: '',
    material_name: '',
    material_name_en: '',
    category: 'general',
    unit: 'piece',
    minimum_stock: 0,
    description: '',
  });

  useState(() => {
    if (material) {
      setFormData({
        material_code: material.material_code,
        material_name: material.material_name,
        material_name_en: material.material_name_en || '',
        category: material.category,
        unit: material.unit,
        minimum_stock: material.minimum_stock,
        description: material.description || '',
      });
    } else {
      setFormData({
        material_code: '',
        material_name: '',
        material_name_en: '',
        category: 'general',
        unit: 'piece',
        minimum_stock: 0,
        description: '',
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{material ? 'تعديل مادة خام' : 'إضافة مادة خام'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!material && (
            <div className="space-y-2">
              <Label>كود المادة</Label>
              <Input
                value={formData.material_code}
                onChange={(e) => setFormData({ ...formData, material_code: e.target.value })}
                placeholder="مثال: RM-001"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>اسم المادة</Label>
            <Input
              value={formData.material_name}
              onChange={(e) => setFormData({ ...formData, material_name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>الاسم بالإنجليزية (اختياري)</Label>
            <Input
              value={formData.material_name_en}
              onChange={(e) => setFormData({ ...formData, material_name_en: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>الفئة</Label>
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData({ ...formData, category: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(categoryLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>الوحدة</Label>
              <Select
                value={formData.unit}
                onValueChange={(value) => setFormData({ ...formData, unit: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(unitLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>الحد الأدنى للمخزون</Label>
            <Input
              type="number"
              value={formData.minimum_stock}
              onChange={(e) => setFormData({ ...formData, minimum_stock: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>الوصف (اختياري)</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button
            onClick={() => onSave({ ...formData, id: material?.id })}
            disabled={isLoading || !formData.material_name || (!material && !formData.material_code)}
          >
            {isLoading && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Transaction Dialog Component
function TransactionDialog({
  open,
  onOpenChange,
  materials,
  branches,
  suppliers,
  onSave,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materials: RawMaterial[];
  branches: { id: string; branch_name: string }[];
  suppliers: { id: string; supplier_name: string }[];
  onSave: (data: any) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    material_id: '',
    branch_id: '',
    transaction_type: 'purchase',
    quantity: 0,
    unit_price: 0,
    supplier_id: '',
    notes: '',
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>حركة مخزون جديدة</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>المادة</Label>
            <Select
              value={formData.material_id}
              onValueChange={(value) => setFormData({ ...formData, material_id: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر المادة" />
              </SelectTrigger>
              <SelectContent>
                {materials.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.material_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>الفرع</Label>
            <Select
              value={formData.branch_id}
              onValueChange={(value) => setFormData({ ...formData, branch_id: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر الفرع" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>نوع الحركة</Label>
            <Select
              value={formData.transaction_type}
              onValueChange={(value) => setFormData({ ...formData, transaction_type: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(transactionTypeLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>الكمية</Label>
              <Input
                type="number"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>سعر الوحدة</Label>
              <Input
                type="number"
                value={formData.unit_price}
                onChange={(e) => setFormData({ ...formData, unit_price: Number(e.target.value) })}
              />
            </div>
          </div>
          {formData.transaction_type === 'purchase' && (
            <div className="space-y-2">
              <Label>المورد</Label>
              <Select
                value={formData.supplier_id}
                onValueChange={(value) => setFormData({ ...formData, supplier_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر المورد (اختياري)" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.supplier_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>ملاحظات</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button
            onClick={() => onSave(formData)}
            disabled={isLoading || !formData.material_id || !formData.branch_id || formData.quantity <= 0}
          >
            {isLoading && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            تسجيل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
