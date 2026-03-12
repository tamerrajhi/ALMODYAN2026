import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import MainLayout from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowRight, Check, Package } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getPOForReceive,
  type POItemForReceiveDTO,
} from "@/domain/purchasing/purchasingReadService";
import { receivePOItems } from "@/domain/purchasing/purchasingWriteService";

interface ReceiptItem {
  quantity: number;
  weight: number;
  rejectedQty: number;
  notes: string;
  warehouseId?: string;
}

export default function ReceivePurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [selectedVault, setSelectedVault] = useState("");
  const [generalNotes, setGeneralNotes] = useState("");
  const [receiptItems, setReceiptItems] = useState<Record<string, ReceiptItem>>({});

  const { data: poData } = useQuery({
    queryKey: ["po-for-receive", id],
    queryFn: () => getPOForReceive(id!),
    enabled: !!id,
  });

  const po = poData?.po;
  const items = poData?.items;
  const goldVaults = poData?.goldVaults;

  const receiveMutation = useMutation({
    mutationFn: async () => {
      if (!po) throw new Error("أمر الشراء غير موجود");
      
      const itemsToReceive = Object.entries(receiptItems).filter(
        ([_, data]) => data.quantity > 0 || data.weight > 0
      );

      if (itemsToReceive.length === 0) {
        throw new Error("يرجى تحديد الكميات المستلمة");
      }

      // Build command items
      const commandItems = itemsToReceive.map(([itemId, data]) => {
        const item = items?.find(i => i.id === itemId);
        if (!item) throw new Error(`Item not found: ${itemId}`);

        return {
          itemId,
          itemType: item.itemType,
          description: item.description,
          quantityOrdered: item.quantity,
          weightOrdered: item.weightGrams,
          quantityReceived: data.quantity,
          weightReceived: data.weight,
          quantityRejected: data.rejectedQty || 0,
          unitPrice: item.unitPrice,
          karatId: item.karatId,
          gemstoneTypeId: item.gemstoneTypeId,
          gemstoneTypeName: item.gemstoneTypeName,
          warehouseId: item.warehouseId,
          notes: data.notes,
          previousReceivedQty: item.receivedQuantity,
          previousReceivedWeight: item.receivedWeight,
        };
      });

      const result = await receivePOItems({
        poId: po.id,
        poNumber: po.poNumber,
        supplierId: po.supplierId,
        supplierName: po.supplierName,
        branchId: po.branchId,
        defaultWarehouseId: po.defaultWarehouseId,
        selectedVaultId: selectedVault || null,
        generalNotes,
        items: commandItems,
        receivedBy: user?.id || null,
        receivedByName: user?.email || null,
      });

      if (!result.success) {
        throw new Error(result.error || 'فشل في استلام البضاعة');
      }

      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["po-for-receive", id] });
      queryClient.invalidateQueries({ queryKey: ["purchase-order", id] });
      queryClient.invalidateQueries({ queryKey: ["goods-receipts", id] });
      toast.success(`تم استلام البضاعة بنجاح - رقم الاستلام: ${result.grnNumber}`);
      navigate(`/purchasing/orders/${id}`);
    },
    onError: (error: Error) => {
      toast.error("فشل في استلام البضاعة: " + error.message);
    },
  });

  const updateReceiptItem = (itemId: string, field: keyof ReceiptItem, value: number | string) => {
    setReceiptItems(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId] || { quantity: 0, weight: 0, rejectedQty: 0, notes: "" },
        [field]: value,
      },
    }));
  };

  const receiveAll = (itemId: string, item: POItemForReceiveDTO) => {
    const remainingWeight = (item.weightGrams || 0) - (item.receivedWeight || 0);
    const remainingQty = (item.quantity || 0) - (item.receivedQuantity || 0);
    
    setReceiptItems(prev => ({
      ...prev,
      [itemId]: {
        quantity: remainingQty,
        weight: remainingWeight,
        rejectedQty: 0,
        notes: "",
        warehouseId: item.warehouseId || undefined,
      },
    }));
  };

  const getItemTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      gold: "ذهب",
      raw_material: "خامات",
      gemstone: "أحجار كريمة",
    };
    return types[type] || type;
  };

  const validateReceiptItems = () => {
    for (const [itemId, data] of Object.entries(receiptItems)) {
      const item = items?.find(i => i.id === itemId);
      if (!item) continue;

      const remainingWeight = (item.weightGrams || 0) - (item.receivedWeight || 0);
      const remainingQty = (item.quantity || 0) - (item.receivedQuantity || 0);

      if (data.weight > remainingWeight) {
        toast.error(`الوزن المستلم للبند "${item.description}" أكبر من المتبقي`);
        return false;
      }
      if (data.quantity > remainingQty) {
        toast.error(`الكمية المستلمة للبند "${item.description}" أكبر من المتبقية`);
        return false;
      }
    }
    return true;
  };

  const handleSubmit = () => {
    if (validateReceiptItems()) {
      receiveMutation.mutate();
    }
  };

  return (
    <MainLayout>
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate(`/purchasing/orders/${id}`)}>
            <ArrowRight className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Package className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">استلام البضاعة (GRN)</h1>
              <p className="text-muted-foreground">أمر الشراء: {po?.poNumber}</p>
            </div>
          </div>
        </div>

        {/* PO Info */}
        <Card>
          <CardHeader>
            <CardTitle>معلومات أمر الشراء</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-muted-foreground">المورد</Label>
                <p className="font-medium">{po?.supplierName || "-"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">الفرع</Label>
                <p className="font-medium">{po?.branchName || "-"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">عدد البنود</Label>
                <p className="font-medium">{items?.length || 0}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">البنود المتبقية للاستلام</Label>
                <p className="font-medium text-amber-600">{items?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Vault Selection for Gold */}
        {items?.some(i => i.itemType === "gold") && (
          <Card>
            <CardHeader>
              <CardTitle>خزنة الذهب</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-w-md">
                <Label>اختر الخزنة لاستلام الذهب</Label>
                <Select value={selectedVault} onValueChange={setSelectedVault}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر الخزنة" />
                  </SelectTrigger>
                  <SelectContent>
                    {goldVaults?.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.vaultName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Items to Receive */}
        <Card>
          <CardHeader>
            <CardTitle>الأصناف المطلوب استلامها</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>النوع</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead>المطلوب</TableHead>
                  <TableHead>المستلم سابقاً</TableHead>
                  <TableHead>المتبقي</TableHead>
                  <TableHead>الكمية المستلمة</TableHead>
                  <TableHead>الوزن المستلم</TableHead>
                  <TableHead>المرفوض</TableHead>
                  <TableHead>ملاحظات</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items?.map((item) => {
                  const remainingWeight = (item.weightGrams || 0) - (item.receivedWeight || 0);
                  const remainingQty = (item.quantity || 0) - (item.receivedQuantity || 0);
                  const receiptData = receiptItems[item.id] || { quantity: 0, weight: 0, rejectedQty: 0, notes: "" };

                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Badge variant="outline">{getItemTypeLabel(item.itemType)}</Badge>
                        {item.karatName && (
                          <span className="text-xs text-muted-foreground mr-1">({item.karatName})</span>
                        )}
                        {item.gemstoneTypeName && (
                          <span className="text-xs text-muted-foreground mr-1">({item.gemstoneTypeName})</span>
                        )}
                      </TableCell>
                      <TableCell>{item.description || "-"}</TableCell>
                      <TableCell>
                        {item.itemType === "gold" 
                          ? `${item.weightGrams?.toFixed(2) || 0} جم`
                          : `${item.quantity} قطعة`
                        }
                      </TableCell>
                      <TableCell>
                        {item.itemType === "gold"
                          ? `${item.receivedWeight?.toFixed(2) || 0} جم`
                          : `${item.receivedQuantity} قطعة`
                        }
                      </TableCell>
                      <TableCell className="font-medium text-amber-600">
                        {item.itemType === "gold"
                          ? `${remainingWeight.toFixed(2)} جم`
                          : `${remainingQty} قطعة`
                        }
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={remainingQty}
                          value={receiptData.quantity || ""}
                          onChange={(e) => updateReceiptItem(item.id, "quantity", Number(e.target.value))}
                          className="w-20"
                          disabled={item.itemType === "gold"}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={remainingWeight}
                          step={0.01}
                          value={receiptData.weight || ""}
                          onChange={(e) => updateReceiptItem(item.id, "weight", Number(e.target.value))}
                          className="w-24"
                          disabled={item.itemType !== "gold"}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          value={receiptData.rejectedQty || ""}
                          onChange={(e) => updateReceiptItem(item.id, "rejectedQty", Number(e.target.value))}
                          className="w-20"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={receiptData.notes || ""}
                          onChange={(e) => updateReceiptItem(item.id, "notes", e.target.value)}
                          placeholder="ملاحظات"
                          className="w-32"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => receiveAll(item.id, item)}
                        >
                          <Check className="h-4 w-4 ml-1" />
                          استلام الكل
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader>
            <CardTitle>ملاحظات عامة</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={generalNotes}
              onChange={(e) => setGeneralNotes(e.target.value)}
              placeholder="أي ملاحظات إضافية عن عملية الاستلام..."
              rows={3}
            />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button
            variant="outline"
            onClick={() => navigate(`/purchasing/orders/${id}`)}
          >
            إلغاء
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={receiveMutation.isPending}
          >
            {receiveMutation.isPending ? "جارٍ الحفظ..." : "تأكيد الاستلام"}
          </Button>
        </div>
      </div>
    </MainLayout>
  );
}
