import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { User, Lock, Loader2, LogOut, KeyRound, AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';

interface Cashier {
  user_id: string;
  username: string;
  full_name: string;
  role_key: string;
  is_supervisor: boolean;
}

interface CashierContext {
  pos_session_id: string;
  cashier_user_id: string;
  branch_id: string;
  pos_admin?: boolean;
  cashier_name?: string;
  cashier_kind?: string;
  seller_profile_id?: string;
  seller_display_name?: string;
}

interface POSCashierGateProps {
  children: (cashierInfo: CashierContext & { cashier_name: string }, onChangeCashier: () => void) => React.ReactNode;
}

function mapPosError(status: number, serverMessage?: string): string {
  if (status === 400 && serverMessage && (
    serverMessage.toLowerCase().includes('no pin') ||
    (serverMessage.toLowerCase().includes('pin') && serverMessage.toLowerCase().includes('not set')) ||
    serverMessage.includes('PIN غير مضبوط') ||
    serverMessage.includes('pin غير')
  )) {
    return 'لا يوجد PIN لهذا المستخدم. اطلب من المشرف تعيين PIN من شاشة المستخدمين.';
  }
  if (status === 400) {
    return serverMessage || 'طلب غير صالح.';
  }
  if (status === 401) {
    return 'رمز PIN غير صحيح.';
  }
  if (status === 403) {
    return 'غير مصرح لك.';
  }
  if (status === 423) {
    let msg = 'تم قفل المستخدم مؤقتًا بسبب محاولات كثيرة. حاول مرة أخرى لاحقًا.';
    if (serverMessage) {
      const match = serverMessage.match(/locked.until[:\s]*([^\s,]+)/i);
      if (match?.[1]) {
        try {
          const d = new Date(match[1]);
          if (!isNaN(d.getTime())) {
            msg += ` (يُفتح الساعة ${d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })})`;
          }
        } catch {}
      }
    }
    return msg;
  }
  if (status >= 500) {
    return 'تعذر الاتصال بالخادم. حاول مرة أخرى.';
  }
  return serverMessage || 'حدث خطأ غير متوقع.';
}

export default function POSCashierGate({ children }: POSCashierGateProps) {
  const [cashierCtx, setCashierCtx] = useState<CashierContext | null>(null);
  const [cashierName, setCashierName] = useState<string>('');
  const [checking, setChecking] = useState(true);
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [loadingCashiers, setLoadingCashiers] = useState(false);
  const [selectedCashierId, setSelectedCashierId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const checkContext = useCallback(async () => {
    try {
      const res = await fetch('/api/pos/session/context', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        if (json.data?.pos_session_id) {
          setCashierCtx(json.data);
          return true;
        }
      } else {
        setError(mapPosError(res.status));
      }
    } catch {
      setError('تعذر الاتصال بالخادم. حاول مرة أخرى.');
    }
    setCashierCtx(null);
    return false;
  }, []);

  const loadCashiers = useCallback(async () => {
    setLoadingCashiers(true);
    setError(null);
    try {
      const res = await fetch('/api/pos/cashiers', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setCashiers(json.data || []);
        if (!json.data || json.data.length === 0) {
          setError('لا يوجد كاشير مسجل لهذا الفرع');
        }
      } else {
        const json = await res.json().catch(() => null);
        setError(mapPosError(res.status, json?.error));
      }
    } catch {
      setError('تعذر الاتصال بالخادم. حاول مرة أخرى.');
    }
    setLoadingCashiers(false);
  }, []);

  const resolveCashierName = useCallback(async (userId: string) => {
    try {
      const res = await fetch('/api/pos/cashiers', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        const list: Cashier[] = json.data || [];
        setCashiers(list);
        const c = list.find(c => c.user_id === userId);
        if (c) setCashierName(c.full_name || c.username);
      }
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      const hasSession = await checkContext();
      if (hasSession) {
        return;
      }
      await loadCashiers();
      setChecking(false);
    })();
  }, [checkContext, loadCashiers]);

  useEffect(() => {
    if (cashierCtx && !cashierName) {
      if (cashierCtx.pos_admin && cashierCtx.cashier_name) {
        setCashierName(cashierCtx.cashier_name);
        setChecking(false);
      } else {
        resolveCashierName(cashierCtx.cashier_user_id).then(() => setChecking(false));
      }
    }
  }, [cashierCtx, cashierName, resolveCashierName]);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!selectedCashierId) {
      setError('يرجى اختيار الكاشير');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError('يرجى إدخال رمز PIN مكون من 4 أرقام');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/pos/cashier/enter', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cashier_user_id: selectedCashierId, pin }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.error) {
        const errMsg = mapPosError(res.status, json?.error);
        setError(errMsg);
        if (res.status === 401 || res.status === 423) {
          setPin('');
        }
        return;
      }
      const selected = cashiers.find(c => c.user_id === selectedCashierId);
      if (selected) setCashierName(selected.full_name || selected.username);
      await checkContext();
      setPin('');
      setSelectedCashierId('');
    } catch {
      setError('تعذر الاتصال بالخادم. حاول مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = () => {
    setError(null);
    setPin('');
    loadCashiers();
  };

  const handleChangeCashier = async () => {
    try {
      const res = await fetch('/api/pos/cashier/exit', { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const stillActive = await checkContext();
        if (stillActive) {
          const json = await res.json().catch(() => null);
          setError(mapPosError(res.status, json?.error));
          return;
        }
      }
    } catch {
      const stillActive = await checkContext();
      if (stillActive) {
        setError('تعذر الاتصال بالخادم. حاول مرة أخرى.');
        return;
      }
    }
    setCashierCtx(null);
    setCashierName('');
    setPin('');
    setSelectedCashierId('');
    setError(null);
    await loadCashiers();
  };

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">جاري التحقق من جلسة الكاشير...</span>
        </div>
      </div>
    );
  }

  if (!cashierCtx) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
              <KeyRound className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-lg">دخول الكاشير</CardTitle>
            <p className="text-sm text-muted-foreground">اختر الكاشير وأدخل رمز PIN للوصول إلى نقطة البيع</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive" data-testid="alert-cashier-error">
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription className="flex flex-col gap-2">
                  <span>{error}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetry}
                    data-testid="button-cashier-retry"
                    className="self-start"
                  >
                    <RefreshCw className="w-3.5 h-3.5 ml-1" />
                    إعادة المحاولة
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>الكاشير</Label>
              {loadingCashiers ? (
                <div className="flex items-center justify-center py-3">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Select value={selectedCashierId} onValueChange={(val) => { setSelectedCashierId(val); setError(null); }}>
                  <SelectTrigger data-testid="select-cashier">
                    <User className="w-4 h-4 ml-2 flex-shrink-0" />
                    <SelectValue placeholder="اختر الكاشير" />
                  </SelectTrigger>
                  <SelectContent>
                    {cashiers.map(c => (
                      <SelectItem key={c.user_id} value={c.user_id}>
                        <span className="flex items-center gap-2">
                          {c.full_name || c.username}
                          {c.is_supervisor && (
                            <Badge variant="secondary" className="text-xs py-0 px-1.5">مشرف</Badge>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cashier-pin">رمز PIN</Label>
              <Input
                id="cashier-pin"
                data-testid="input-cashier-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(null); }}
                placeholder="****"
                className="text-center text-lg tracking-widest"
                onKeyDown={e => e.key === 'Enter' && !submitting && handleSubmit()}
                autoComplete="off"
              />
            </div>
            <Button
              data-testid="button-cashier-enter"
              className="w-full"
              onClick={handleSubmit}
              disabled={submitting || !selectedCashierId || pin.length !== 4}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin ml-2" />
              ) : (
                <Lock className="w-4 h-4 ml-2" />
              )}
              {submitting ? 'جاري الدخول...' : 'دخول'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children({ ...cashierCtx, cashier_name: cashierName }, handleChangeCashier)}</>;
}

export function CashierHeaderBadge({ cashierName, onChangeCashier, isPosAdmin, cashierKind, onSwitchToAdmin }: {
  cashierName: string;
  onChangeCashier: () => void;
  isPosAdmin?: boolean;
  cashierKind?: string;
  onSwitchToAdmin?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-lg">
      <Badge variant="outline" className="gap-1 px-2 py-1">
        <User className="w-3 h-3" />
        {cashierName}
      </Badge>
      {isPosAdmin && cashierKind === 'user' && onSwitchToAdmin && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onSwitchToAdmin}
          data-testid="button-switch-to-admin"
          title="العودة لوضع الأدمن"
          className="h-7 px-2 text-xs"
        >
          <ShieldCheck className="w-3.5 h-3.5 ml-1" />
          أدمن نقطة البيع
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onChangeCashier}
        data-testid="button-change-cashier"
        title="تغيير الكاشير"
        className="h-7 px-2 text-xs"
      >
        <LogOut className="w-3.5 h-3.5 ml-1" />
        تغيير
      </Button>
    </div>
  );
}
