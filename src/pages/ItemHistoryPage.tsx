import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  serial_no: string;
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
  branches: { branch_name: string } | null;
  purchase_batches: { batch_no: string } | null;
}

export default function ItemHistoryPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<JewelryItem | null>(null);
  
  // Preview drawer state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMovement, setPreviewMovement] = useState<MovementEntry | null>(null);
  
  // Journal entry preview state
  const [journalPreviewOpen, setJournalPreviewOpen] = useState(false);
  const [journalEntryId, setJournalEntryId] = useState<string | null>(null);

  // Use the optimized movements hook with pagination
  const {
    movements,
    documentSummaries,
    isLoading: movementsLoading,
    hasMore,
    loadMore,
    isLoadingMore
  } = useItemMovements(selectedItem?.id || null, 50);

  // Search items
  const { data: searchResults = [], isLoading: searchLoading } = useQuery({
    queryKey: ['item-search', searchTerm],
    queryFn: async () => {
      if (!searchTerm || searchTerm.length < 2) return [];
      
      const res = await fetch(`/api/reports/item-history-search?term=${encodeURIComponent(searchTerm)}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to search items');
      const data = await res.json();
      return (data || []).map((item: any) => ({
        ...item,
        branches: item.branch_name ? { branch_name: item.branch_name } : null,
        purchase_batches: item.batch_no ? { batch_no: item.batch_no } : null,
      })) as JewelryItem[];
    },
    enabled: searchTerm.length >= 2,
  });

  const getStatusBadge = (item: JewelryItem) => {
    if (item.sold_at) {
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">مباع</Badge>;
    }
    if (item.branch_id) {
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">في الفرع</Badge>;
    }
    return <Badge className="bg-muted text-muted-foreground">في المستودع</Badge>;
  };

  // Get current location display
  const getCurrentLocation = () => {
    if (!selectedItem) return null;
    
    if (selectedItem.sold_at) {
      return { status: 'sold', text: 'مباع', color: 'text-destructive' };
    }
    if (selectedItem.branches?.branch_name) {
      return { status: 'branch', text: selectedItem.branches.branch_name, color: 'text-green-600 dark:text-green-400' };
    }
    return { status: 'warehouse', text: 'المستودع الرئيسي', color: 'text-primary' };
  };

  const currentLocation = getCurrentLocation();

  // Handle document preview
  const handlePreview = useCallback((movement: MovementEntry) => {
    setPreviewMovement(movement);
    setPreviewOpen(true);
  }, []);

  // Handle journal entry preview
  const handleJournalPreview = useCallback((journalEntryId: string) => {
    setJournalEntryId(journalEntryId);
    setJournalPreviewOpen(true);
  }, []);

  // Get document summary for a movement
  const getDocumentSummary = useCallback((movement: MovementEntry) => {
    if (!movement.reference_type || !movement.reference_id) return undefined;
    const key = `${movement.reference_type}:${movement.reference_id}`;
    return documentSummaries.get(key);
  }, [documentSummaries]);

  return (
    <MainLayout>
      <div className="animate-fade-in">
        {/* Header */}
        <div className="page-header">
          <h1 className="page-title">تاريخ حركة القطع</h1>
          <p className="page-description">تتبع جميع حركات القطع من الاستيراد حتى البيع</p>
        </div>

        {/* Search */}
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
          {/* Search Results */}
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
                      onClick={() => setSelectedItem(item)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-mono font-medium">{item.serial_no}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.stockcode || item.model || item.description || '-'}
                          </p>
                        </div>
                        <div className="text-left">
                          {getStatusBadge(item)}
                          <p className="text-xs text-muted-foreground mt-1">
                            {item.branches?.branch_name || 'غير محدد'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Item Timeline */}
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
                  {/* Current Location - Prominent Display */}
                  {currentLocation && (
                    <div className="p-5 bg-gradient-to-l from-primary/10 to-primary/5 border-2 border-primary/30 rounded-xl">
                      <div className="flex items-center gap-3 mb-2">
                        <MapPin className="w-6 h-6 text-primary" />
                        <span className="text-lg font-semibold text-muted-foreground">الموقع الحالي</span>
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

                  {/* Item Info */}
                  <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-lg">{selectedItem.serial_no}</span>
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

                  {/* Timeline */}
                  {movements.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">
                      لا توجد حركات مسجلة
                    </div>
                  ) : (
                    <div className="relative pr-6">
                      {/* Timeline line */}
                      <div className="absolute right-2 top-0 bottom-0 w-0.5 bg-border" />
                      
                      {/* Timeline items */}
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

                      {/* Load More Button */}
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

        {/* Document Preview Drawer */}
        <DocumentPreviewDrawer
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          referenceType={previewMovement?.reference_type || null}
          referenceId={previewMovement?.reference_id || null}
        />

        {/* Journal Entry Preview Dialog */}
        <JournalEntryPreviewDialog
          open={journalPreviewOpen}
          onOpenChange={setJournalPreviewOpen}
          journalEntryId={journalEntryId}
        />
      </div>
    </MainLayout>
  );
}
