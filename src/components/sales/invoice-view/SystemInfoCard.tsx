import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Monitor, Hash, User, Database, Layers } from 'lucide-react';

interface SystemInfoCardProps {
  posStation?: string | null;
  cashierSession?: string | null;
  createdBy?: string | null;
  source: 'pos' | 'erp' | 'import' | 'api';
  saleId?: string | null;
  journalEntryId?: string | null;
}

const sourceConfig: Record<string, { label: string; color: string }> = {
  pos: { label: 'نقطة البيع', color: 'bg-blue-500' },
  erp: { label: 'النظام المحاسبي', color: 'bg-green-500' },
  import: { label: 'استيراد', color: 'bg-purple-500' },
  api: { label: 'واجهة برمجية', color: 'bg-orange-500' },
};

export default function SystemInfoCard({
  posStation,
  cashierSession,
  createdBy,
  source,
  saleId,
  journalEntryId,
}: SystemInfoCardProps) {
  const sourceInfo = sourceConfig[source] || sourceConfig.erp;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Monitor className="w-4 h-4" />
          معلومات النظام
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* Source */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground flex items-center gap-1">
            <Layers className="w-3 h-3" />
            مصدر الإنشاء:
          </span>
          <Badge className={`${sourceInfo.color} text-white`}>
            {sourceInfo.label}
          </Badge>
        </div>

        {/* POS Station */}
        {posStation && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Monitor className="w-3 h-3" />
              محطة البيع:
            </span>
            <code className="text-xs bg-muted px-2 py-0.5 rounded">
              {posStation}
            </code>
          </div>
        )}

        {/* Cashier Session */}
        {cashierSession && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Hash className="w-3 h-3" />
              جلسة الكاشير:
            </span>
            <code className="text-xs bg-muted px-2 py-0.5 rounded">
              {cashierSession}
            </code>
          </div>
        )}

        {/* Created By */}
        {createdBy && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <User className="w-3 h-3" />
              المستخدم:
            </span>
            <span className="font-medium">{createdBy}</span>
          </div>
        )}

        {/* Sale Reference (for POS) */}
        {saleId && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Database className="w-3 h-3" />
              مرجع المبيعات:
            </span>
            <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
              {saleId.slice(0, 8)}...
            </code>
          </div>
        )}

        {/* Journal Entry Reference */}
        {journalEntryId && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Database className="w-3 h-3" />
              القيد المحاسبي:
            </span>
            <Badge variant="outline" className="text-xs">
              مرحّل
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
