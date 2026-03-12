import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Search, 
  History,
  Package,
  Loader2,
  MapPin,
  ChevronDown
} from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { useItemMovements, type MovementEntry } from '@/hooks/useItemMovements';
import { MovementTimelineCard } from '@/components/inventory/MovementTimelineCard';
import { DocumentPreviewDrawer } from '@/components/inventory/DocumentPreviewDrawer';
import { JournalEntryPreviewDialog } from '@/components/inventory/JournalEntryPreviewDialog';

interface JewelryItem {
  id: string;
  item_code: string;
  stockcode: string | null;
  model: string | null;
  description: string | null;
  g_weight: number | null;
  d_weight: number | null;
  cost: number | null;
  tag_price: number | null;
  sold_at: string | null;
  branch_id: string | null;
  created_at: string | null;
  batch_id: string | null;
  status: string | null;
  item_source: 'jewelry' | 'unique';
  branch_name: string | null;
  batch_no: string | null;
  supp_inv: string | null;
}

function mapItemNumericFields(item: any): JewelryItem {
  return {
    ...item,
    g_weight: item.g_weight != null ? Number(item.g_weight) : null,
    d_weight: item.d_weight != null ? Number(item.d_weight) : null,
    cost: item.cost != null ? Number(item.cost) : null,
    tag_price: item.tag_price != null ? Number(item.tag_price) : null,
  };
}

export default function ItemMovementsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const initialItemCode = searchParams.get('item_code');
  const initialItemId = searchParams.get('item_id');
  
  const [searchTerm, setSearchTerm] = useState(initialItemCode || '');
  const [selectedItem, setSelectedItem] = useState<JewelryItem | null>(null);
  
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMovement, setPreviewMovement] = useState<MovementEntry | null>(null);
  
  const [journalPreviewOpen, setJournalPreviewOpen] = useState(false);
  const [journalEntryId, setJournalEntryId] = useState<string | null>(null);

  const {
    movements,
    documentSummaries,
    isLoading: movementsLoading,
    hasMore,
    loadMore,
    isLoadingMore
  } = useItemMovements(selectedItem?.id || null, 50, selectedItem?.item_source || 'jewelry');

  const { data: searchResults = [], isLoading: searchLoading } = useQuery({
    queryKey: ['item-movements-search', searchTerm],
    queryFn: async () => {
      if (!searchTerm || searchTerm.length < 2) return [];
      
      const response = await fetch(`/api/inventory/unified-items-search?q=${encodeURIComponent(searchTerm)}`);
      const result = await response.json();
      if (result.error) throw new Error(result.error.message);
      return (result.data || []).map(mapItemNumericFields);
    },
    enabled: searchTerm.length >= 2,
  });

  const { data: itemById } = useQuery({
    queryKey: ['item-by-id', initialItemId],
    queryFn: async () => {
      if (!initialItemId) return null;
      
      const response = await fetch(`/api/inventory/item-by-id/${initialItemId}`);
      const result = await response.json();
      if (result.error) return null;
      return mapItemNumericFields(result.data);
    },
    enabled: !!initialItemId,
  });

  useEffect(() => {
    if (itemById && !selectedItem) {
      setSelectedItem(itemById);
      setSearchTerm(itemById.item_code);
    }
  }, [itemById, selectedItem]);

  useEffect(() => {
    if (initialItemCode && searchResults.length > 0 && !selectedItem) {
      const exactMatch = searchResults.find(
        item => item.item_code.toLowerCase() === initialItemCode.toLowerCase()
      );
      if (exactMatch) {
        setSelectedItem(exactMatch);
      }
    }
  }, [initialItemCode, searchResults, selectedItem]);

  const handleItemSelect = useCallback((item: JewelryItem) => {
    setSelectedItem(item);
    const newSearchParams = new URLSearchParams();
    newSearchParams.set('item_code', item.item_code);
    navigate(`/inventory/item-movements?${newSearchParams.toString()}`, { replace: true });
  }, [navigate]);

  const getStatusBadge = (item: JewelryItem) => {
    if (item.status === 'returned_to_supplier') {
      return <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">مرتجعة للمورد</Badge>;
    }
    if (item.sold_at || item.status === 'sold') {
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">مباع</Badge>;
    }
    if (item.branch_id) {
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">في الفرع</Badge>;
    }
    return <Badge className="bg-muted text-muted-foreground">في المستودع</Badge>;
  };

  const getCurrentLocation = () => {
    if (!selectedItem) return null;
    
    if (selectedItem.status === 'returned_to_supplier') {
      return { status: 'returned', text: 'مرتجعة للمورد', color: 'text-orange-600 dark:text-orange-400' };
    }
    if (selectedItem.sold_at || selectedItem.status === 'sold') {
      return { status: 'sold', text: 'مباع', color: 'text-destructive' };
    }
    if (selectedItem.branch_name) {
      return { status: 'branch', text: selectedItem.branch_name, color: 'text-green-600 dark:text-green-400' };
    }
    return { status: 'warehouse', text: 'المستودع الرئيسي', color: 'text-primary' };
  };

  const currentLocation = getCurrentLocation();

  const handlePreview = useCallback((movement: MovementEntry) => {
    setPreviewMovement(movement);
    setPreviewOpen(true);
  }, []);

  const handleJournalPreview = useCallback((journalEntryId: string) => {
    setJournalEntryId(journalEntryId);
    setJournalPreviewOpen(true);
  }, []);

  const getDocumentSummary = useCallback((movement: MovementEntry) => {
    if (!movement.reference_type || !movement.reference_id) return undefined;
    const key = `${movement.reference_type}:${movement.reference_id}`;
    return documentSummaries.get(key);
  }, [documentSummaries]);

  return (
    <MainLayout>
      <div className="animate-fade-in">
        <div className="page-header">
          <h1 className="page-title">تاريخ حركة القطع</h1>
          <p className="page-description">تتبع جميع حركات القطع من الاستيراد حتى البيع</p>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder="ابحث بكود القطعة أو كود المخزون أو الموديل..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setSelectedItem(null);
                }}
                className="pr-10 text-lg py-6"
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5" />
                نتائج البحث
              </CardTitle>
            </CardHeader>
            <CardContent>
              {searchLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : searchTerm.length < 2 ? (
                <div className="text-center py-8 text-muted-foreground">
                  أدخل كلمة بحث (حرفين على الأقل)
                </div>
              ) : searchResults.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  لا توجد نتائج
                </div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {searchResults.map((item) => (
                    <div
                      key={item.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedItem?.id === item.id
                          ? 'bg-primary/10 border-primary'
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => handleItemSelect(item)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-mono font-medium">{item.item_code}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.model || item.stockcode || item.description || '-'}
                            {item.supp_inv && <span className="text-xs mr-2 text-primary/80">({item.supp_inv})</span>}
                          </p>
                        </div>
                        <div className="text-left">
                          {getStatusBadge(item)}
                          <p className="text-xs text-muted-foreground mt-1">
                            {item.branch_name || 'غير محدد'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="w-5 h-5" />
                سجل الحركات
                {movements.length > 0 && (
                  <Badge variant="secondary" className="mr-2">
                    {movements.length} حركة
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedItem ? (
                <div className="text-center py-8 text-muted-foreground">
                  اختر قطعة لعرض سجل حركاتها
                </div>
              ) : movementsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-4">
                  {currentLocation && (
                    <div className={`p-5 border-2 rounded-xl ${
                      currentLocation.status === 'returned' 
                        ? 'bg-gradient-to-l from-orange-500/10 to-orange-500/5 border-orange-500/30'
                        : currentLocation.status === 'sold'
                        ? 'bg-gradient-to-l from-destructive/10 to-destructive/5 border-destructive/30'
                        : 'bg-gradient-to-l from-primary/10 to-primary/5 border-primary/30'
                    }`}>
                      <div className="flex items-center gap-3 mb-2">
                        <MapPin className={`w-6 h-6 ${
                          currentLocation.status === 'returned' ? 'text-orange-500' 
                          : currentLocation.status === 'sold' ? 'text-destructive' 
                          : 'text-primary'
                        }`} />
                        <span className="text-lg font-semibold text-muted-foreground">
                          {currentLocation.status === 'returned' ? 'حالة القطعة' : 'الموقع الحالي'}
                        </span>
                      </div>
                      <p className={`text-3xl font-bold ${currentLocation.color}`}>
                        {currentLocation.text}
                      </p>
                      {currentLocation.status === 'sold' && selectedItem.sold_at && (
                        <p className="text-sm text-muted-foreground mt-1">
                          تاريخ البيع: {format(new Date(selectedItem.sold_at), 'yyyy/MM/dd', { locale: ar })}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-lg">{selectedItem.item_code}</span>
                      {getStatusBadge(selectedItem)}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">كود المخزون: </span>
                        <span>{selectedItem.stockcode || '-'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">الموديل: </span>
                        <span>{selectedItem.model || '-'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">فاتورة المورد: </span>
                        <span className="font-medium">{selectedItem.supp_inv || '-'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">وزن الذهب: </span>
                        <span>{selectedItem.g_weight?.toFixed(3) || '-'} g</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">وزن الألماس: </span>
                        <span>{selectedItem.d_weight?.toFixed(3) || '-'} ct</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">التكلفة: </span>
                        <span>{selectedItem.cost?.toLocaleString() || '-'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">سعر البيع: </span>
                        <span>{selectedItem.tag_price?.toLocaleString() || '-'}</span>
                      </div>
                    </div>
                  </div>

                  {movements.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">
                      لا توجد حركات مسجلة
                    </div>
                  ) : (
                    <div className="relative pr-6">
                      <div className="absolute right-2 top-0 bottom-0 w-0.5 bg-border" />
                      
                      <div className="space-y-4">
                        {movements.map((movement) => (
                          <MovementTimelineCard
                            key={movement.id}
                            movement={movement}
                            documentSummary={getDocumentSummary(movement)}
                            onPreview={handlePreview}
                            onJournalPreview={handleJournalPreview}
                          />
                        ))}
                      </div>

                      {hasMore && (
                        <div className="mt-4 text-center">
                          <Button
                            variant="outline"
                            onClick={() => loadMore()}
                            disabled={isLoadingMore}
                            className="w-full"
                          >
                            {isLoadingMore ? (
                              <Loader2 className="w-4 h-4 animate-spin ml-2" />
                            ) : (
                              <ChevronDown className="w-4 h-4 ml-2" />
                            )}
                            تحميل المزيد
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <DocumentPreviewDrawer
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          referenceType={previewMovement?.reference_type || null}
          referenceId={previewMovement?.reference_id || null}
        />

        <JournalEntryPreviewDialog
          open={journalPreviewOpen}
          onOpenChange={setJournalPreviewOpen}
          journalEntryId={journalEntryId}
        />
      </div>
    </MainLayout>
  );
}
