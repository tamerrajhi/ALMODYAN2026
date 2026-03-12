import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Loader2, RefreshCw, LogIn } from 'lucide-react';

interface BranchLoginGateProps {
  children: (branchId: string, branchName: string | null, onChangeBranch: () => void) => React.ReactNode;
  branches?: { branch_id: string; branch_name: string }[];
  onBranchChange?: (branchId: string, branchName?: string | null) => void;
}

export default function BranchLoginGate({ children, branches = [], onBranchChange }: BranchLoginGateProps) {
  const [branchId, setBranchId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [showChangeBranch, setShowChangeBranch] = useState(false);

  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [publicBranches, setPublicBranches] = useState<{ branch_id: string; name: string; code: string; username: string }[]>([]);
  const [publicBranchesLoaded, setPublicBranchesLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/public/branches-list')
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (json?.data) setPublicBranches(json.data);
      })
      .catch(() => {})
      .finally(() => setPublicBranchesLoaded(true));
  }, []);

  const checkContext = useCallback(async () => {
    try {
      const res = await fetch('/api/pos/branch/context', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        const bid = json.data?.branch_id || null;
        if (bid) {
          setBranchId(bid);
          setShowLogin(false);
        } else {
          setBranchId(null);
          setShowLogin(true);
        }
      } else {
        setBranchId(null);
        setShowLogin(true);
      }
    } catch {
      setBranchId(null);
      setShowLogin(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkContext();
  }, [checkContext]);

  useEffect(() => {
    if (branchId && onBranchChange) {
      const nameFromProp = branches.find(b => b.branch_id === branchId)?.branch_name || null;
      const pm = publicBranches.find(b => b.branch_id === branchId);
      const resolvedName = nameFromProp || (pm ? `${pm.name} (${pm.code})` : null);
      onBranchChange(branchId, resolvedName);
    }
  }, [branchId, onBranchChange, branches, publicBranches]);

  const handleLogin = async () => {
    if (!selectedBranchId) {
      setError('يرجى اختيار الفرع');
      return;
    }
    setError(null);
    setLoggingIn(true);
    try {
      const res = await fetch('/api/pos/branch/direct-login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: selectedBranchId }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error || 'فشل تسجيل الدخول');
        return;
      }
      const ctxRes = await fetch('/api/pos/branch/context', { credentials: 'include' });
      if (ctxRes.ok) {
        const ctxJson = await ctxRes.json();
        const bid = ctxJson.data?.branch_id || null;
        if (!bid) {
          setError('لم يتم العثور على بيانات الفرع');
          return;
        }
        setBranchId(bid);
        setShowLogin(false);
        setShowChangeBranch(false);
        setSelectedBranchId('');
        setError(null);
      } else {
        setError('فشل التحقق من جلسة الفرع');
      }
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleChangeBranch = () => {
    setSelectedBranchId('');
    setError(null);
    setShowChangeBranch(true);
  };

  const handleBranchSelect = (newBranchId: string) => {
    setSelectedBranchId(newBranchId);
  };

  const branchNameFromProp = branches.find(b => b.branch_id === branchId)?.branch_name || null;
  const publicMatch = publicBranches.find(b => b.branch_id === branchId);
  const branchName = branchNameFromProp
    || (publicMatch ? `${publicMatch.name} (${publicMatch.code})` : null)
    || (branchId && publicBranchesLoaded ? `Branch: ${branchId.slice(0, 8)}...` : null);

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">جاري التحقق من جلسة الفرع...</span>
        </div>
      </div>
    );
  }

  const branchSelectorUI = (idPrefix: string) => (
    <div className="space-y-2">
      <Label>{idPrefix === 'branch' ? 'اختر الفرع' : 'الفرع الجديد'}</Label>
      {publicBranchesLoaded && publicBranches.length > 0 ? (
        <Select
          value={selectedBranchId}
          onValueChange={handleBranchSelect}
        >
          <SelectTrigger data-testid={`select-${idPrefix}-branch`}>
            <SelectValue placeholder="اختر الفرع..." />
          </SelectTrigger>
          <SelectContent>
            {publicBranches.map(b => (
              <SelectItem
                key={b.branch_id}
                value={b.branch_id}
                data-testid={`option-${idPrefix}-branch-${b.code}`}
              >
                <span className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  {b.name} ({b.code})
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          جاري تحميل الفروع...
        </div>
      )}
    </div>
  );

  if (showLogin && !branchId) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
              <Building2 className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-lg">تسجيل دخول الفرع</CardTitle>
            <p className="text-sm text-muted-foreground">اختر الفرع للوصول إلى نقطة البيع</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {branchSelectorUI('branch')}
            <Button
              data-testid="button-branch-login"
              className="w-full"
              onClick={handleLogin}
              disabled={loggingIn || !selectedBranchId}
            >
              {loggingIn ? (
                <Loader2 className="w-4 h-4 animate-spin ml-2" />
              ) : (
                <LogIn className="w-4 h-4 ml-2" />
              )}
              {loggingIn ? 'جاري الدخول...' : 'دخول'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      {branchId && children(branchId, branchName, handleChangeBranch)}

      <Dialog open={showChangeBranch} onOpenChange={setShowChangeBranch}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5" />
              تغيير الفرع
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {branchSelectorUI('change')}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowChangeBranch(false)}>إلغاء</Button>
            <Button
              data-testid="button-change-branch-submit"
              onClick={handleLogin}
              disabled={loggingIn || !selectedBranchId}
            >
              {loggingIn ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <LogIn className="w-4 h-4 ml-2" />}
              {loggingIn ? 'جاري التبديل...' : 'تبديل'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
