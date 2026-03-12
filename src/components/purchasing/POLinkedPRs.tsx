import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Eye } from "lucide-react";
import { Link } from "react-router-dom";

interface POLinkedPRsProps {
  poId: string;
}

interface LinkedPR {
  id: string;
  pr_id: string;
  purchase_requisition: {
    pr_number: string;
    request_date: string;
    status: string;
    total_amount: number | null;
    requester_name: string | null;
    department: { department_name: string } | null;
  } | null;
}

export default function POLinkedPRs({ poId }: POLinkedPRsProps) {
  const { data: links, isLoading } = useQuery({
    queryKey: ["po-linked-prs", poId],
    queryFn: async () => {
      const res = await fetch(`/api/po-linked-prs/${poId}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch PO linked PRs');
      const rows = await res.json();
      return rows.map((r: any) => ({
        id: r.id,
        pr_id: r.pr_id,
        purchase_requisition: r.pr_number ? {
          pr_number: r.pr_number,
          request_date: r.request_date,
          status: r.status,
          total_amount: r.total_amount,
          requester_name: r.requester_name,
          department: r.department_name ? { department_name: r.department_name } : null,
        } : null,
      })) as LinkedPR[];
    },
  });

  const getStatusBadge = (status: string) => {
    const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      draft: { label: "مسودة", variant: "secondary" },
      pending: { label: "قيد الانتظار", variant: "outline" },
      approved: { label: "معتمد", variant: "default" },
      rejected: { label: "مرفوض", variant: "destructive" },
      converted: { label: "تم التحويل", variant: "default" },
    };
    const c = config[status] || { label: status, variant: "secondary" as const };
    return <Badge variant={c.variant}>{c.label}</Badge>;
  };

  if (isLoading) {
    return <div className="text-center py-4">جاري التحميل...</div>;
  }

  if (!links?.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        لا توجد طلبات شراء مرتبطة بهذا الأمر
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>رقم الطلب</TableHead>
          <TableHead>التاريخ</TableHead>
          <TableHead>القسم</TableHead>
          <TableHead>الطالب</TableHead>
          <TableHead>القيمة</TableHead>
          <TableHead>الحالة</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {links.map((link) => {
          const pr = link.purchase_requisition;
          if (!pr) return null;
          return (
            <TableRow key={link.id}>
              <TableCell className="font-mono">{pr.pr_number}</TableCell>
              <TableCell>{format(new Date(pr.request_date), "yyyy-MM-dd")}</TableCell>
              <TableCell>{pr.department?.department_name || "-"}</TableCell>
              <TableCell>{pr.requester_name || "-"}</TableCell>
              <TableCell>{pr.total_amount?.toLocaleString()} ر.س</TableCell>
              <TableCell>{getStatusBadge(pr.status)}</TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" asChild>
                  <Link to={`/purchasing/requisitions?view=${link.pr_id}`}>
                    <Eye className="h-4 w-4" />
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
