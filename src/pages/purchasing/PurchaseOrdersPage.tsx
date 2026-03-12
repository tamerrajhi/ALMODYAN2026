import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import MainLayout from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { RowActionsMenu } from "@/components/ui/RowActionsMenu";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { 
  listPurchaseOrders, 
  getPurchaseOrderForCreateForm,
  type PurchaseOrderDTO,
} from "@/domain/purchasing/purchasingReadService";
import { 
  createPurchaseOrder, 
  approvePurchaseOrder,
} from "@/domain/purchasing/purchasingWriteService";

export default function PurchaseOrdersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [formData, setFormData] = useState({
    supplier_id: "",
    branch_id: "",
    order_type: "gold",
    expected_delivery_date: "",
    notes: "",
  });

  // Fetch purchase orders via read service
  const { data: purchaseOrders, isLoading } = useQuery({
    queryKey: ["purchase-orders", statusFilter],
    queryFn: () => listPurchaseOrders({ status: statusFilter }),
  });

  // Fetch dropdown data via read service
  const { data: formDropdowns } = useQuery({
    queryKey: ["po-form-dropdowns"],
    queryFn: getPurchaseOrderForCreateForm,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const result = await createPurchaseOrder({
        supplierId: data.supplier_id || null,
        branchId: data.branch_id || null,
        orderType: data.order_type,
        expectedDeliveryDate: data.expected_delivery_date || null,
        notes: data.notes || null,
        createdBy: user?.email || "System",
      });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success("تم إنشاء أمر الشراء بنجاح");
      setIsCreateOpen(false);
      resetForm();
    },
    onError: (error) => {
      toast.error("فشل في إنشاء أمر الشراء: " + error.message);
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (poId: string) => {
      const result = await approvePurchaseOrder({
        poId,
        approvedBy: user?.id || "",
      });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success("تم اعتماد أمر الشراء");
    },
  });

  const resetForm = () => {
    setFormData({
      supplier_id: "",
      branch_id: "",
      order_type: "gold",
      expected_delivery_date: "",
      notes: "",
    });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      draft: { label: "مسودة", variant: "secondary" },
      pending: { label: "قيد الانتظار", variant: "outline" },
      approved: { label: "معتمد", variant: "default" },
      partially_received: { label: "مستلم جزئياً", variant: "outline" },
      received: { label: "مستلم", variant: "default" },
      cancelled: { label: "ملغي", variant: "destructive" },
    };
    const config = statusConfig[status] || { label: status, variant: "secondary" as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getOrderTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      gold: "ذهب",
      raw_material: "خامات",
      gemstone: "أحجار كريمة",
      mixed: "مختلط",
    };
    return types[type] || type;
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="page-header-rtl">
          <h1 className="text-2xl font-bold">أوامر الشراء</h1>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                أمر شراء جديد
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>إنشاء أمر شراء جديد</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>المورد</Label>
                  <Select
                    value={formData.supplier_id}
                    onValueChange={(v) => setFormData({ ...formData, supplier_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر المورد" />
                    </SelectTrigger>
                    <SelectContent>
                      {formDropdowns?.suppliers?.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.supplierName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>الفرع</Label>
                  <Select
                    value={formData.branch_id}
                    onValueChange={(v) => setFormData({ ...formData, branch_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الفرع" />
                    </SelectTrigger>
                    <SelectContent>
                      {formDropdowns?.branches?.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.branchName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>نوع الطلب</Label>
                  <Select
                    value={formData.order_type}
                    onValueChange={(v) => setFormData({ ...formData, order_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gold">ذهب</SelectItem>
                      <SelectItem value="raw_material">خامات</SelectItem>
                      <SelectItem value="gemstone">أحجار كريمة</SelectItem>
                      <SelectItem value="mixed">مختلط</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>تاريخ التسليم المتوقع</Label>
                  <Input
                    type="date"
                    value={formData.expected_delivery_date}
                    onChange={(e) => setFormData({ ...formData, expected_delivery_date: e.target.value })}
                  />
                </div>

                <div>
                  <Label>ملاحظات</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="ملاحظات إضافية..."
                  />
                </div>

                <Button
                  className="w-full"
                  onClick={() => createMutation.mutate(formData)}
                  disabled={createMutation.isPending}
                >
                  إنشاء أمر الشراء
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex gap-4 items-center">
              <Label>تصفية حسب الحالة:</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="draft">مسودة</SelectItem>
                  <SelectItem value="pending">قيد الانتظار</SelectItem>
                  <SelectItem value="approved">معتمد</SelectItem>
                  <SelectItem value="partially_received">مستلم جزئياً</SelectItem>
                  <SelectItem value="received">مستلم</SelectItem>
                  <SelectItem value="cancelled">ملغي</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Orders Table */}
        <Card>
          <CardHeader>
            <CardTitle>قائمة أوامر الشراء</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الأمر</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>الفرع</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>تاريخ الطلب</TableHead>
                  <TableHead>تاريخ التسليم</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center">جاري التحميل...</TableCell>
                  </TableRow>
                ) : purchaseOrders?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center">لا توجد أوامر شراء</TableCell>
                  </TableRow>
                ) : (
                  purchaseOrders?.map((po: PurchaseOrderDTO) => (
                    <TableRow key={po.id}>
                      <TableCell className="font-mono">{po.poNumber}</TableCell>
                      <TableCell>{po.supplierName || "-"}</TableCell>
                      <TableCell>{po.branchName || "-"}</TableCell>
                      <TableCell>{getOrderTypeLabel(po.orderType)}</TableCell>
                      <TableCell>{format(new Date(po.orderDate), "yyyy-MM-dd")}</TableCell>
                      <TableCell>
                        {po.expectedDeliveryDate
                          ? format(new Date(po.expectedDeliveryDate), "yyyy-MM-dd")
                          : "-"}
                      </TableCell>
                      <TableCell>{po.totalAmount?.toLocaleString()} ر.س</TableCell>
                      <TableCell>{getStatusBadge(po.status)}</TableCell>
                      <TableCell>
                        <RowActionsMenu
                          onPreview={() => navigate(`/purchasing/orders/${po.id}`)}
                          onApprove={po.status === "draft" ? () => approveMutation.mutate(po.id) : undefined}
                          onReceive={po.status === "approved" ? () => navigate(`/purchasing/receive/${po.id}`) : undefined}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
