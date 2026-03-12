import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
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
  ArrowRight
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { useItemMovements, getDocumentRoute, type MovementEntry, type ReferenceType } from '@/hooks/useItemMovements';
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

interface ItemHistoryReportProps {
  onBack: () => void;
}

export default function ItemHistoryReport({ onBack }: ItemHistoryReportProps) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<JewelryItem | null>(null);
  
  // Document preview drawer state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewReferenceType, setPreviewReferenceType] = useState<ReferenceType | null>(null);
  const [previewReferenceId, setPreviewReferenceId] = useState<string | null>(null);
  
  // Journal entry preview dialog state
  const [journalPreviewOpen, setJournalPreviewOpen] = useState(false);
  const [journalEntryId, setJournalEntryId] = useState<string | null>(null);

  // Search items
  const { data: searchResults = [], isLoading: searchLoading } = useQuery({
    queryKey: ['item-search', searchTerm],
    queryFn: async () => {
      if (!searchTerm || searchTerm.length < 2) return [];
      
      const res = await fetch(`/api/reports/item-history-search?term=${encodeURIComponent(searchTerm)}`, { credentials: 'include' });
      if (res.status === 501) return [];
      const data = await res.json();
      return (data || []).map((item: any) => ({
        ...item,
        branches: item.branch_name ? { branch_name: item.branch_name } : null,
        purchase_batches: item.batch_no ? { batch_no: item.batch_no } : null,
      })) as JewelryItem[];
    },
    enabled: searchTerm.length >= 2,
  });

  // Use the enhanced movements hook
  const {
    movements,
    documentSummaries,
    isLoading: movementsLoading,
    hasMore,
    loadMore,
    isLoadingMore,
  } = useItemMovements(selectedItem?.id || null);

  const getStatusBadge = (item: JewelryItem) => {
    if (item.sold_at) {
      return <Badge className="bg-red-100 text-red-800">مباع</Badge>;
    }
    if (item.branch_id) {
      return <Badge className="bg-green-100 text-green-800">في الفرع</Badge>;
    }
    return <Badge className="bg-gray-100 text-gray-800">في المستودع</Badge>;
  };

  // Get current location display
  const getCurrentLocation = () => {
    if (!selectedItem) return null;
    
    if (selectedItem.sold_at) {
      return { status: 'sold', text: 'مباع', color: 'text-red-600' };
    }
    if (selectedItem.branches?.branch_name) {
      return { status: 'branch', text: selectedItem.branches.branch_name, color: 'text-green-600' };
    }
    return { status: 'warehouse', text: 'المستودع الرئيسي', color: 'text-blue-600' };
  };

  const currentLocation = getCurrentLocation();

  // Handler for document preview
  const handlePreview = (movement: MovementEntry) => {
    if (movement.reference_type && movement.reference_id) {
      setPreviewReferenceType(movement.reference_type);
      setPreviewReferenceId(movement.reference_id);
      setPreviewOpen(true);
    }
  };

  // Handler for journal entry preview
  const handleJournalPreview = (entryId: string) => {
    setJournalEntryId(entryId);
    setJournalPreviewOpen(true);
  };

  // Deduplicate and consolidate transfer movements
  const consolidatedMovements = movements.reduce((acc: MovementEntry[], movement) => {
    // Check if this is a transfer pair that was already added
    if (movement.movement_type === 'TRANSFER_IN' || movement.movement_type === 'TRANSFER_OUT' || movement.movement_type === 'transfer') {
      const existingTransfer = acc.find(
        m => m.reference_id === movement.reference_id && 
             m.reference_type === 'transfer' &&
             (m.movement_type === 'TRANSFER' || m.movement_type === 'TRANSFER_IN' || m.movement_type === 'TRANSFER_OUT' || m.movement_type === 'transfer')
      );
      if (existingTransfer) {
        return acc;
      }
      acc.push({
        ...movement,
        movement_type: movement.movement_type === 'transfer' ? 'transfer' as any : 'TRANSFER',
      });
    } else {
      acc.push(movement);
    }
    return acc;
  }, []);

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">تاريخ حركة القطع</h1>
          <p className="text-muted-foreground">تتبع جميع حركات القطع من الاستيراد حتى البيع</p>
        </div>
        <Button variant="outline" onClick={onBack}>
          <ArrowRight className="w-4 h-4 ml-2" />
          عودة للتقارير
        </Button>
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
                  <div className="p-4 rounded-lg bg-muted/50 border mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-background">
                        <MapPin className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">الموقع الحالي</p>
                        <p className={`font-semibold ${currentLocation.color}`}>
                          {currentLocation.text}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Item Details */}
                <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-muted/30 mb-4">
                  <div>
                    <p className="text-xs text-muted-foreground">كود القطعة</p>
                    <p className="font-mono font-medium">{selectedItem.serial_no}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">الوزن</p>
                    <p className="font-medium">{selectedItem.g_weight?.toFixed(2) || '-'} جرام</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">التكلفة</p>
                    <p className="font-medium">{formatCurrency(selectedItem.cost || 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">السعر</p>
                    <p className="font-medium">{formatCurrency(selectedItem.tag_price || 0)}</p>
                  </div>
                </div>

                {/* Timeline using MovementTimelineCard */}
                <div className="relative">
                  {consolidatedMovements.length === 0 ? (
                    <p className="text-center text-muted-foreground py-4">لا توجد حركات مسجلة</p>
                  ) : (
                    <div className="space-y-3">
                      {consolidatedMovements.map((movement) => (
                        <MovementTimelineCard
                          key={movement.id}
                          movement={movement}
                          documentSummary={movement.reference_id ? documentSummaries.get(movement.reference_id) : undefined}
                          onPreview={handlePreview}
                          onJournalPreview={handleJournalPreview}
                        />
                      ))}
                      
                      {/* Load More Button */}
                      {hasMore && (
                        <div className="flex justify-center pt-4">
                          <Button
                            variant="outline"
                            onClick={() => loadMore()}
                            disabled={isLoadingMore}
                          >
                            {isLoadingMore ? (
                              <>
                                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                                جاري التحميل...
                              </>
                            ) : (
                              'تحميل المزيد'
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Document Preview Drawer */}
      <DocumentPreviewDrawer
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        referenceType={previewReferenceType}
        referenceId={previewReferenceId}
      />

      {/* Journal Entry Preview Dialog */}
      <JournalEntryPreviewDialog
        open={journalPreviewOpen}
        onOpenChange={setJournalPreviewOpen}
        journalEntryId={journalEntryId}
      />
    </div>
  );
}
