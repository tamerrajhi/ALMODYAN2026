import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import MainLayout from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, ArrowRight, Trash2, Copy, Send, FileText, Truck, Receipt, History } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import POReceiptsTab from "@/components/purchasing/POReceiptsTab";
import POInvoicesTab from "@/components/purchasing/POInvoicesTab";
import POActivityLog from "@/components/purchasing/POActivityLog";
import POLinkedPRs from "@/components/purchasing/POLinkedPRs";

// DTO-first imports
import { getPurchaseOrderDetail, type PODetailDataDTO, type POItemDTO } from "@/domain/purchasing/purchasingReadService";
import {
  addPOItem,
  duplicatePOItem,
  deletePOItem,
  submitPOForApproval,
  approvePurchaseOrder,
  sendPOToSupplier,
} from "@/domain/purchasing/purchasingWriteService";

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("items");

  const [itemForm, setItemForm] = useState({
    item_type: "gold",
    description: "",
    karat_id: "",
    gemstone_type_id: "",
    raw_material_id: "",
    quantity: 1,
    weight_grams: 0,
    unit_price: 0,
  });

  // Main data fetch via DTO service
  const { data: detailData, isLoading } = useQuery({
    queryKey: ["purchase-order-detail", id],
    queryFn: () => getPurchaseOrderDetail(id!),
    enabled: !!id,
  });

  const po = detailData?.po;
  const items = detailData?.items;
  const linkedPRsCount = detailData?.linkedPRsCount ?? 0;
  const dropdowns = detailData?.dropdowns;

  // Write mutations using service layer
  const addItemMutation = useMutation({
    mutationFn: async (data: typeof itemForm) => {
      const result = await addPOItem({
        poId: id!,
        itemType: data.item_type,
        description: data.description || null,
        karatId: data.karat_id || null,
        gemstoneTypeId: data.gemstone_type_id || null,
        rawMaterialId: data.raw_material_id || null,
        quantity: data.quantity,
        weightGrams: data.weight_grams || null,
        unitPrice: data.unit_price,
        currentTotalAmount: po?.totalAmount || 0,
        currentTotalGoldWeight: po?.totalGoldWeight || 0,
      });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-order-detail", id] });
      toast.success("تمت إضافة الصنف");
      setIsAddItemOpen(false);
      resetItemForm();
    },
    onError: (error: Error) => {
      toast.error("فشل في إضافة الصنف: " + error.message);
    },
  });

  const duplicateItemMutation = useMutation({
    mutationFn: async (item: POItemDTO) => {
      const result = await duplicatePOItem({
        poId: id!,
        sourceItemId: item.id,
        itemType: item.itemType,
        description: item.description,
        karatId: item.karatId,
        gemstoneTypeId: item.gemstoneTypeId,
        rawMaterialId: item.rawMaterialId,
        quantity: item.quantity,
        weightGrams: item.weightGrams,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        currentTotalAmount: po?.totalAmount || 0,
        currentTotalGoldWeight: po?.totalGoldWeight || 0,
      });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-order-detail", id] });
      toast.success("تم نسخ الصنف");
    },
    onError: (error: Error) => {
      toast.error("فشل في نسخ الصنف: " + error.message);
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (item: POItemDTO) => {
      const result = await deletePOItem({
        poId: id!,
        itemId: item.id,
        itemType: item.itemType,
        totalPrice: item.totalPrice || 0,
        weightGrams: item.weightGrams,
        currentTotalAmount: po?.totalAmount || 0,
        currentTotalGoldWeight: po?.totalGoldWeight || 0,
      });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-order-detail", id] });
      toast.success("تم حذف الصنف");
    },
    onError: (error: Error) => {
      toast.error("فشل في حذف الصنف: " + error.message);
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const result = await submitPOForApproval({
        poId: id!,
        poNumber: po?.poNumber || '',
      });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-order-detail", id] });
      toast.success("تم إرسال أمر الشراء للاعتماد");
    },
    onError: (error: Error) => {
      toast.error("فشل في إرسال أمر الشراء: " + error.message);
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const result = await approvePurchaseOrder({
        poId: id!,
        approvedBy: user?.id || '',
      });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-order-detail", id] });
      toast.success("تم اعتماد أمر الشراء");
    },
    onError: (error: Error) => {
      toast.error("فشل في اعتماد أمر الشراء: " + error.message);
    },
  });

  const sendToSupplierMutation = useMutation({
    mutationFn: async () => {
      const result = await sendPOToSupplier({
        poId: id!,
        poNumber: po?.poNumber || '',
      });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-order-detail", id] });
      toast.success("تم تسجيل إرسال الأمر للمورد");
    },
    onError: (error: Error) => {
      toast.error("فشل في تسجيل الإرسال: " + error.message);
    },
  });

  const resetItemForm = () => {
    setItemForm({
      item_type: "gold",
      description: "",
      karat_id: "",
      gemstone_type_id: "",
      raw_material_id: "",
      quantity: 1,
      weight_grams: 0,
      unit_price: 0,
    });
  };

  const getItemTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      gold: "ذهب",
      raw_material: "خامات",
      gemstone: "أحجار كريمة",
    };
    return types[type] || type;
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      draft: { label: "مسودة", variant: "secondary" },
      pending: { label: "قيد الانتظار", variant: "outline" },
      approved: { label: "معتمد", variant: "default" },
      partially_received: { label: "مستلم جزئياً", variant: "outline" },
      received: { label: "مستلم", variant: "default" },
      closed: { label: "مغلق", variant: "secondary" },
      cancelled: { label: "ملغي", variant: "destructive" },
    };
    const config = statusConfig[status] || { label: status, variant: "secondary" as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">جاري التحميل...</div>
      </MainLayout>
    );
  }

  if (!po) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">لم يتم العثور على أمر الشراء</div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="page-header-rtl">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate("/purchasing/orders")}>
              <ArrowRight className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">أمر الشراء: {po.poNumber}</h1>
              <p className="text-muted-foreground">
                {po.supplierName} - {po.branchName}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {po.status === "approved" && !po.sentToSupplier && (
              <Button 
                variant="outline" 
                onClick={() => sendToSupplierMutation.mutate()}
                disabled={sendToSupplierMutation.isPending}
              >
                <Send className="h-4 w-4 ml-2" />
                إرسال للمورد
              </Button>
            )}
            {po.status === "draft" && (
              <>
                <Button variant="outline" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
                  إرسال للاعتماد
                </Button>
                <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
                  اعتماد
                </Button>
              </>
            )}
            {po.status === "pending" && (
              <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
                اعتماد
              </Button>
            )}
            {(po.status === "approved" || po.status === "partially_received") && (
              <Button onClick={() => navigate(`/purchasing/receive/${id}`)}>
                <Truck className="h-4 w-4 ml-2" />
                استلام البضاعة
              </Button>
            )}
            {po.status === "approved" && (
              <Button variant="outline" asChild>
                <Link to={`/purchasing/invoices/new?po=${id}`}>
                  <Receipt className="h-4 w-4 ml-2" />
                  إنشاء فاتورة
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Order Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">الحالة</div>
              <div className="mt-1">{getStatusBadge(po.status)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">تاريخ الطلب</div>
              <div className="font-medium">{po.orderDate ? format(new Date(po.orderDate), "yyyy-MM-dd") : "-"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">إجمالي الوزن (ذهب)</div>
              <div className="font-medium">{po.totalGoldWeight.toFixed(2)} جرام</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">إجمالي القيمة</div>
              <div className="font-medium">{po.totalAmount.toLocaleString()} ر.س</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">أرسل للمورد</div>
              <div className="font-medium">
                {po.sentToSupplier ? (
                  <Badge variant="default">نعم - {po.sentAt ? format(new Date(po.sentAt), "yyyy-MM-dd") : ""}</Badge>
                ) : (
                  <Badge variant="secondary">لا</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* PR Reference */}
        {linkedPRsCount > 0 && (
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  مرتبط بـ {linkedPRsCount} طلب شراء
                </span>
                <Button variant="link" size="sm" onClick={() => setActiveTab("linked-prs")}>
                  عرض التفاصيل
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="items" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              البنود
            </TabsTrigger>
            <TabsTrigger value="receipts" className="flex items-center gap-2">
              <Truck className="h-4 w-4" />
              الاستلامات
            </TabsTrigger>
            <TabsTrigger value="invoices" className="flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              الفواتير
            </TabsTrigger>
            <TabsTrigger value="linked-prs" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              طلبات الشراء
            </TabsTrigger>
            <TabsTrigger value="activity" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              سجل الحركات
            </TabsTrigger>
          </TabsList>

          {/* Items Tab */}
          <TabsContent value="items">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>بنود أمر الشراء</CardTitle>
                {(po.status === "draft" || po.status === "pending") && (
                  <Dialog open={isAddItemOpen} onOpenChange={setIsAddItemOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <Plus className="h-4 w-4 mr-2" />
                        إضافة صنف
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>إضافة صنف جديد</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>نوع الصنف</Label>
                          <Select
                            value={itemForm.item_type}
                            onValueChange={(v) => setItemForm({ ...itemForm, item_type: v })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="gold">ذهب</SelectItem>
                              <SelectItem value="raw_material">خامات</SelectItem>
                              <SelectItem value="gemstone">أحجار كريمة</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {itemForm.item_type === "gold" && (
                          <div>
                            <Label>العيار</Label>
                            <Select
                              value={itemForm.karat_id}
                              onValueChange={(v) => setItemForm({ ...itemForm, karat_id: v })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="اختر العيار" />
                              </SelectTrigger>
                              <SelectContent>
                                {dropdowns?.karats.map((k) => (
                                  <SelectItem key={k.id} value={k.id}>{k.karatName}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {itemForm.item_type === "gemstone" && (
                          <div>
                            <Label>نوع الحجر</Label>
                            <Select
                              value={itemForm.gemstone_type_id}
                              onValueChange={(v) => setItemForm({ ...itemForm, gemstone_type_id: v })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="اختر نوع الحجر" />
                              </SelectTrigger>
                              <SelectContent>
                                {dropdowns?.gemstoneTypes.map((g) => (
                                  <SelectItem key={g.id} value={g.id}>{g.typeName}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {itemForm.item_type === "raw_material" && (
                          <div>
                            <Label>نوع الخام</Label>
                            <Select
                              value={itemForm.raw_material_id}
                              onValueChange={(v) => setItemForm({ ...itemForm, raw_material_id: v })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="اختر نوع الخام" />
                              </SelectTrigger>
                              <SelectContent>
                                {dropdowns?.rawMaterials.map((r) => (
                                  <SelectItem key={r.id} value={r.id}>{r.materialName}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        <div>
                          <Label>الوصف</Label>
                          <Input
                            value={itemForm.description}
                            onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                            placeholder="وصف الصنف"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>الكمية</Label>
                            <Input
                              type="number"
                              min="1"
                              value={itemForm.quantity}
                              onChange={(e) => setItemForm({ ...itemForm, quantity: Number(e.target.value) })}
                            />
                          </div>
                          <div>
                            <Label>الوزن (جرام)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={itemForm.weight_grams}
                              onChange={(e) => setItemForm({ ...itemForm, weight_grams: Number(e.target.value) })}
                            />
                          </div>
                        </div>

                        <div>
                          <Label>سعر الوحدة / الجرام</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={itemForm.unit_price}
                            onChange={(e) => setItemForm({ ...itemForm, unit_price: Number(e.target.value) })}
                          />
                        </div>

                        <div className="bg-muted p-3 rounded-lg">
                          <div className="text-sm text-muted-foreground">الإجمالي</div>
                          <div className="text-lg font-bold">
                            {(itemForm.weight_grams > 0
                              ? itemForm.weight_grams * itemForm.unit_price
                              : itemForm.quantity * itemForm.unit_price
                            ).toLocaleString()} ر.س
                          </div>
                        </div>

                        <Button
                          className="w-full"
                          onClick={() => addItemMutation.mutate(itemForm)}
                          disabled={addItemMutation.isPending}
                        >
                          إضافة الصنف
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>النوع</TableHead>
                      <TableHead>الوصف</TableHead>
                      <TableHead>العيار/النوع</TableHead>
                      <TableHead>الكمية</TableHead>
                      <TableHead>الوزن</TableHead>
                      <TableHead>سعر الوحدة</TableHead>
                      <TableHead>الإجمالي</TableHead>
                      <TableHead>مستلم</TableHead>
                      <TableHead>المتبقي</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!items || items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center">لا توجد أصناف</TableCell>
                      </TableRow>
                    ) : (
                      items.map((item) => {
                        const remainingWeight = (item.weightGrams || 0) - (item.receivedWeight || 0);
                        const remainingQty = (item.quantity || 0) - (item.receivedQuantity || 0);
                        
                        return (
                          <TableRow key={item.id}>
                            <TableCell>{getItemTypeLabel(item.itemType)}</TableCell>
                            <TableCell>{item.description || "-"}</TableCell>
                            <TableCell>
                              {item.karatName || item.gemstoneTypeName || "-"}
                            </TableCell>
                            <TableCell>{item.quantity}</TableCell>
                            <TableCell>{item.weightGrams?.toFixed(2) || "-"} جرام</TableCell>
                            <TableCell>{item.unitPrice?.toLocaleString()} ر.س</TableCell>
                            <TableCell>{item.totalPrice?.toLocaleString()} ر.س</TableCell>
                            <TableCell>
                              {item.receivedWeight > 0 
                                ? `${item.receivedWeight.toFixed(2)} جرام` 
                                : item.receivedQuantity > 0 
                                  ? item.receivedQuantity 
                                  : "-"}
                            </TableCell>
                            <TableCell className="text-amber-600 font-medium">
                              {item.itemType === "gold" 
                                ? `${remainingWeight.toFixed(2)} جرام`
                                : remainingQty}
                            </TableCell>
                            <TableCell>
                              <Badge variant={item.status === "received" ? "default" : "secondary"}>
                                {item.status === "pending" ? "قيد الانتظار" : 
                                 item.status === "partially_received" ? "مستلم جزئياً" :
                                 item.status === "received" ? "مستلم" : item.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {(po.status === "draft" || po.status === "pending") && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => duplicateItemMutation.mutate(item)}
                                      disabled={duplicateItemMutation.isPending}
                                      title="نسخ البند"
                                    >
                                      <Copy className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => deleteItemMutation.mutate(item)}
                                      disabled={deleteItemMutation.isPending}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Receipts Tab */}
          <TabsContent value="receipts">
            <Card>
              <CardHeader>
                <CardTitle>عمليات الاستلام</CardTitle>
              </CardHeader>
              <CardContent>
                <POReceiptsTab poId={id!} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Invoices Tab */}
          <TabsContent value="invoices">
            <Card>
              <CardHeader>
                <CardTitle>الفواتير المرتبطة</CardTitle>
              </CardHeader>
              <CardContent>
                <POInvoicesTab poId={id!} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Linked PRs Tab */}
          <TabsContent value="linked-prs">
            <Card>
              <CardHeader>
                <CardTitle>طلبات الشراء المرتبطة</CardTitle>
              </CardHeader>
              <CardContent>
                <POLinkedPRs poId={id!} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Activity Log Tab */}
          <TabsContent value="activity">
            <Card>
              <CardHeader>
                <CardTitle>سجل الحركات</CardTitle>
              </CardHeader>
              <CardContent>
                <POActivityLog poId={id!} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
