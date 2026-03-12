import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Shield, Database, FileText } from 'lucide-react';
import type { HealthCheckIssue } from '@/lib/accounting-health-checks';

interface HealthCheckFixConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: HealthCheckIssue;
  onConfirm: () => void;
}

export function HealthCheckFixConfirm({
  open,
  onOpenChange,
  issue,
  onConfirm,
}: HealthCheckFixConfirmProps) {
  const [understood, setUnderstood] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);

  const canProceed = understood && backupConfirmed;

  const handleConfirm = () => {
    if (canProceed) {
      onConfirm();
      // Reset state
      setUnderstood(false);
      setBackupConfirmed(false);
    }
  };

  const handleClose = () => {
    setUnderstood(false);
    setBackupConfirmed(false);
    onOpenChange(false);
  };

  const formatAmount = (amount?: number) => {
    if (!amount) return null;
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
    }).format(amount);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-500/10">
              <AlertTriangle className="w-6 h-6 text-yellow-500" />
            </div>
            <div>
              <DialogTitle>تأكيد الإصلاح</DialogTitle>
              <DialogDescription>
                أنت على وشك تنفيذ إصلاح آلي
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Issue Details */}
          <div className="p-4 rounded-lg bg-muted/50 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">نوع الإصلاح:</span>
              <span>{issue.title}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Database className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">عدد السجلات:</span>
              <span>{issue.affectedRecords} سجل</span>
            </div>
            {issue.affectedAmount && (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">القيمة الإجمالية:</span>
                <span className="text-primary font-bold">{formatAmount(issue.affectedAmount)}</span>
              </div>
            )}
          </div>

          {/* Expected Changes */}
          <div className="p-4 rounded-lg border border-yellow-500/20 bg-yellow-500/5">
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-yellow-500" />
              التغييرات المتوقعة
            </h4>
            <ul className="text-sm text-muted-foreground space-y-1 mr-4 list-disc list-inside">
              {issue.autoFixFunction === 'createMissingSalesJournalEntries' && (
                <>
                  <li>إنشاء {issue.affectedRecords} قيد محاسبي جديد</li>
                  <li>ربط القيود بفواتير المبيعات المفقودة</li>
                  <li>تحديث أرصدة الحسابات ذات الصلة</li>
                </>
              )}
              {issue.autoFixFunction === 'createMissingPurchaseJournalEntries' && (
                <>
                  <li>إنشاء {issue.affectedRecords} قيد محاسبي جديد</li>
                  <li>ربط القيود بفواتير المشتريات المفقودة</li>
                  <li>تحديث رصيد حساب المشتريات</li>
                </>
              )}
              {issue.autoFixFunction === 'recalculateCustomerBalances' && (
                <>
                  <li>إعادة حساب أرصدة {issue.affectedRecords} عميل</li>
                  <li>تحديث حقل total_purchases</li>
                </>
              )}
              {issue.autoFixFunction === 'recalculateSupplierBalances' && (
                <>
                  <li>إعادة حساب أرصدة {issue.affectedRecords} مورد</li>
                  <li>تحديث حقل current_balance</li>
                </>
              )}
              {!issue.autoFixFunction && (
                <li>تنفيذ الإصلاح المحدد للمشكلة</li>
              )}
            </ul>
          </div>

          {/* Confirmation Checkboxes */}
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="understood"
                checked={understood}
                onCheckedChange={(checked) => setUnderstood(checked === true)}
              />
              <Label htmlFor="understood" className="text-sm cursor-pointer">
                أفهم التغييرات وأوافق على تنفيذها
              </Label>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="backup"
                checked={backupConfirmed}
                onCheckedChange={(checked) => setBackupConfirmed(checked === true)}
              />
              <Label htmlFor="backup" className="text-sm cursor-pointer">
                تم إنشاء نسخة احتياطية من البيانات
              </Label>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>
            إلغاء
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={!canProceed}
            className="gap-2"
          >
            <Shield className="w-4 h-4" />
            تنفيذ الإصلاح
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
