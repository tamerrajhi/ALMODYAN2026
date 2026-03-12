import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Eye } from "lucide-react";
import { Link } from "react-router-dom";

interface POInvoicesTabProps {
  poId: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: string;
  paid_amount: number;
}

export default function POInvoicesTab({ poId }: POInvoicesTabProps) {
  const { data: invoices, isLoading } = useQuery({
    queryKey: ["po-invoices", poId],
    queryFn: async () => {
      const res = await fetch(`/api/po-invoices/${poId}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch PO invoices');
      return (await res.json()) as Invoice[];
    },
  });

  const getStatusBadge = (status: string) => {
    const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      draft: { label: "مسودة", variant: "secondary" },
      pending: { label: "قيد الانتظار", variant: "outline" },
      approved: { label: "معتمدة", variant: "default" },
      paid: { label: "مدفوعة", variant: "default" },
      partial: { label: "مدفوعة جزئياً", variant: "outline" },
      cancelled: { label: "ملغاة", variant: "destructive" },
    };
    const c = config[status] || { label: status, variant: "secondary" as const };
    return <Badge variant={c.variant}>{c.label}</Badge>;
  };

  if (isLoading) {
    return <div className="text-center py-4">جاري التحميل...</div>;
  }

  if (!invoices?.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        لا توجد فواتير مرتبطة بهذا الأمر
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>رقم الفاتورة</TableHead>
          <TableHead>التاريخ</TableHead>
          <TableHead>المبلغ قبل الضريبة</TableHead>
          <TableHead>الضريبة</TableHead>
          <TableHead>الإجمالي</TableHead>
          <TableHead>المدفوع</TableHead>
          <TableHead>الحالة</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((invoice) => (
          <TableRow key={invoice.id}>
            <TableCell className="font-mono">{invoice.invoice_number}</TableCell>
            <TableCell>{format(new Date(invoice.invoice_date), "yyyy-MM-dd")}</TableCell>
            <TableCell>{invoice.subtotal?.toLocaleString()} ر.س</TableCell>
            <TableCell>{invoice.tax_amount?.toLocaleString()} ر.س</TableCell>
            <TableCell className="font-medium">{invoice.total_amount?.toLocaleString()} ر.س</TableCell>
            <TableCell>{invoice.paid_amount?.toLocaleString()} ر.س</TableCell>
            <TableCell>{getStatusBadge(invoice.status)}</TableCell>
            <TableCell>
              <Button variant="ghost" size="icon" asChild>
                <Link to={`/purchasing/invoices/${invoice.id}`}>
                  <Eye className="h-4 w-4" />
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
