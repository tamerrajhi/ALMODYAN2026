import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Wallet,
  Coins,
  Tag,
  Package,
  Building2,
  Users,
  CreditCard,
  Factory,
  FileText,
  RotateCcw,
  Lock,
  Ban,
  Check,
  AlertTriangle,
} from 'lucide-react';
import type { AccountLinkageResult } from '@/lib/account-linkage-check';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_name_en: string | null;
  account_type: AccountType;
  parent_id: string | null;
  is_active: boolean;
  is_system: boolean;
  description: string | null;
  current_balance: number;
  entry_count?: number;
}

interface AccountPreviewDialogProps {
  account: Account | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkages: AccountLinkageResult | null;
}

const accountTypeLabels: Record<AccountType, string> = {
  asset: 'أصول',
  liability: 'خصوم',
  equity: 'حقوق ملكية',
  revenue: 'إيرادات',
  expense: 'مصروفات',
};

const accountTypeColors: Record<AccountType, string> = {
  asset: 'bg-blue-500/20 text-blue-400',
  liability: 'bg-red-500/20 text-red-400',
  equity: 'bg-purple-500/20 text-purple-400',
  revenue: 'bg-green-500/20 text-green-400',
  expense: 'bg-orange-500/20 text-orange-400',
};

export default function AccountPreviewDialog({
  account,
  open,
  onOpenChange,
  linkages,
}: AccountPreviewDialogProps) {
  if (!account) return null;

  const linkageItems = linkages
    ? [
        { label: 'خزائن نقدية', count: linkages.linkedEntities.cashVaults, icon: Wallet },
        { label: 'خزائن ذهب', count: linkages.linkedEntities.goldVaults, icon: Coins },
        { label: 'بنود تكلفة', count: linkages.linkedEntities.costEntries, icon: Tag },
        { label: 'أصناف مجوهرات', count: linkages.linkedEntities.jewelryItems, icon: Package },
        { label: 'منتجات', count: linkages.linkedEntities.products, icon: Package },
        { label: 'حسابات مخزون فروع', count: linkages.linkedEntities.branchInventory, icon: Building2 },
        { label: 'موردين', count: linkages.linkedEntities.suppliers, icon: Users },
        { label: 'إعدادات الدفع', count: linkages.linkedEntities.paymentSettings, icon: CreditCard },
        { label: 'إعدادات الإنتاج', count: linkages.linkedEntities.productionSettings, icon: Factory },
        { label: 'فواتير مشتريات', count: linkages.linkedEntities.purchaseInvoiceLines, icon: FileText },
        { label: 'مرتجعات', count: linkages.linkedEntities.returns, icon: RotateCcw },
      ].filter(item => item.count > 0)
    : [];

  const getStatusBadge = () => {
    if (!linkages) return null;

    if (linkages.isSystem) {
      return (
        <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30 gap-1">
          <Lock className="h-3 w-3" />
          حساب نظامي
        </Badge>
      );
    }

    if (!linkages.canDelete) {
      return (
        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 gap-1">
          <Ban className="h-3 w-3" />
          محمي من الحذف
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30 gap-1">
        <Check className="h-3 w-3" />
        قابل للتعديل والحذف
      </Badge>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>معاينة الحساب</span>
            {getStatusBadge()}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-6 p-1">
            {/* Account Info */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">كود الحساب</p>
                  <p className="font-mono font-medium">{account.account_code}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">نوع الحساب</p>
                  <Badge variant="outline" className={accountTypeColors[account.account_type]}>
                    {accountTypeLabels[account.account_type]}
                  </Badge>
                </div>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">اسم الحساب (عربي)</p>
                <p className="font-medium">{account.account_name}</p>
              </div>

              {account.account_name_en && (
                <div>
                  <p className="text-sm text-muted-foreground">اسم الحساب (إنجليزي)</p>
                  <p className="font-medium">{account.account_name_en}</p>
                </div>
              )}

              {account.description && (
                <div>
                  <p className="text-sm text-muted-foreground">الوصف</p>
                  <p className="text-sm">{account.description}</p>
                </div>
              )}
            </div>

            <Separator />

            {/* Statistics */}
            <div className="space-y-3">
              <h3 className="font-semibold">الإحصائيات</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">الرصيد الحالي</p>
                  <p className="text-lg font-mono font-bold">
                    {(linkages?.balance || account.current_balance || 0).toLocaleString()} ر.س
                  </p>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">عدد القيود</p>
                  <p className="text-lg font-mono font-bold">
                    {linkages?.journalEntriesCount || account.entry_count || 0}
                  </p>
                </div>
              </div>
              {linkages?.hasChildren && (
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">الحسابات الفرعية</p>
                  <p className="text-lg font-mono font-bold">{linkages.childrenCount}</p>
                </div>
              )}
            </div>

            {/* Linkages */}
            {linkageItems.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    الارتباطات
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {linkageItems.map((item, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 p-2 bg-amber-500/10 rounded-lg border border-amber-500/20"
                      >
                        <item.icon className="h-4 w-4 text-amber-500" />
                        <span className="text-sm">{item.label}</span>
                        <Badge variant="secondary" className="mr-auto text-xs">
                          {item.count}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Protection Reasons */}
            {linkages && linkages.protectionReasons.length > 0 && !linkages.canEdit && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="font-semibold text-destructive flex items-center gap-2">
                    <Ban className="h-4 w-4" />
                    أسباب الحماية
                  </h3>
                  <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                    {linkages.protectionReasons.map((reason, index) => (
                      <li key={index}>{reason}</li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
