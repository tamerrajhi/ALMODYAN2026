import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, KeyRound, ArrowRight, User, ShoppingCart, Search, ChevronDown, RefreshCw, Shield } from 'lucide-react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

type AuthMode = 'erp' | 'pos';

interface BranchOption {
  branch_id: string;
  name: string;
  code: string;
  is_active: boolean;
}

interface PendingMfa {
  userId: string;
  email: string;
  method: string;
  phone?: string;
}

export default function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signIn } = useAuth();
  const initialTab = searchParams.get('tab') === 'pos' ? 'pos' : 'erp';
  const [authMode, setAuthMode] = useState<AuthMode>(initialTab);
  const [loading, setLoading] = useState(false);
  const [showOtpForm, setShowOtpForm] = useState(false);
  const [pendingMfa, setPendingMfa] = useState<PendingMfa | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<BranchOption | null>(null);
  const [branchSearch, setBranchSearch] = useState('');
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [posError, setPosError] = useState('');
  const [posLoading, setPosLoading] = useState(false);

  type ErpSubMode = 'choose' | 'erp_login' | 'pos_admin_login';
  const [erpSubMode, setErpSubMode] = useState<ErpSubMode>('choose');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);

  const fetchBranches = async () => {
    setBranchesLoading(true);
    setBranchesError('');
    try {
      const res = await fetch('/api/public/branches-list', { credentials: 'include' });
      if (!res.ok) throw new Error('fetch failed');
      const json = await res.json();
      const list = json?.data ?? json ?? [];
      setBranches(Array.isArray(list) ? list : []);
    } catch {
      setBranchesError('تعذّر تحميل قائمة الفروع');
      setBranches([]);
    } finally {
      setBranchesLoading(false);
    }
  };

  useEffect(() => {
    if (authMode === 'pos' && branches.length === 0 && !branchesLoading) {
      fetchBranches();
    }
  }, [authMode]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setBranchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredBranches = branches.filter(b => {
    if (!branchSearch.trim()) return true;
    const q = branchSearch.trim().toLowerCase();
    return b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q);
  });

  const switchMode = (mode: AuthMode) => {
    if (mode === authMode) return;
    if (mode === 'erp') {
      setPosError('');
      setSelectedBranch(null);
      setBranchSearch('');
      setBranchDropdownOpen(false);
    } else {
      setLoginIdentifier('');
      setLoginPassword('');
      setErpSubMode('choose');
      setAdminUsername('');
      setAdminPassword('');
      setAdminError('');
    }
    setAuthMode(mode);
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminError('');
    const u = adminUsername.trim();
    if (!u || !adminPassword) {
      setAdminError('يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }
    setAdminLoading(true);
    try {
      const res = await fetch('/api/pos/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: u, password: adminPassword }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setAdminError(json.error || 'بيانات الدخول غير صحيحة');
        return;
      }
      navigate('/pos/invoices');
    } catch {
      setAdminError('حدث خطأ في الاتصال');
    } finally {
      setAdminLoading(false);
    }
  };

  const handlePosLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPosError('');
    if (!selectedBranch) {
      setPosError('يرجى اختيار الفرع أولاً');
      return;
    }

    setPosLoading(true);
    try {
      const res = await fetch('/api/pos/branch/direct-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ branch_id: selectedBranch.branch_id }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setPosError(json.error || 'حدث خطأ في الدخول');
        return;
      }

      navigate('/pos');
    } catch {
      setPosError('حدث خطأ في الاتصال');
    } finally {
      setPosLoading(false);
    }
  };

  const checkMfaRequired = async (userId: string, email: string) => {
    try {
      const res = await fetch(`/api/users/profile-checks?user_id=${encodeURIComponent(userId)}`, {
        credentials: 'include',
      });
      if (!res.ok) return { required: false };
      const profile = await res.json();

      if (profile?.mfa_enabled && profile?.mfa_method) {
        return {
          required: true,
          method: profile.mfa_method,
          phone: profile.phone,
        };
      }
      return { required: false };
    } catch {
      return { required: false };
    }
  };

  const sendOtp = async (userId: string, email: string, method: string, phone?: string) => {
    setOtpLoading(true);
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, email, method, phone }),
      });
      const response = await res.json();

      if (response.error) {
        throw new Error(response.error.message);
      }

      toast.success('تم إرسال رمز التحقق');
      setPendingMfa({ userId, email, method, phone });
      setShowOtpForm(true);
    } catch (error: any) {
      console.error('Error sending OTP:', error);
      toast.error('فشل في إرسال رمز التحقق');
    } finally {
      setOtpLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (!pendingMfa || otpCode.length !== 6) return;

    setOtpLoading(true);
    try {
      const verifyRes = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: pendingMfa.userId, otpCode }),
      });
      const response = await verifyRes.json();

      if (response.error) {
        throw new Error(response.error.message);
      }

      if (response.data?.success) {
        toast.success('تم تسجيل الدخول بنجاح');
        navigate('/');
      } else {
        toast.error(response.data?.error || 'رمز التحقق غير صحيح');
      }
    } catch (error: any) {
      console.error('Error verifying OTP:', error);
      toast.error('فشل في التحقق من الرمز');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await signIn(loginIdentifier, loginPassword);

      if (error) {
        if (error.message.includes('Invalid login credentials') || error.message.includes('Login failed')) {
          toast.error('بيانات الدخول غير صحيحة');
        } else if (error.message.includes('اسم المستخدم غير موجود')) {
          toast.error('اسم المستخدم غير موجود');
        } else if (error.message.includes('disabled') || error.message.includes('معطل')) {
          toast.error('تم تعطيل حسابك. تواصل مع مدير النظام');
        } else {
          toast.error(error.message || 'حدث خطأ أثناء تسجيل الدخول');
        }
        setLoading(false);
        return;
      }

      const meRes = await fetch('/api/auth/me', { credentials: 'include' });
      if (meRes.ok) {
        const meData = await meRes.json();
        const userId = meData.user?.id;
        const email = meData.user?.email || loginIdentifier;

        if (meData.profile && meData.profile.is_active === false) {
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
          toast.error('تم تعطيل حسابك. تواصل مع مدير النظام');
          setLoading(false);
          return;
        }

        if (userId) {
          const mfaCheck = await checkMfaRequired(userId, email);
          if (mfaCheck.required) {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
            await sendOtp(userId, email, mfaCheck.method!, mfaCheck.phone || undefined);
            setLoading(false);
            return;
          }
        }
      }

      toast.success('تم تسجيل الدخول بنجاح');
      navigate('/');
    } catch (error) {
      toast.error('حدث خطأ أثناء تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteLoginAfterOtp = async () => {
    if (!pendingMfa) return;
    
    const { error } = await signIn(pendingMfa.email, loginPassword);
    if (error) {
      toast.error('حدث خطأ، يرجى إعادة تسجيل الدخول');
      setShowOtpForm(false);
      setPendingMfa(null);
      return;
    }

    const meRes = await fetch('/api/auth/me', { credentials: 'include' });
    if (meRes.ok) {
      const meData = await meRes.json();
      if (meData.profile && meData.profile.is_active === false) {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        toast.error('تم تعطيل حسابك. تواصل مع مدير النظام');
        setShowOtpForm(false);
        setPendingMfa(null);
        return;
      }
    }
    
    toast.success('تم تسجيل الدخول بنجاح');
    navigate('/');
  };

  const resendOtp = async () => {
    if (pendingMfa) {
      await sendOtp(pendingMfa.userId, pendingMfa.email, pendingMfa.method, pendingMfa.phone);
    }
  };

  if (showOtpForm && pendingMfa) {
    return (
      <div 
      className="min-h-screen flex flex-col items-center justify-end pb-20 p-4 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/images/auth-bg-jewelry.png')", backgroundColor: '#1a1a2e' }}
      >
        <div className="w-full max-w-lg animate-fade-in">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/80 backdrop-blur-sm shadow-lg mb-4">
              <KeyRound className="w-8 h-8 text-amber-700" />
            </div>
            <h1 className="text-2xl font-bold text-amber-900 drop-shadow-md">التحقق بخطوتين</h1>
            <p className="text-amber-800/80 mt-1 drop-shadow-sm">
              {pendingMfa.method === 'whatsapp' 
                ? `تم إرسال رمز التحقق إلى واتساب ${pendingMfa.phone}`
                : `تم إرسال رمز التحقق إلى ${pendingMfa.email}`
              }
            </p>
          </div>

          <Card className="border-0 shadow-2xl bg-white/90 backdrop-blur-sm">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-xl">أدخل رمز التحقق</CardTitle>
              <CardDescription>الرمز مكون من 6 أرقام وصالح لمدة 10 دقائق</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex justify-center" dir="ltr">
                <InputOTP
                  maxLength={6}
                  value={otpCode}
                  onChange={setOtpCode}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <Button 
                onClick={async () => {
                  await verifyOtp();
                  if (otpCode.length === 6) {
                    await handleCompleteLoginAfterOtp();
                  }
                }}
                className="w-full bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-semibold shadow-lg"
                disabled={otpLoading || otpCode.length !== 6}
              >
                {otpLoading ? (
                  <>
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                    جاري التحقق...
                  </>
                ) : (
                  'تأكيد الدخول'
                )}
              </Button>

              <div className="flex items-center justify-between text-sm">
                <Button 
                  variant="link" 
                  onClick={resendOtp}
                  disabled={otpLoading}
                  className="text-amber-700 hover:text-amber-800"
                >
                  إعادة إرسال الرمز
                </Button>
                <Button 
                  variant="link" 
                  onClick={() => {
                    setShowOtpForm(false);
                    setPendingMfa(null);
                    setOtpCode('');
                  }}
                  className="text-amber-700 hover:text-amber-800"
                >
                  <ArrowRight className="w-4 h-4 ml-1" />
                  رجوع
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen flex flex-col items-center justify-center p-4 bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: "url('/images/auth-bg-jewelry.png')", backgroundColor: '#1a1a2e' }}
    >
      <div className="w-full max-w-lg animate-fade-in">

        <div className="flex mb-3 rounded-lg overflow-hidden shadow-lg">
          <button
            type="button"
            onClick={() => switchMode('erp')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors ${
              authMode === 'erp'
                ? 'bg-white/90 text-[#1a1a2e] backdrop-blur-sm'
                : 'bg-white/20 text-white/70 backdrop-blur-sm'
            }`}
            data-testid="tab-erp-login"
          >
            <User className="w-4 h-4" />
            دخول النظام
          </button>
          <button
            type="button"
            onClick={() => switchMode('pos')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors ${
              authMode === 'pos'
                ? 'bg-white/90 text-[#1a1a2e] backdrop-blur-sm'
                : 'bg-white/20 text-white/70 backdrop-blur-sm'
            }`}
            data-testid="tab-pos-login"
          >
            <ShoppingCart className="w-4 h-4" />
            دخول نقطة البيع
          </button>
        </div>

        {authMode === 'erp' ? (
          <Card className="border-0 shadow-2xl bg-white/90 backdrop-blur-sm">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-xl">
                {erpSubMode === 'choose' && 'مرحباً بك'}
                {erpSubMode === 'erp_login' && 'دخول النظام'}
                {erpSubMode === 'pos_admin_login' && 'أدمن نقاط البيع'}
              </CardTitle>
              <CardDescription>
                {erpSubMode === 'choose' && 'اختر طريقة الدخول'}
                {erpSubMode === 'erp_login' && 'سجل دخولك للوصول إلى النظام'}
                {erpSubMode === 'pos_admin_login' && 'تسجيل دخول بحساب أدمن POS مستقل'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {erpSubMode === 'choose' && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setErpSubMode('erp_login')}
                    className="w-full flex items-center gap-3 rounded-md border border-input bg-background px-4 py-4 text-sm transition-colors hover:bg-amber-50"
                    data-testid="button-erp-mode"
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-100 text-amber-700 shrink-0">
                      <User className="w-5 h-5" />
                    </div>
                    <div className="text-right flex-1">
                      <div className="font-semibold">دخول النظام (ERP)</div>
                      <div className="text-xs text-muted-foreground">تسجيل دخول بحساب النظام الرئيسي</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setErpSubMode('pos_admin_login')}
                    className="w-full flex items-center gap-3 rounded-md border border-input bg-background px-4 py-4 text-sm transition-colors hover:bg-amber-50"
                    data-testid="button-pos-admin-mode"
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-100 text-amber-700 shrink-0">
                      <Shield className="w-5 h-5" />
                    </div>
                    <div className="text-right flex-1">
                      <div className="font-semibold">أدمن نقاط البيع</div>
                      <div className="text-xs text-muted-foreground">تسجيل دخول بحساب أدمن POS مستقل</div>
                    </div>
                  </button>
                </div>
              )}

              {erpSubMode === 'erp_login' && (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="form-field">
                    <Label htmlFor="login-identifier" className="form-label">
                      اسم المستخدم أو البريد الإلكتروني
                    </Label>
                    <div className="relative">
                      <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="login-identifier"
                        type="text"
                        placeholder="username أو example@email.com"
                        value={loginIdentifier}
                        onChange={(e) => setLoginIdentifier(e.target.value)}
                        required
                        dir="ltr"
                        className="text-left pr-10"
                        data-testid="input-erp-identifier"
                      />
                    </div>
                  </div>
                  <div className="form-field">
                    <Label htmlFor="login-password" className="form-label">كلمة المرور</Label>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                      dir="ltr"
                      className="text-left"
                      data-testid="input-erp-password"
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-semibold shadow-lg"
                    disabled={loading}
                    data-testid="button-erp-login"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                        جاري التحميل...
                      </>
                    ) : (
                      'تسجيل الدخول'
                    )}
                  </Button>

                  <p className="text-center text-sm text-muted-foreground mt-4">
                    للحصول على حساب، تواصل مع مدير النظام
                  </p>

                  <button
                    type="button"
                    onClick={() => { setErpSubMode('choose'); setLoginIdentifier(''); setLoginPassword(''); }}
                    className="w-full text-center text-xs text-amber-700 hover:underline mt-1"
                    data-testid="button-erp-back-choose"
                  >
                    رجوع لاختيار طريقة الدخول
                  </button>
                </form>
              )}

              {erpSubMode === 'pos_admin_login' && (
                <form onSubmit={handleAdminLogin} className="space-y-4">
                  <div className="form-field">
                    <Label htmlFor="admin-username" className="form-label">اسم المستخدم</Label>
                    <div className="relative">
                      <Shield className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="admin-username"
                        type="text"
                        placeholder="اسم مستخدم الأدمن"
                        value={adminUsername}
                        onChange={(e) => { setAdminUsername(e.target.value); setAdminError(''); }}
                        required
                        dir="ltr"
                        className="text-left pr-10"
                        autoFocus
                        data-testid="input-admin-username"
                      />
                    </div>
                  </div>
                  <div className="form-field">
                    <Label htmlFor="admin-password" className="form-label">كلمة المرور</Label>
                    <Input
                      id="admin-password"
                      type="password"
                      placeholder="••••••••"
                      value={adminPassword}
                      onChange={(e) => { setAdminPassword(e.target.value); setAdminError(''); }}
                      required
                      dir="ltr"
                      className="text-left"
                      data-testid="input-admin-password"
                    />
                  </div>

                  {adminError && (
                    <p className="text-sm text-red-600 text-center" data-testid="text-admin-error">{adminError}</p>
                  )}

                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-semibold shadow-lg"
                    disabled={adminLoading}
                    data-testid="button-admin-login"
                  >
                    {adminLoading ? (
                      <>
                        <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                        جاري الدخول...
                      </>
                    ) : (
                      'تسجيل دخول الأدمن'
                    )}
                  </Button>

                  <button
                    type="button"
                    onClick={() => { setErpSubMode('choose'); setAdminError(''); setAdminUsername(''); setAdminPassword(''); }}
                    className="w-full text-center text-xs text-amber-700 hover:underline mt-1"
                    data-testid="button-admin-back-choose"
                  >
                    رجوع لاختيار طريقة الدخول
                  </button>
                </form>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-0 shadow-2xl bg-white/90 backdrop-blur-sm">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-xl">نقطة البيع</CardTitle>
              <CardDescription>اختر الفرع للدخول إلى نقطة البيع</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePosLogin} className="space-y-4">
                <div className="form-field">
                  <Label className="form-label">الفرع</Label>
                  {branchesError ? (
                    <div className="flex items-center gap-2 justify-center text-sm text-red-600">
                      <span>{branchesError}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={fetchBranches}
                        disabled={branchesLoading}
                        data-testid="button-retry-branches"
                      >
                        <RefreshCw className={`w-4 h-4 ${branchesLoading ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>
                  ) : (
                    <div className="relative" ref={dropdownRef}>
                      <button
                        type="button"
                        onClick={() => setBranchDropdownOpen(!branchDropdownOpen)}
                        className="w-full flex items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm"
                        data-testid="button-branch-selector"
                      >
                        <span className={selectedBranch ? 'text-foreground' : 'text-muted-foreground'}>
                          {branchesLoading
                            ? 'جاري التحميل...'
                            : selectedBranch
                              ? `${selectedBranch.name} (${selectedBranch.code})`
                              : 'اختر الفرع'}
                        </span>
                        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                      </button>
                      {branchDropdownOpen && (
                        <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg max-h-48 overflow-hidden flex flex-col">
                          <div className="p-2 border-b">
                            <div className="relative">
                              <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                              <Input
                                type="text"
                                placeholder="ابحث بالاسم أو الكود..."
                                value={branchSearch}
                                onChange={(e) => setBranchSearch(e.target.value)}
                                className="pr-8 h-8 text-sm"
                                autoFocus
                                data-testid="input-branch-search"
                              />
                            </div>
                          </div>
                          <div className="overflow-y-auto max-h-36">
                            {filteredBranches.length === 0 ? (
                              <p className="text-sm text-muted-foreground text-center py-3">لا توجد نتائج</p>
                            ) : (
                              filteredBranches.map(b => (
                                <button
                                  key={b.branch_id}
                                  type="button"
                                  className={`w-full text-right px-3 py-2 text-sm transition-colors ${
                                    selectedBranch?.branch_id === b.branch_id
                                      ? 'bg-amber-50 text-amber-800 font-medium'
                                      : 'hover:bg-gray-50'
                                  }`}
                                  onClick={() => {
                                    setSelectedBranch(b);
                                    setBranchDropdownOpen(false);
                                    setBranchSearch('');
                                    setPosError('');
                                  }}
                                  data-testid={`option-branch-${b.branch_id}`}
                                >
                                  {b.name} <span className="text-muted-foreground">({b.code})</span>
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {posError && (
                  <p className="text-sm text-red-600 text-center" data-testid="text-pos-error">{posError}</p>
                )}

                <Button
                  type="submit"
                  className="w-full bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-semibold shadow-lg"
                  disabled={posLoading || !selectedBranch}
                  data-testid="button-pos-login"
                >
                  {posLoading ? (
                    <>
                      <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                      جاري الدخول...
                    </>
                  ) : (
                    'فتح نقطة البيع'
                  )}
                </Button>

                <p className="text-center text-xs text-muted-foreground mt-3">
                  بعد الدخول سيتم طلب اختيار الكاشير وإدخال رقم PIN
                </p>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
