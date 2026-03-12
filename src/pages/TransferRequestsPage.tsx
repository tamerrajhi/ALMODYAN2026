import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUserBranches } from '@/hooks/useUserBranches';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { 
  ArrowRightLeft, 
  Plus, 
  Loader2, 
  CheckCircle, 
  XCircle,
  Clock,
  Search,
  Package
} from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

interface TransferRequest {
  id: string;
  request_code: string;
  from_branch_id: string | null;
  to_branch_id: string;
  requested_by: string;
  requested_at: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  from_branch?: { branch_name: string } | null;
  to_branch?: { branch_name: string } | null;
  requester?: { full_name: string } | null;
  approver?: { full_name: string } | null;
  items_count?: number;
}

interface JewelryItem {
  id: string;
  serial_no: string;
  stockcode: string | null;
  model: string | null;
  description: string | null;
  branch_id: string | null;
  sale_id: string | null;
}

export default function TransferRequestsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { userBranches, isLoading: branchesLoading } = useUserBranches();
  
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<TransferRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  
  // Create form state
  const [toBranchId, setToBranchId] = useState('');
  const [notes, setNotes] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItems, setSelectedItems] = useState<JewelryItem[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  // Check if user can approve transfer requests (admin or has custom role permission)
  const { data: canApprove } = useQuery({
    queryKey: ['can-approve-transfers', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await dataGateway.rpc('can_approve_transfer_requests', {
        _user_id: user!.id,
      });
      return !!data;
    },
  });

  // Fetch all branches for selection
  const { data: allBranches } = useQuery({
    queryKey: ['all-branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Fetch transfer requests
  const { data: requests, isLoading } = useQuery({
    queryKey: ['transfer-requests'],
    queryFn: async () => {
      const res = await fetch('/api/transfer-requests-list', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) as TransferRequest[];
    },
  });

  // Search items for transfer
  const { data: searchResults } = useQuery({
    queryKey: ['search-items-for-transfer', searchQuery],
    enabled: searchQuery.length >= 2,
    queryFn: async () => {
      const res = await fetch(`/api/search-items-for-transfer?q=${encodeURIComponent(searchQuery)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) as JewelryItem[];
    },
  });

  // Fetch request items
  const { data: requestItems } = useQuery({
    queryKey: ['request-items', selectedRequest?.id],
    enabled: !!selectedRequest?.id,
    queryFn: async () => {
      const res = await fetch(`/api/transfer-request-items/${selectedRequest!.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Create request mutation
  const createRequestMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id || !toBranchId || selectedItems.length === 0) {
        throw new Error('بيانات غير مكتملة');
      }

      // Generate request code
      const { data: requestCode } = await dataGateway.rpc('generate_transfer_request_code', {});
      
      // Get the source branch (first item's branch)
      const fromBranchId = selectedItems[0]?.branch_id;

      // Create request - blocked
      forbidDirectWrite('insert', 'TransferRequestsPage.tsx:227');
      return null as any;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfer-requests'] });
      toast.success('تم إنشاء طلب النقل بنجاح');
      resetForm();
    },
    onError: (error: Error) => {
      toast.error('فشل إنشاء الطلب: ' + error.message);
    },
  });

  // Approve request mutation
  const approveRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      if (!user?.id) throw new Error('غير مصرح');

      // Get request details
      const res = await fetch(`/api/transfer-request-detail/${requestId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      const request = await res.json();

      // Update request status - blocked
      forbidDirectWrite('update', 'TransferRequestsPage.tsx:280');
      return null as any;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfer-requests'] });
      queryClient.invalidateQueries({ queryKey: ['jewelry-items'] });
      toast.success('تمت الموافقة على الطلب ونقل القطع بنجاح');
      setShowDetailsDialog(false);
    },
    onError: (error: Error) => {
      toast.error('فشل الموافقة: ' + error.message);
    },
  });

  // Reject request mutation
  const rejectRequestMutation = useMutation({
    mutationFn: async ({ requestId, reason }: { requestId: string; reason: string }) => {
      if (!user?.id) throw new Error('غير مصرح');

      forbidDirectWrite('update', 'TransferRequestsPage.tsx:347');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfer-requests'] });
      toast.success('تم رفض الطلب');
      setShowRejectDialog(false);
      setShowDetailsDialog(false);
      setRejectionReason('');
    },
    onError: (error: Error) => {
      toast.error('فشل رفض الطلب: ' + error.message);
    },
  });

  const resetForm = () => {
    setToBranchId('');
    setNotes('');
    setSearchQuery('');
    setSelectedItems([]);
    setShowCreateDialog(false);
    setIsCreating(false);
  };

  const handleAddItem = (item: JewelryItem) => {
    if (!selectedItems.find(i => i.id === item.id)) {
      setSelectedItems([...selectedItems, item]);
    }
    setSearchQuery('');
  };

  const handleRemoveItem = (itemId: string) => {
    setSelectedItems(selectedItems.filter(i => i.id !== itemId));
  };

  const handleCreateRequest = async () => {
    if (!toBranchId) {
      toast.error('يرجى اختيار الفرع المستلم');
      return;
    }
    if (selectedItems.length === 0) {
      toast.error('يرجى إضافة قطعة واحدة على الأقل');
      return;
    }
    setIsCreating(true);
    await createRequestMutation.mutateAsync();
    setIsCreating(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="text-yellow-600 border-yellow-600"><Clock className="w-3 h-3 ml-1" />قيد الانتظار</Badge>;
      case 'approved':
        return <Badge variant="outline" className="text-blue-600 border-blue-600"><CheckCircle className="w-3 h-3 ml-1" />تمت الموافقة</Badge>;
      case 'completed':
        return <Badge variant="outline" className="text-green-600 border-green-600"><CheckCircle className="w-3 h-3 ml-1" />مكتمل</Badge>;
      case 'rejected':
        return <Badge variant="outline" className="text-destructive border-destructive"><XCircle className="w-3 h-3 ml-1" />مرفوض</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <ArrowRightLeft className="w-7 h-7 text-gold" />
              {t.transferRequests.title}
            </h1>
            <p className="text-muted-foreground mt-1">
              {canApprove ? t.transferRequests.subtitle : t.transferRequests.subtitleUser}
            </p>
          </div>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="w-4 h-4 ml-2" />
            {t.transferRequests.newRequest}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center">
                <Clock className="w-6 h-6 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {requests?.filter(r => r.status === 'pending').length || 0}
                </p>
                <p className="text-sm text-muted-foreground">{t.transferRequests.pendingRequests}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {requests?.filter(r => r.status === 'completed').length || 0}
                </p>
                <p className="text-sm text-muted-foreground">{t.transferRequests.completedRequests}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {requests?.filter(r => r.status === 'rejected').length || 0}
                </p>
                <p className="text-sm text-muted-foreground">{t.transferRequests.rejectedRequests}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Package className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{requests?.length || 0}</p>
                <p className="text-sm text-muted-foreground">{t.transferRequests.totalRequests}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Requests Table */}
        <Card>
          <CardHeader>
            <CardTitle>{t.transferRequests.requestsList}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : requests && requests.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.transferRequests.requestCode}</TableHead>
                    <TableHead>{t.transfers.fromBranch}</TableHead>
                    <TableHead>{t.transfers.toBranch}</TableHead>
                    <TableHead>{t.transfers.itemsCount}</TableHead>
                    <TableHead>{t.transferRequests.requestedBy}</TableHead>
                    <TableHead>{t.common.date}</TableHead>
                    <TableHead>{t.common.status}</TableHead>
                    <TableHead>{t.transferRequests.approvedBy}</TableHead>
                    <TableHead>{t.common.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-mono">{request.request_code}</TableCell>
                      <TableCell>{request.from_branch?.branch_name || '-'}</TableCell>
                      <TableCell>{request.to_branch?.branch_name || '-'}</TableCell>
                      <TableCell>{request.items_count}</TableCell>
                      <TableCell>{request.requester?.full_name || '-'}</TableCell>
                      <TableCell>
                        {format(new Date(request.requested_at), 'dd MMM yyyy HH:mm', { locale: ar })}
                      </TableCell>
                      <TableCell>{getStatusBadge(request.status)}</TableCell>
                      <TableCell>
                        {request.approver?.full_name || '-'}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedRequest(request);
                            setShowDetailsDialog(true);
                          }}
                        >
                          {t.common.details}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {t.transferRequests.noRequests}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create Request Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-gold" />
              طلب نقل قطع جديد
            </DialogTitle>
            <DialogDescription>
              حدد القطع المراد نقلها والفرع المستلم
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>الفرع المستلم <span className="text-destructive">*</span></Label>
              <Select value={toBranchId} onValueChange={setToBranchId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الفرع" />
                </SelectTrigger>
                <SelectContent>
                  {allBranches?.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>بحث عن قطعة</Label>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث بكود القطعة أو الموديل..."
                  className="pr-10"
                />
              </div>
              
              {searchResults && searchResults.length > 0 && (
                <div className="border rounded-lg max-h-40 overflow-y-auto">
                  {searchResults.map((item) => (
                    <div
                      key={item.id}
                      className="p-2 hover:bg-muted cursor-pointer flex items-center justify-between"
                      onClick={() => handleAddItem(item)}
                    >
                      <div>
                        <p className="font-mono text-sm">{item.serial_no}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.model || item.stockcode || 'بدون وصف'}
                        </p>
                      </div>
                      <Plus className="w-4 h-4 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedItems.length > 0 && (
              <div className="space-y-2">
                <Label>القطع المختارة ({selectedItems.length})</Label>
                <div className="border rounded-lg max-h-40 overflow-y-auto">
                  {selectedItems.map((item) => (
                    <div
                      key={item.id}
                      className="p-2 flex items-center justify-between border-b last:border-0"
                    >
                      <div>
                        <p className="font-mono text-sm">{item.serial_no}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.model || item.stockcode || 'بدون وصف'}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => handleRemoveItem(item.id)}
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>ملاحظات</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="أضف ملاحظات إضافية..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={resetForm}>
              إلغاء
            </Button>
            <Button onClick={handleCreateRequest} disabled={isCreating}>
              {isCreating && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              إرسال الطلب
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-gold" />
              تفاصيل الطلب {selectedRequest?.request_code}
            </DialogTitle>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4 mt-4">
              {/* Requester Info - Prominent Display */}
              <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                <p className="text-sm text-muted-foreground mb-1">مقدم الطلب</p>
                <p className="text-xl font-bold text-primary">{selectedRequest.requester?.full_name || 'غير معروف'}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {format(new Date(selectedRequest.requested_at), 'dd MMMM yyyy - HH:mm', { locale: ar })}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">من فرع</p>
                  <p className="font-medium">{selectedRequest.from_branch?.branch_name || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">إلى فرع</p>
                  <p className="font-medium">{selectedRequest.to_branch?.branch_name || '-'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-sm text-muted-foreground">الحالة</p>
                  <div className="mt-1">{getStatusBadge(selectedRequest.status)}</div>
                </div>
              </div>

              {selectedRequest.notes && (
                <div>
                  <p className="text-sm text-muted-foreground">ملاحظات</p>
                  <p>{selectedRequest.notes}</p>
                </div>
              )}

              {selectedRequest.rejection_reason && (
                <div className="p-3 bg-destructive/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">سبب الرفض</p>
                  <p className="text-destructive">{selectedRequest.rejection_reason}</p>
                </div>
              )}

              <div>
                <p className="text-sm text-muted-foreground mb-2">القطع المطلوبة</p>
                <div className="border rounded-lg max-h-60 overflow-y-auto">
                  {requestItems?.map((ri: any) => (
                    <div key={ri.id} className="p-2 border-b last:border-0">
                      <p className="font-mono text-sm">{ri.item?.serial_no}</p>
                      <p className="text-xs text-muted-foreground">
                        {ri.item?.model || ri.item?.stockcode || 'بدون وصف'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {canApprove && selectedRequest.status === 'pending' && (
                <div className="flex gap-2 pt-4 border-t">
                  <Button
                    className="flex-1"
                    onClick={() => approveRequestMutation.mutate(selectedRequest.id)}
                    disabled={approveRequestMutation.isPending}
                  >
                    {approveRequestMutation.isPending ? (
                      <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    ) : (
                      <CheckCircle className="w-4 h-4 ml-2" />
                    )}
                    موافقة
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => setShowRejectDialog(true)}
                  >
                    <XCircle className="w-4 h-4 ml-2" />
                    رفض
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>رفض الطلب</DialogTitle>
            <DialogDescription>يرجى إدخال سبب الرفض</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <Textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="سبب الرفض..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedRequest) {
                  rejectRequestMutation.mutate({
                    requestId: selectedRequest.id,
                    reason: rejectionReason,
                  });
                }
              }}
              disabled={rejectRequestMutation.isPending || !rejectionReason.trim()}
            >
              {rejectRequestMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              تأكيد الرفض
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
