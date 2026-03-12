import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { 
  Settings,
  Banknote,
  CreditCard,
  Wallet,
  Info
} from 'lucide-react';

interface BankAccount {
  id: string;
  account_code: string;
  account_name: string;
}

interface ReturnSettings {
  allow_cash_refund?: boolean;
  allow_card_refund?: boolean;
  allow_store_credit?: boolean;
}

interface ReturnDetailsCardProps {
  returnType: 'partial' | 'full';
  refundMethod: 'cash' | 'card' | 'store_credit';
  selectedBankAccount: string;
  returnReason: string;
  notes: string;
  bankAccounts: BankAccount[];
  returnSettings: ReturnSettings | undefined;
  hasCustomer: boolean;
  onReturnTypeChange: (value: 'partial' | 'full') => void;
  onRefundMethodChange: (value: 'cash' | 'card' | 'store_credit') => void;
  onBankAccountChange: (value: string) => void;
  onReturnReasonChange: (value: string) => void;
  onNotesChange: (value: string) => void;
}

export function ReturnDetailsCard({
  returnType,
  refundMethod,
  selectedBankAccount,
  returnReason,
  notes,
  bankAccounts,
  returnSettings,
  hasCustomer,
  onReturnTypeChange,
  onRefundMethodChange,
  onBankAccountChange,
  onReturnReasonChange,
  onNotesChange,
}: ReturnDetailsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <div className="p-2 rounded-lg bg-primary/10">
            <Settings className="w-5 h-5 text-primary" />
          </div>
          <span>بيانات المرتجع</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Return Type */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">نوع المرتجع</Label>
            <Select value={returnType} onValueChange={onReturnTypeChange}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="partial">مرتجع جزئي</SelectItem>
                <SelectItem value="full">مرتجع كلي</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Refund Method */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">طريقة رد المبلغ</Label>
            <Select value={refundMethod} onValueChange={onRefundMethodChange}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {returnSettings?.allow_cash_refund && (
                  <SelectItem value="cash">
                    <span className="flex items-center gap-2">
                      <Banknote className="w-4 h-4" /> نقداً
                    </span>
                  </SelectItem>
                )}
                {returnSettings?.allow_card_refund && (
                  <SelectItem value="card">
                    <span className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4" /> بطاقة
                    </span>
                  </SelectItem>
                )}
                {returnSettings?.allow_store_credit && hasCustomer && (
                  <SelectItem value="store_credit">
                    <span className="flex items-center gap-2">
                      <Wallet className="w-4 h-4" /> رصيد للعميل
                    </span>
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Bank Account Selection - Only for card refund */}
        {refundMethod === 'card' && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">الحساب البنكي <span className="text-destructive">*</span></Label>
            <Select value={selectedBankAccount} onValueChange={onBankAccountChange}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="اختر الحساب البنكي" />
              </SelectTrigger>
              <SelectContent>
                {bankAccounts.map(acc => (
                  <SelectItem key={acc.id} value={acc.account_code}>
                    {acc.account_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30 text-sm text-muted-foreground">
          <Info className="w-4 h-4 shrink-0" />
          <span>ملاحظة: المرتجع يُعيد القطعة للمخزون وتظهر للبيع فورًا.</span>
        </div>

        {/* Return Reason */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">سبب الإرجاع <span className="text-destructive">*</span></Label>
          <Textarea
            placeholder="أدخل سبب إرجاع البضاعة..."
            value={returnReason}
            onChange={(e) => onReturnReasonChange(e.target.value)}
            rows={3}
            className="resize-none"
          />
        </div>

        {/* Additional Notes */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-muted-foreground">ملاحظات إضافية (اختياري)</Label>
          <Textarea
            placeholder="أي ملاحظات أخرى..."
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={2}
            className="resize-none"
          />
        </div>
      </CardContent>
    </Card>
  );
}
