import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { listPOReceipts, type POReceiptDTO } from "@/domain/purchasing/purchasingReadService";

interface POReceiptsTabProps {
  poId: string;
}

export default function POReceiptsTab({ poId }: POReceiptsTabProps) {
  const { data: receipts, isLoading } = useQuery({
    queryKey: ["po-receipts", poId],
    queryFn: () => listPOReceipts({ poId }),
    enabled: !!poId,
  });

  const getItemTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      gold: "ذهب",
      raw_material: "خامات",
      gemstone: "أحجار كريمة",
    };
    return types[type] || type;
  };

  if (isLoading) {
    return <div className="text-center py-4">جاري التحميل...</div>;
  }

  if (!receipts?.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        لا توجد عمليات استلام مسجلة لهذا الأمر
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>رقم الاستلام</TableHead>
          <TableHead>النوع</TableHead>
          <TableHead>الكمية</TableHead>
          <TableHead>الوزن</TableHead>
          <TableHead>القيمة</TableHead>
          <TableHead>استلم بواسطة</TableHead>
          <TableHead>التاريخ</TableHead>
          <TableHead>ملاحظات</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {receipts.map((receipt: POReceiptDTO) => (
          <TableRow key={receipt.id}>
            <TableCell className="font-mono">{receipt.receiptNumber}</TableCell>
            <TableCell>
              <Badge variant="outline">{getItemTypeLabel(receipt.itemType)}</Badge>
            </TableCell>
            <TableCell>{receipt.quantityReceived || "-"}</TableCell>
            <TableCell>
              {receipt.weightReceived ? `${receipt.weightReceived.toFixed(2)} جرام` : "-"}
            </TableCell>
            <TableCell>{receipt.totalAmount?.toLocaleString()} ر.س</TableCell>
            <TableCell>{receipt.receivedBy || "-"}</TableCell>
            <TableCell>{format(new Date(receipt.createdAt), "yyyy-MM-dd HH:mm")}</TableCell>
            <TableCell className="max-w-32 truncate">{receipt.notes || "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
