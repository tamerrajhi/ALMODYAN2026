import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Plus,
  Search,
  Gem,
  Package,
  DollarSign,
  Filter,
  Eye,
  Edit,
  Link2,
} from 'lucide-react';
import { createGemstonePurchaseJournalEntry } from '@/lib/accounting';

interface GemstoneType {
  id: string;
  type_code: string;
  type_name: string;
  type_name_en: string | null;
  category: string;
  is_active: boolean;
}

interface Gemstone {
  id: string;
  stone_code: string;
  gemstone_type_id: string;
  carat_weight: number;
  color: string | null;
  clarity: string | null;
  cut: string | null;
  shape: string | null;
  origin: string | null;
  certificate_number: string | null;
  certificate_lab: string | null;
  purchase_price: number;
  selling_price: number | null;
  branch_id: string | null;
  supplier_id: string | null;
  status: string;
  jewelry_item_id: string | null;
  notes: string | null;
  created_at: string;
  gemstone_types?: GemstoneType;
  branches?: { branch_name: string } | null;
  suppliers?: { supplier_name: string } | null;
}

interface GemstoneFormData {
  gemstone_type_id: string;
  carat_weight: number;
  color: string;
  clarity: string;
  cut: string;
  shape: string;
  origin: string;
  certificate_number: string;
  certificate_lab: string;
  purchase_price: number;
  selling_price: number;
  branch_id: string;
  supplier_id: string;
  notes: string;
}

const CLARITY_OPTIONS = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1', 'I2', 'I3'];
const CUT_OPTIONS = ['Excellent', 'Very Good', 'Good', 'Fair', 'Poor'];
const SHAPE_OPTIONS = ['Round', 'Princess', 'Oval', 'Marquise', 'Pear', 'Cushion', 'Emerald', 'Radiant', 'Heart', 'Asscher'];

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-500/10 text-green-500',
  reserved: 'bg-yellow-500/10 text-yellow-500',
  sold: 'bg-red-500/10 text-red-500',
  used_in_production: 'bg-blue-500/10 text-blue-500',
};

const STATUS_LABELS: Record<string, string> = {
  available: 'متاح',
  reserved: 'محجوز',
  sold: 'مباع',
  used_in_production: 'مستخدم في الإنتاج',
};

export default function GemstonesPage() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedGemstone, setSelectedGemstone] = useState<Gemstone | null>(null);
  const [formData, setFormData] = useState<GemstoneFormData>({
    gemstone_type_id: '',
    carat_weight: 0,
    color: '',
    clarity: '',
    cut: '',
    shape: '',
    origin: '',
    certificate_number: '',
    certificate_lab: '',
    purchase_price: 0,
    selling_price: 0,
    branch_id: '',
    supplier_id: '',
    notes: '',
  });

  // Fetch gemstone types
  const { data: gemstoneTypes = [] } = useQuery({
    queryKey: ['gemstone-types'],
    queryFn: async () => {
      const res = await fetch('/api/gemstone-types-active', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed');
      return await res.json() as GemstoneType[];
    },
  });

  // Fetch gemstones
  const { data: gemstones = [], isLoading } = useQuery({
    queryKey: ['gemstones', statusFilter, typeFilter],
    queryFn: async () => {
      const res = await fetch('/api/gemstones-list', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed');
      return await res.json() as Gemstone[];
    },
  });

  // Fetch branches
  const { data: branches = [] } = useQuery({
    queryKey: ['active-branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
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

  // Add gemstone mutation
  const addMutation = useMutation({
    mutationFn: async (data: GemstoneFormData) => {
      forbidDirectWrite('insert', 'GemstonesPage.tsx:addMutation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gemstones'] });
      toast.success('تم إضافة الحجر بنجاح');
      setIsAddDialogOpen(false);
      resetForm();
    },
    onError: (error) => {
      toast.error('فشل في إضافة الحجر: ' + error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      gemstone_type_id: '',
      carat_weight: 0,
      color: '',
      clarity: '',
      cut: '',
      shape: '',
      origin: '',
      certificate_number: '',
      certificate_lab: '',
      purchase_price: 0,
      selling_price: 0,
      branch_id: '',
      supplier_id: '',
      notes: '',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.gemstone_type_id) {
      toast.error('يرجى اختيار نوع الحجر');
      return;
    }
    if (formData.carat_weight <= 0) {
      toast.error('يرجى إدخال وزن القيراط');
      return;
    }
    addMutation.mutate(formData);
  };

  const filteredGemstones = gemstones.filter((gem) =>
    gem.stone_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    gem.gemstone_types?.type_name.includes(searchTerm) ||
    gem.certificate_number?.includes(searchTerm)
  );

  // Calculate statistics
  const stats = {
    total: gemstones.length,
    available: gemstones.filter((g) => g.status === 'available').length,
    totalValue: gemstones
      .filter((g) => g.status === 'available')
      .reduce((sum, g) => sum + (g.purchase_price || 0), 0),
    totalCarats: gemstones
      .filter((g) => g.status === 'available')
      .reduce((sum, g) => sum + (g.carat_weight || 0), 0),
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container p-6 space-y-6" dir="rtl">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">إدارة الأحجار الكريمة</h1>
            <p className="text-muted-foreground">مخزون وتتبع الأحجار الكريمة</p>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 ml-2" />
                إضافة حجر جديد
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>إضافة حجر كريم جديد</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>نوع الحجر *</Label>
                    <Select
                      value={formData.gemstone_type_id}
                      onValueChange={(v) => setFormData({ ...formData, gemstone_type_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر نوع الحجر" />
                      </SelectTrigger>
                      <SelectContent>
                        {gemstoneTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.type_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>وزن القيراط *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.carat_weight}
                      onChange={(e) =>
                        setFormData({ ...formData, carat_weight: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>اللون</Label>
                    <Input
                      value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      placeholder="مثال: D, E, F..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>النقاء</Label>
                    <Select
                      value={formData.clarity}
                      onValueChange={(v) => setFormData({ ...formData, clarity: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر النقاء" />
                      </SelectTrigger>
                      <SelectContent>
                        {CLARITY_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>القطع</Label>
                    <Select
                      value={formData.cut}
                      onValueChange={(v) => setFormData({ ...formData, cut: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر القطع" />
                      </SelectTrigger>
                      <SelectContent>
                        {CUT_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>الشكل</Label>
                    <Select
                      value={formData.shape}
                      onValueChange={(v) => setFormData({ ...formData, shape: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر الشكل" />
                      </SelectTrigger>
                      <SelectContent>
                        {SHAPE_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>المنشأ</Label>
                    <Input
                      value={formData.origin}
                      onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
                      placeholder="مثال: جنوب أفريقيا"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>رقم الشهادة</Label>
                    <Input
                      value={formData.certificate_number}
                      onChange={(e) =>
                        setFormData({ ...formData, certificate_number: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>معمل الشهادة</Label>
                    <Input
                      value={formData.certificate_lab}
                      onChange={(e) =>
                        setFormData({ ...formData, certificate_lab: e.target.value })
                      }
                      placeholder="مثال: GIA, IGI"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>سعر الشراء *</Label>
                    <Input
                      type="number"
                      value={formData.purchase_price}
                      onChange={(e) =>
                        setFormData({ ...formData, purchase_price: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>سعر البيع</Label>
                    <Input
                      type="number"
                      value={formData.selling_price}
                      onChange={(e) =>
                        setFormData({ ...formData, selling_price: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>الفرع</Label>
                    <Select
                      value={formData.branch_id}
                      onValueChange={(v) => setFormData({ ...formData, branch_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر الفرع" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((branch) => (
                          <SelectItem key={branch.id} value={branch.id}>
                            {branch.branch_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>المورد</Label>
                    <Select
                      value={formData.supplier_id}
                      onValueChange={(v) => setFormData({ ...formData, supplier_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر المورد" />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map((supplier) => (
                          <SelectItem key={supplier.id} value={supplier.id}>
                            {supplier.supplier_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>ملاحظات</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsAddDialogOpen(false)}
                  >
                    إلغاء
                  </Button>
                  <Button type="submit" disabled={addMutation.isPending}>
                    {addMutation.isPending ? 'جاري الحفظ...' : 'حفظ'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-full">
                  <Gem className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي الأحجار</p>
                  <p className="text-2xl font-bold">{stats.total}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-500/10 rounded-full">
                  <Package className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">أحجار متاحة</p>
                  <p className="text-2xl font-bold">{stats.available}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-yellow-500/10 rounded-full">
                  <DollarSign className="h-6 w-6 text-yellow-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">قيمة المخزون</p>
                  <p className="text-2xl font-bold">{stats.totalValue.toLocaleString()} ر.س</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-full">
                  <Gem className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي القيراط</p>
                  <p className="text-2xl font-bold">{stats.totalCarats.toFixed(2)} قيراط</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث بالكود أو الشهادة..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pr-10"
                  />
                </div>
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="نوع الحجر" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الأنواع</SelectItem>
                  {gemstoneTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.type_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="الحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الحالات</SelectItem>
                  <SelectItem value="available">متاح</SelectItem>
                  <SelectItem value="reserved">محجوز</SelectItem>
                  <SelectItem value="sold">مباع</SelectItem>
                  <SelectItem value="used_in_production">مستخدم في الإنتاج</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Gemstones Table */}
        <Card>
          <CardContent className="p-0">
            <div className="responsive-table-wrapper">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>كود الحجر</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>القيراط</TableHead>
                  <TableHead>اللون</TableHead>
                  <TableHead>النقاء</TableHead>
                  <TableHead>الشهادة</TableHead>
                  <TableHead>سعر الشراء</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الفرع</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8">
                      جاري التحميل...
                    </TableCell>
                  </TableRow>
                ) : filteredGemstones.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8">
                      لا توجد أحجار
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredGemstones.map((gem) => (
                    <TableRow key={gem.id}>
                      <TableCell className="font-mono">{gem.stone_code}</TableCell>
                      <TableCell>{gem.gemstone_types?.type_name}</TableCell>
                      <TableCell>{gem.carat_weight} قيراط</TableCell>
                      <TableCell>{gem.color || '-'}</TableCell>
                      <TableCell>{gem.clarity || '-'}</TableCell>
                      <TableCell>
                        {gem.certificate_number ? (
                          <span className="text-xs">
                            {gem.certificate_lab}: {gem.certificate_number}
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>{gem.purchase_price.toLocaleString()} ر.س</TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLORS[gem.status]}>
                          {STATUS_LABELS[gem.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>{gem.branches?.branch_name || '-'}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedGemstone(gem)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>

        {/* Gemstone Details Dialog */}
        <Dialog open={!!selectedGemstone} onOpenChange={() => setSelectedGemstone(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>تفاصيل الحجر - {selectedGemstone?.stone_code}</DialogTitle>
            </DialogHeader>
            {selectedGemstone && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">النوع:</span>
                    <p className="font-medium">{selectedGemstone.gemstone_types?.type_name}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">القيراط:</span>
                    <p className="font-medium">{selectedGemstone.carat_weight}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">اللون:</span>
                    <p className="font-medium">{selectedGemstone.color || '-'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">النقاء:</span>
                    <p className="font-medium">{selectedGemstone.clarity || '-'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">القطع:</span>
                    <p className="font-medium">{selectedGemstone.cut || '-'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">الشكل:</span>
                    <p className="font-medium">{selectedGemstone.shape || '-'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">المنشأ:</span>
                    <p className="font-medium">{selectedGemstone.origin || '-'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">الشهادة:</span>
                    <p className="font-medium">
                      {selectedGemstone.certificate_lab && selectedGemstone.certificate_number
                        ? `${selectedGemstone.certificate_lab}: ${selectedGemstone.certificate_number}`
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">سعر الشراء:</span>
                    <p className="font-medium">
                      {selectedGemstone.purchase_price.toLocaleString()} ر.س
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">سعر البيع:</span>
                    <p className="font-medium">
                      {selectedGemstone.selling_price?.toLocaleString() || '-'} ر.س
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">المورد:</span>
                    <p className="font-medium">{selectedGemstone.suppliers?.supplier_name || '-'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">الفرع:</span>
                    <p className="font-medium">{selectedGemstone.branches?.branch_name || '-'}</p>
                  </div>
                </div>
                {selectedGemstone.notes && (
                  <div>
                    <span className="text-muted-foreground">ملاحظات:</span>
                    <p className="mt-1">{selectedGemstone.notes}</p>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
