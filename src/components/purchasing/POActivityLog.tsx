import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { 
  FileText, 
  CheckCircle, 
  Edit, 
  Truck, 
  Send, 
  XCircle,
  Package
} from "lucide-react";

interface POActivityLogProps {
  poId: string;
}

interface AuditLog {
  id: string;
  action_type: string;
  description: string | null;
  user_name: string | null;
  created_at: string;
  new_value: Record<string, unknown> | null;
  old_value: Record<string, unknown> | null;
}

export default function POActivityLog({ poId }: POActivityLogProps) {
  const { data: logs, isLoading } = useQuery({
    queryKey: ["po-activity-log", poId],
    queryFn: async () => {
      const res = await fetch(`/api/po-audit-log/${poId}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch PO audit log');
      return (await res.json()) as AuditLog[];
    },
  });

  const getActionIcon = (action: string) => {
    const icons: Record<string, React.ReactNode> = {
      create: <FileText className="h-4 w-4 text-blue-600" />,
      update: <Edit className="h-4 w-4 text-amber-600" />,
      approve: <CheckCircle className="h-4 w-4 text-green-600" />,
      send_to_supplier: <Send className="h-4 w-4 text-purple-600" />,
      receive: <Truck className="h-4 w-4 text-cyan-600" />,
      cancel: <XCircle className="h-4 w-4 text-destructive" />,
      complete: <Package className="h-4 w-4 text-green-700" />,
    };
    return icons[action] || <FileText className="h-4 w-4" />;
  };

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      create: "إنشاء",
      update: "تعديل",
      approve: "اعتماد",
      send_to_supplier: "إرسال للمورد",
      receive: "استلام",
      cancel: "إلغاء",
      complete: "إكمال",
    };
    return labels[action] || action;
  };

  const getActionVariant = (action: string): "default" | "secondary" | "destructive" | "outline" => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      create: "secondary",
      update: "outline",
      approve: "default",
      send_to_supplier: "outline",
      receive: "default",
      cancel: "destructive",
      complete: "default",
    };
    return variants[action] || "secondary";
  };

  if (isLoading) {
    return <div className="text-center py-4">جاري التحميل...</div>;
  }

  if (!logs?.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        لا توجد حركات مسجلة لهذا الأمر
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {logs.map((log) => (
        <div key={log.id} className="flex items-start gap-4 p-4 border rounded-lg">
          <div className="mt-1">{getActionIcon(log.action_type)}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant={getActionVariant(log.action_type)}>
                {getActionLabel(log.action_type)}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {log.user_name || "النظام"}
              </span>
            </div>
            {log.description && (
              <p className="text-sm text-foreground">{log.description}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss")}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
