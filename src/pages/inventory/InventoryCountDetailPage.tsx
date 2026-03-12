import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { useAuth } from '@/contexts/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { 
  ArrowRight, ClipboardCheck, Barcode, Keyboard, Package, 
  CheckCircle, XCircle, AlertTriangle, Scale, Play, 
  FileCheck, Printer, Calculator, RefreshCw
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createInventoryShortageJournalEntry, createInventoryOverageJournalEntry } from '@/lib/accounting';

const statusLabels: Record<string, string> = {
  open: 'مفتوح',
  counting: 'قيد العد',
  reviewing: 'قيد المراجعة',
  approved: 'معتمد'
};

const statusColors: Record<string, string> = {
  open: 'bg-blue-500',
  counting: 'bg-yellow-500',
  reviewing: 'bg-orange-500',
  approved: 'bg-green-500'
};

const resultTypeLabels: Record<string, string> = {
  matched: 'مطابق',
  shortage: 'عجز',
  overage: 'زيادة',
  weight_diff: 'اختلاف وزن'
};

const resultTypeColors: Record<string, string> = {
  matched: 'bg-green-500',
  shortage: 'bg-red-500',
  overage: 'bg-blue-500',
  weight_diff: 'bg-yellow-500'
};

export default function InventoryCountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  
  const [activeTab, setActiveTab] = useState('reading');
  const [itemCode, setItemCode] = useState('');
  const [actualWeight, setActualWeight] = useState('');
  const [location, setLocation] = useState('');
  const [readMethod, setReadMethod] = useState<'barcode' | 'rfid' | 'manual'>('barcode');
  const [showApproveDialog, setShowApproveDialog] = useState(false);

  // Fetch count details
  const { data: count, isLoading: countLoading } = useQuery({
    queryKey: ['inventory-count', id],
    queryFn: async () => {
      const res = await fetch(`/api/inventory-count/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load');
      return await res.json();
    }
  });

  // Fetch snapshots
  const { data: snapshots } = useQuery({
    queryKey: ['inventory-count-snapshots', id],
    queryFn: async () => {
      const res = await fetch(`/api/inventory-count-snapshots/${id}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    }
  });

  // Fetch readings
  const { data: readings, refetch: refetchReadings } = useQuery({
    queryKey: ['inventory-count-readings', id],
    queryFn: async () => {
      const res = await fetch(`/api/inventory-count-readings/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    }
  });

  // Fetch results
  const { data: results, refetch: refetchResults } = useQuery({
    queryKey: ['inventory-count-results', id],
    queryFn: async () => {
      const res = await fetch(`/api/inventory-count-results/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    }
  });

  // Focus barcode input
  useEffect(() => {
    if (activeTab === 'reading' && barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
  }, [activeTab]);

  // Add reading mutation
  const addReadingMutation = useMutation({
    mutationFn: async () => {
      if (!itemCode.trim()) {
        throw new Error('الرجاء إدخال كود القطعة');
      }

      // Check if already read
      const checkRes = await fetch(`/api/inventory-count-readings/${id}`, { credentials: 'include' });
      const readings = checkRes.ok ? await checkRes.json() : [];
      const existing = readings.find((r: any) => r.item_code === itemCode.trim());
      
      if (existing) {
        throw new Error('تم قراءة هذه القطعة مسبقاً');
      }

      forbidDirectWrite('insert', 'InventoryCountDetailPage.tsx:addReadingMutation');
    },
    onSuccess: () => {
      toast.success('تم تسجيل القراءة بنجاح');
      setItemCode('');
      setActualWeight('');
      setLocation('');
      refetchReadings();
      queryClient.invalidateQueries({ queryKey: ['inventory-count', id] });
      if (barcodeInputRef.current) {
        barcodeInputRef.current.focus();
      }
    },
    onError: (error: any) => {
      toast.error(error.message);
    }
  });

  // Reconcile mutation
  const reconcileMutation = useMutation({
    mutationFn: async () => {
      if (!snapshots || !readings) return;

      forbidDirectWrite('delete', 'InventoryCountDetailPage.tsx:reconcileMutation');
    },
    onSuccess: () => {
      toast.success('تم إجراء المقارنة بنجاح');
      refetchResults();
      queryClient.invalidateQueries({ queryKey: ['inventory-count', id] });
      setActiveTab('results');
    },
    onError: (error: any) => {
      toast.error('حدث خطأ أثناء المقارنة: ' + error.message);
    }
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!count) throw new Error('Count not found');
      
      forbidDirectWrite('update', 'InventoryCountDetailPage.tsx:approveMutation');
    },
    onSuccess: () => {
      toast.success('تم اعتماد الجرد وإنشاء القيود المحاسبية بنجاح');
      setShowApproveDialog(false);
      queryClient.invalidateQueries({ queryKey: ['inventory-count', id] });
    },
    onError: (error: any) => {
      toast.error('حدث خطأ أثناء الاعتماد: ' + error.message);
    }
  });

  const handleBarcodeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addReadingMutation.mutate();
    }
  };

  if (countLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">جاري التحميل...</div>
        </div>
      </MainLayout>
    );
  }

  if (!count) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">لم يتم العثور على الجرد</div>
        </div>
      </MainLayout>
    );
  }

  const isEditable = count.status !== 'approved';

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/inventory-counts')}>
              <ArrowRight className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <ClipboardCheck className="w-7 h-7 text-primary" />
                جرد {count.count_number}
              </h1>
              <p className="text-muted-foreground">
                {count.branch?.branch_name} • {new Date(count.start_date).toLocaleDateString('ar-EG')}
              </p>
            </div>
          </div>
          <Badge className={`${statusColors[count.status]} text-lg px-4 py-1`}>
            {statusLabels[count.status]}
          </Badge>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <Package className="w-8 h-8 mx-auto mb-2 text-primary" />
              <div className="text-2xl font-bold">{count.total_system_items}</div>
              <div className="text-sm text-muted-foreground">قطعة بالنظام</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Barcode className="w-8 h-8 mx-auto mb-2 text-blue-500" />
              <div className="text-2xl font-bold">{count.total_counted_items}</div>
              <div className="text-sm text-muted-foreground">قطعة معدودة</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
              <div className="text-2xl font-bold">{count.total_matched}</div>
              <div className="text-sm text-muted-foreground">مطابق</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <XCircle className="w-8 h-8 mx-auto mb-2 text-red-500" />
              <div className="text-2xl font-bold">{count.total_shortage}</div>
              <div className="text-sm text-muted-foreground">عجز</div>
              {count.shortage_value > 0 && (
                <div className="text-xs text-red-500">{formatCurrency(count.shortage_value)}</div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-yellow-500" />
              <div className="text-2xl font-bold">{count.total_overage}</div>
              <div className="text-sm text-muted-foreground">زيادة</div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-4 w-full max-w-xl">
            <TabsTrigger value="reading" disabled={count.status === 'approved'}>
              <Barcode className="w-4 h-4 ml-2" />
              تسجيل القراءات
            </TabsTrigger>
            <TabsTrigger value="readings-list">
              <Package className="w-4 h-4 ml-2" />
              القراءات ({readings?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="results">
              <Calculator className="w-4 h-4 ml-2" />
              نتائج المقارنة
            </TabsTrigger>
            <TabsTrigger value="snapshot">
              <FileCheck className="w-4 h-4 ml-2" />
              Snapshot
            </TabsTrigger>
          </TabsList>

          {/* Reading Tab */}
          <TabsContent value="reading">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Barcode className="w-5 h-5" />
                  تسجيل قراءة جديدة
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2 mb-4">
                  <Button
                    variant={readMethod === 'barcode' ? 'default' : 'outline'}
                    onClick={() => setReadMethod('barcode')}
                    size="sm"
                  >
                    <Barcode className="w-4 h-4 ml-2" />
                    باركود
                  </Button>
                  <Button
                    variant={readMethod === 'rfid' ? 'default' : 'outline'}
                    onClick={() => setReadMethod('rfid')}
                    size="sm"
                  >
                    RFID
                  </Button>
                  <Button
                    variant={readMethod === 'manual' ? 'default' : 'outline'}
                    onClick={() => setReadMethod('manual')}
                    size="sm"
                  >
                    <Keyboard className="w-4 h-4 ml-2" />
                    يدوي
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="md:col-span-2">
                    <Label>كود القطعة *</Label>
                    <Input
                      ref={barcodeInputRef}
                      value={itemCode}
                      onChange={(e) => setItemCode(e.target.value)}
                      onKeyDown={handleBarcodeKeyDown}
                      placeholder="امسح الباركود أو أدخل الكود..."
                      className="text-lg"
                      disabled={!isEditable}
                    />
                  </div>
                  <div>
                    <Label>الوزن الفعلي (اختياري)</Label>
                    <Input
                      type="number"
                      step="0.001"
                      value={actualWeight}
                      onChange={(e) => setActualWeight(e.target.value)}
                      placeholder="غرام"
                      disabled={!isEditable}
                    />
                  </div>
                  <div>
                    <Label>الموقع (اختياري)</Label>
                    <Input
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="رقم الخزنة/الدرج..."
                      disabled={!isEditable}
                    />
                  </div>
                </div>

                <Button
                  onClick={() => addReadingMutation.mutate()}
                  disabled={!itemCode.trim() || addReadingMutation.isPending || !isEditable}
                  className="w-full"
                  size="lg"
                >
                  {addReadingMutation.isPending ? 'جاري التسجيل...' : 'تسجيل القراءة (Enter)'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Readings List Tab */}
          <TabsContent value="readings-list">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>كود القطعة</TableHead>
                      <TableHead>الوزن الفعلي</TableHead>
                      <TableHead>الموقع</TableHead>
                      <TableHead>طريقة القراءة</TableHead>
                      <TableHead>وقت القراءة</TableHead>
                      <TableHead>في النظام</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {readings?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          لم يتم تسجيل أي قراءات بعد
                        </TableCell>
                      </TableRow>
                    ) : (
                      readings?.map((reading, index) => (
                        <TableRow key={reading.id}>
                          <TableCell>{readings.length - index}</TableCell>
                          <TableCell className="font-mono">{reading.item_code}</TableCell>
                          <TableCell>{reading.actual_weight ? `${reading.actual_weight} غ` : '-'}</TableCell>
                          <TableCell>{reading.location || '-'}</TableCell>
                          <TableCell>
                            {reading.read_method === 'barcode' && 'باركود'}
                            {reading.read_method === 'rfid' && 'RFID'}
                            {reading.read_method === 'manual' && 'يدوي'}
                          </TableCell>
                          <TableCell>
                            {new Date(reading.read_at).toLocaleTimeString('ar-EG')}
                          </TableCell>
                          <TableCell>
                            {reading.item_id ? (
                              <CheckCircle className="w-4 h-4 text-green-500" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-500" />
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Results Tab */}
          <TabsContent value="results">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>نتائج المقارنة</CardTitle>
                {isEditable && (
                  <Button
                    onClick={() => reconcileMutation.mutate()}
                    disabled={reconcileMutation.isPending || !readings?.length}
                  >
                    <RefreshCw className="w-4 h-4 ml-2" />
                    {reconcileMutation.isPending ? 'جاري المقارنة...' : 'إجراء المقارنة'}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>كود القطعة</TableHead>
                      <TableHead>النتيجة</TableHead>
                      <TableHead>وزن النظام</TableHead>
                      <TableHead>الوزن الفعلي</TableHead>
                      <TableHead>الفرق</TableHead>
                      <TableHead>القيمة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          لم يتم إجراء المقارنة بعد
                        </TableCell>
                      </TableRow>
                    ) : (
                      results?.map((result) => (
                        <TableRow key={result.id}>
                          <TableCell className="font-mono">{result.item_code}</TableCell>
                          <TableCell>
                            <Badge className={resultTypeColors[result.result_type]}>
                              {resultTypeLabels[result.result_type]}
                            </Badge>
                          </TableCell>
                          <TableCell>{result.system_weight ? `${result.system_weight} غ` : '-'}</TableCell>
                          <TableCell>{result.actual_weight ? `${result.actual_weight} غ` : '-'}</TableCell>
                          <TableCell>
                            {result.weight_difference ? (
                              <span className={result.weight_difference > 0 ? 'text-green-500' : 'text-red-500'}>
                                {result.weight_difference > 0 ? '+' : ''}{result.weight_difference} غ
                              </span>
                            ) : '-'}
                          </TableCell>
                          <TableCell>
                            {result.calculated_value ? formatCurrency(result.calculated_value) : '-'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Snapshot Tab */}
          <TabsContent value="snapshot">
            <Card>
              <CardHeader>
                <CardTitle>Snapshot المخزون عند بدء الجرد</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>كود القطعة</TableHead>
                      <TableHead>الوصف</TableHead>
                      <TableHead>وزن الذهب</TableHead>
                      <TableHead>وزن الألماس</TableHead>
                      <TableHead>التكلفة</TableHead>
                      <TableHead>سعر البيع</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshots?.map((snapshot) => (
                      <TableRow key={snapshot.id}>
                        <TableCell className="font-mono">{snapshot.item_code}</TableCell>
                        <TableCell>{snapshot.description || '-'}</TableCell>
                        <TableCell>{snapshot.g_weight ? `${snapshot.g_weight} غ` : '-'}</TableCell>
                        <TableCell>{snapshot.d_weight ? `${snapshot.d_weight} قيراط` : '-'}</TableCell>
                        <TableCell>{snapshot.cost ? formatCurrency(snapshot.cost) : '-'}</TableCell>
                        <TableCell>{snapshot.tag_price ? formatCurrency(snapshot.tag_price) : '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Action Buttons */}
        {count.status === 'reviewing' && (
          <Card>
            <CardContent className="p-4 flex justify-end gap-4">
              <Button
                variant="outline"
                onClick={() => navigate(`/inventory-counts/${id}/report`)}
              >
                <Printer className="w-4 h-4 ml-2" />
                معاينة المحضر
              </Button>
              <Button
                onClick={() => setShowApproveDialog(true)}
              >
                <CheckCircle className="w-4 h-4 ml-2" />
                اعتماد الجرد
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Approve Dialog */}
        <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>اعتماد الجرد</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-muted-foreground mb-4">
                هل أنت متأكد من اعتماد هذا الجرد؟ لن يمكن التعديل عليه بعد الاعتماد.
              </p>
              <div className="bg-muted p-4 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span>إجمالي القطع المعدودة:</span>
                  <span className="font-bold">{count.total_counted_items}</span>
                </div>
                <div className="flex justify-between">
                  <span>المطابق:</span>
                  <span className="font-bold text-green-500">{count.total_matched}</span>
                </div>
                <div className="flex justify-between">
                  <span>العجز:</span>
                  <span className="font-bold text-red-500">
                    {count.total_shortage} ({formatCurrency(count.shortage_value)})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>الزيادة:</span>
                  <span className="font-bold text-blue-500">{count.total_overage}</span>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowApproveDialog(false)}>
                إلغاء
              </Button>
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? 'جاري الاعتماد...' : 'تأكيد الاعتماد'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
