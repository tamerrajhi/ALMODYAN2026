import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { queryTable } from '@/lib/dataGateway';
import { useModules } from '@/core/contexts/ModuleContext';
import * as apiClient from '@/lib/apiClient';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { useAuth } from '@/contexts/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  FileText, 
  Plus, 
  Loader2,
  Clock,
  CheckCircle,
  XCircle,
  ClipboardList,
  History,
  Edit2,
  ArrowRight
} from 'lucide-react';
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { logAudit } from '@/lib/audit';
import { notifyApprovers } from '@/lib/pr-notifications';
import { PRFormDialog } from '@/components/purchasing/PRFormDialog';
import { PRDetailsDialog } from '@/components/purchasing/PRDetailsDialog';
import { PRApprovalDialog } from '@/components/purchasing/PRApprovalDialog';

interface Requisition {
  id: string;
  requisition_number: string;
  requested_by: string;
  branch_id: string | null;
  department_id: string | null;
  status: string;
  request_date: string;
  required_date: string | null;
  total_estimated_amount: number;
  priority: string;
  justification: string | null;
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  current_approval_level: number;
  required_approval_level: number;
  converted_to_po_id: string | null;
  created_at: string;
  branches?: { branch_name: string } | null;
  departments?: { department_name: string } | null;
}

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: 'مسودة', color: 'bg-muted text-muted-foreground', icon: Edit2 },
  pending: { label: 'في انتظار الموافقة', color: 'bg-amber-500/20 text-amber-600', icon: Clock },
  pending_dept_approval: { label: 'انتظار مدير القسم', color: 'bg-amber-500/20 text-amber-600', icon: Clock },
  pending_procurement: { label: 'انتظار المشتريات', color: 'bg-blue-500/20 text-blue-600', icon: Clock },
  pending_management: { label: 'انتظار الإدارة', color: 'bg-purple-500/20 text-purple-600', icon: Clock },
  approved: { label: 'موافق عليه', color: 'bg-green-500/20 text-green-600', icon: CheckCircle },
  rejected: { label: 'مرفوض', color: 'bg-red-500/20 text-red-600', icon: XCircle },
  cancelled: { label: 'ملغي', color: 'bg-gray-500/20 text-gray-600', icon: XCircle },
  converted: { label: 'تم تحويله لأمر شراء', color: 'bg-indigo-500/20 text-indigo-600', icon: ArrowRight },
  partially_converted: { label: 'محوّل جزئياً', color: 'bg-cyan-500/20 text-cyan-600', icon: ArrowRight },
  fully_converted: { label: 'محوّل بالكامل', color: 'bg-indigo-500/20 text-indigo-600', icon: ArrowRight },
};

const priorityConfig: Record<string, { label: string; color: string }> = {
  low: { label: 'منخفض', color: 'bg-muted' },
  normal: { label: 'عادي', color: 'bg-blue-500/20 text-blue-600' },
  high: { label: 'عالي', color: 'bg-orange-500/20 text-orange-600' },
  urgent: { label: 'عاجل', color: 'bg-red-500/20 text-red-600' },
};

export default function PurchaseRequisitionsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [selectedRequisition, setSelectedRequisition] = useState<Requisition | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('my-requests');

  // Get user profile
  const { data: userProfile } = useQuery({
    queryKey: ['user-profile', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await apiClient.get<any>('/api/user-profile-with-roles', { user_id: user!.id });
      if (error) throw new Error(error.message);
      return {
        full_name: data?.full_name || user?.email,
        role_name: data?.role_name || 'مستخدم',
      };
    },
  });

  const { isAdmin } = useModules();

  // Fetch all requisitions
  const { data: allRequisitions = [], isLoading } = useQuery({
    queryKey: ['purchase-requisitions', filterStatus],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filterStatus !== 'all') params.status = filterStatus;
      const { data, error } = await apiClient.get<Requisition[]>('/api/purchase-requisitions-list', params);
      if (error) throw new Error(error.message);
      return (data || []) as Requisition[];
    },
  });

  // Filter requisitions by tab
  const getFilteredRequisitions = () => {
    switch (activeTab) {
      case 'my-requests':
        return allRequisitions.filter(r => r.requested_by === user?.id);
      case 'pending-approval':
        return allRequisitions.filter(r => 
          ['pending', 'pending_dept_approval', 'pending_procurement', 'pending_management'].includes(r.status)
        );
      case 'reviewed':
        return allRequisitions.filter(r => 
          ['approved', 'rejected', 'converted'].includes(r.status)
        );
      default:
        return allRequisitions;
    }
  };

  const requisitions = getFilteredRequisitions();

  // Submit for approval mutation
  const submitMutation = useMutation({
    mutationFn: async (id: string) => {
      const req = allRequisitions.find(r => r.id === id);
      if (!req) throw new Error('الطلب غير موجود');

      const status = req.required_approval_level >= 1 ? 'pending_dept_approval' : 'pending';

      forbidDirectWrite('update', 'PurchaseRequisitionsPage.tsx:submitMutation');
    },
    onSuccess: () => {
      toast.success('تم إرسال الطلب للموافقة');
      queryClient.invalidateQueries({ queryKey: ['purchase-requisitions'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل في إرسال الطلب');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      forbidDirectWrite('delete', 'PurchaseRequisitionsPage.tsx:deleteMutation');
    },
    onSuccess: () => {
      toast.success('تم حذف الطلب');
      queryClient.invalidateQueries({ queryKey: ['purchase-requisitions'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل في الحذف');
    },
  });

  // Convert to PO mutation - Uses V2 atomic RPC
  const convertToPOMutation = useMutation({
    mutationFn: async (requisition: Requisition) => {
      // Use atomic RPC convert_pr_to_po_v2_atomic for single PR conversion
      const clientRequestId = crypto.randomUUID();
      
      // First fetch the PR items to build the items array
      const { data: prItems, error: itemsError } = await queryTable<any[]>('purchase_requisition_items', { filters: [{ type: 'eq', column: 'requisition_id', value: requisition.id }] });
      if (itemsError) throw new Error(itemsError.message);
      
      // Build items array for atomic RPC
      const items = (prItems || []).map(item => ({
        item_description: item.item_description,
        quantity: item.quantity,
        unit_price: item.estimated_unit_price || 0,
        product_id: item.jewelry_item_id || null,
        pr_item_id: item.id,
      }));

      const { data: result, error: rpcError } = await dataGateway.rpc('convert_pr_to_po_v2_atomic', {
        p_payload: {
          client_request_id: clientRequestId,
          requisition_id: requisition.id,
          branch_id: requisition.branch_id,
          expected_delivery_date: requisition.required_date,
          notes: `تم إنشاؤه من طلب الشراء: ${requisition.requisition_number}`,
          created_by: user!.id,
          items,
        },
      });

      if (rpcError) throw rpcError;
      
      const rpcResult = result as { 
        success: boolean; 
        order_id?: string; 
        order_number?: string; 
        error?: string;
        error_code?: string;
      };
      
      if (!rpcResult.success) {
        throw new Error(rpcResult.error || rpcResult.error_code || 'فشل في التحويل');
      }

      await logAudit({
        actionType: 'Convert',
        entityType: 'PurchaseRequisition',
        entityId: requisition.id,
        entityCode: requisition.requisition_number,
        description: `تحويل طلب الشراء إلى أمر شراء ${rpcResult.order_number}`,
        newValue: { po_id: rpcResult.order_id, po_number: rpcResult.order_number },
      });

      return { id: rpcResult.order_id, po_number: rpcResult.order_number };
    },
    onSuccess: (data) => {
      toast.success(`تم التحويل بنجاح - أمر الشراء: ${data.po_number}`);
      queryClient.invalidateQueries({ queryKey: ['purchase-requisitions'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل في التحويل');
    },
  });

  // Stats
  const stats = {
    total: allRequisitions.length,
    myRequests: allRequisitions.filter(r => r.requested_by === user?.id).length,
    pending: allRequisitions.filter(r => 
      ['pending', 'pending_dept_approval', 'pending_procurement', 'pending_management'].includes(r.status)
    ).length,
    approved: allRequisitions.filter(r => r.status === 'approved').length,
  };

  const handleOpenCreate = () => {
    setSelectedRequisition(null);
    setFormMode('create');
    setShowFormDialog(true);
  };

  const handleEdit = (req: Requisition) => {
    setSelectedRequisition(req);
    setFormMode('edit');
    setShowFormDialog(true);
  };

  const handleViewDetails = (req: Requisition) => {
    setSelectedRequisition(req);
    setShowDetailsDialog(true);
  };

  const handleOpenApproval = (req: Requisition) => {
    setSelectedRequisition(req);
    setShowApprovalDialog(true);
  };

  // Check user roles for approval permissions
  const { data: userRoles } = useQuery({
    queryKey: ['user-roles-for-approval', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await apiClient.get<string[]>('/api/user-roles-list', { user_id: user!.id });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  // Get user's department from employee record
  const { data: userEmployee } = useQuery({
    queryKey: ['user-employee', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await apiClient.get<any>('/api/user-employee-dept', { user_id: user!.id });
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const canApprove = (req: Requisition) => {
    if (isAdmin) return true;
    
    const isPending = ['pending', 'pending_dept_approval', 'pending_procurement', 'pending_management'].includes(req.status);
    if (!isPending) return false;

    const roles = userRoles || [];
    const currentLevel = req.current_approval_level || 0;
    
    // Level 0: Department Manager approval needed
    if (currentLevel === 0 && req.status === 'pending_dept_approval') {
      const isDeptManager = roles.some((r: string) => 
        ['Department Manager', 'مدير قسم', 'General Manager', 'المدير العام', 'Deputy General Manager', 'نائب المدير العام'].includes(r)
      );
      // Also check if same department
      if (isDeptManager && userEmployee?.department_id === req.department_id) {
        return true;
      }
      // General Manager can approve any department
      if (roles.some((r: string) => ['General Manager', 'المدير العام', 'Deputy General Manager', 'نائب المدير العام'].includes(r))) {
        return true;
      }
    }
    
    // Level 1: Procurement approval needed
    if (currentLevel === 1 && req.status === 'pending_procurement') {
      return roles.some((r: string) => 
        ['Purchasing Manager', 'مدير المشتريات', 'General Manager', 'المدير العام', 'Deputy General Manager', 'نائب المدير العام'].includes(r)
      );
    }
    
    // Level 2: Top Management approval needed
    if (currentLevel === 2 && req.status === 'pending_management') {
      return roles.some((r: string) => 
        ['General Manager', 'المدير العام', 'Deputy General Manager', 'نائب المدير العام', 'Financial Manager', 'المدير المالي'].includes(r)
      );
    }
    
    // Generic pending - allow managers
    if (req.status === 'pending') {
      return roles.some((r: string) => 
        ['General Manager', 'المدير العام', 'Purchasing Manager', 'مدير المشتريات'].includes(r)
      );
    }
    
    return false;
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="page-header-rtl">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="w-7 h-7 text-primary" />
              طلبات الشراء
            </h1>
            <p className="text-muted-foreground">إنشاء وإدارة طلبات الشراء مع نظام الموافقات</p>
          </div>
          <Button onClick={handleOpenCreate} className="gap-2">
            <Plus className="w-4 h-4" />
            طلب شراء جديد
          </Button>
        </div>

        {/* Stats */}
        <div className="stats-grid">
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab('all')}>
            <CardContent className="p-4">
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">إجمالي الطلبات</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab('my-requests')}>
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-blue-600">{stats.myRequests}</p>
              <p className="text-sm text-muted-foreground">طلباتي</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab('pending-approval')}>
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
              <p className="text-sm text-muted-foreground">في انتظار الموافقة</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab('reviewed')}>
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-green-600">{stats.approved}</p>
              <p className="text-sm text-muted-foreground">موافق عليها</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <TabsList>
              <TabsTrigger value="my-requests" className="gap-2">
                <ClipboardList className="w-4 h-4" />
                طلباتي
              </TabsTrigger>
              <TabsTrigger value="pending-approval" className="gap-2">
                <Clock className="w-4 h-4" />
                في انتظار الموافقة
              </TabsTrigger>
              <TabsTrigger value="reviewed" className="gap-2">
                <History className="w-4 h-4" />
                تمت مراجعتها
              </TabsTrigger>
              <TabsTrigger value="all" className="gap-2">
                <FileText className="w-4 h-4" />
                الكل
              </TabsTrigger>
            </TabsList>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="تصفية حسب الحالة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع الحالات</SelectItem>
                <SelectItem value="draft">مسودة</SelectItem>
                <SelectItem value="pending">في انتظار الموافقة</SelectItem>
                <SelectItem value="pending_dept_approval">انتظار مدير القسم</SelectItem>
                <SelectItem value="pending_procurement">انتظار المشتريات</SelectItem>
                <SelectItem value="pending_management">انتظار الإدارة</SelectItem>
                <SelectItem value="approved">موافق عليها</SelectItem>
                <SelectItem value="rejected">مرفوضة</SelectItem>
                <SelectItem value="partially_converted">محوّل جزئياً</SelectItem>
                <SelectItem value="fully_converted">محوّل بالكامل</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <TabsContent value={activeTab} className="mt-4">
            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                ) : requisitions.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>لا توجد طلبات شراء</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>رقم الطلب</TableHead>
                        <TableHead>الفرع</TableHead>
                        <TableHead>القسم</TableHead>
                        <TableHead>التاريخ</TableHead>
                        <TableHead>المبلغ التقديري</TableHead>
                        <TableHead>الأولوية</TableHead>
                        <TableHead>مستوى الموافقة</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead className="text-left">الإجراءات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {requisitions.map((req) => {
                        const status = statusConfig[req.status] || statusConfig.draft;
                        const priority = priorityConfig[req.priority] || priorityConfig.normal;
                        const StatusIcon = status.icon;

                        return (
                          <TableRow key={req.id}>
                            <TableCell className="font-mono">{req.requisition_number}</TableCell>
                            <TableCell>{req.branches?.branch_name || '-'}</TableCell>
                            <TableCell>{req.departments?.department_name || '-'}</TableCell>
                            <TableCell>
                              {format(new Date(req.request_date), 'dd/MM/yyyy', { locale: ar })}
                            </TableCell>
                            <TableCell>{req.total_estimated_amount?.toLocaleString()} ر.س</TableCell>
                            <TableCell>
                              <Badge className={priority.color}>{priority.label}</Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {req.current_approval_level || 0} / {req.required_approval_level || 1}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={`${status.color} gap-1`}>
                                <StatusIcon className="w-3 h-3" />
                                {status.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <RowActionsMenu
                                onPreview={() => handleViewDetails(req)}
                                onEdit={req.status === 'draft' && req.requested_by === user?.id 
                                  ? () => handleEdit(req) 
                                  : undefined}
                                onSubmit={req.status === 'draft' && req.requested_by === user?.id 
                                  ? () => submitMutation.mutate(req.id) 
                                  : undefined}
                                onDelete={req.status === 'draft' && req.requested_by === user?.id 
                                  ? () => {
                                      if (confirm('هل أنت متأكد من حذف هذا الطلب؟')) {
                                        deleteMutation.mutate(req.id);
                                      }
                                    } 
                                  : undefined}
                                onReview={canApprove(req) && ['pending', 'pending_dept_approval', 'pending_procurement', 'pending_management'].includes(req.status)
                                  ? () => handleOpenApproval(req) 
                                  : undefined}
                                onConvert={(req.status === 'approved' || req.status === 'partially_converted')
                                  ? () => navigate(`/purchasing/requisitions/convert/${req.id}`)
                                  : undefined}
                                isLoading={submitMutation.isPending ? 'submit' : deleteMutation.isPending ? 'delete' : null}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Form Dialog */}
        <PRFormDialog
          open={showFormDialog}
          onOpenChange={setShowFormDialog}
          requisition={selectedRequisition}
          mode={formMode}
        />

        {/* Details Dialog */}
        <PRDetailsDialog
          open={showDetailsDialog}
          onOpenChange={setShowDetailsDialog}
          requisition={selectedRequisition}
          statusConfig={statusConfig}
        />

        {/* Approval Dialog */}
        <PRApprovalDialog
          open={showApprovalDialog}
          onOpenChange={setShowApprovalDialog}
          requisitionId={selectedRequisition?.id || null}
          userProfile={userProfile}
        />
      </div>
    </MainLayout>
  );
}
