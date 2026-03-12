import { ReactNode, useState, useEffect, createContext, useContext, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ShoppingCart,
  FileText,
  RotateCcw,
  Menu,
  X,
  LogOut,
  Store,
  BarChart3,
  Settings,
  Loader2,
  Users,
  Gem,
  ChevronDown,
  ClipboardList,
  Wrench,
  LayoutDashboard,
} from 'lucide-react';
import { LucideIcon } from 'lucide-react';

interface POSAdminState {
  isPosAdmin: boolean;
  hasBranch: boolean;
  branchId: string | null;
  branchName: string | null;
  adminDisplayName: string | null;
  loading: boolean;
}

const POSAdminContext = createContext<POSAdminState>({
  isPosAdmin: false,
  hasBranch: false,
  branchId: null,
  branchName: null,
  adminDisplayName: null,
  loading: true,
});

export function usePOSAdmin() {
  return useContext(POSAdminContext);
}

export function AdminBranchGuard({ children }: { children: ReactNode }) {
  const { isPosAdmin, hasBranch, loading } = usePOSAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && isPosAdmin && !hasBranch) {
      navigate('/pos', { replace: true });
    }
  }, [loading, isPosAdmin, hasBranch, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isPosAdmin && !hasBranch) return null;

  return <>{children}</>;
}

interface AdminBranch {
  branch_id: string;
  name: string;
  code: string;
}

interface POSLayoutProps {
  children: ReactNode;
  branchName?: string | null;
  branchCode?: string | null;
}

interface POSMenuItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface POSMenuSection {
  id: string;
  label: string;
  icon: LucideIcon;
  items?: POSMenuItem[];
  isStandalone?: boolean;
  href?: string;
  adminOnly?: boolean;
  colorConfig: { bg: string; icon: string; border: string };
}

const posMenuSections: POSMenuSection[] = [
  {
    id: 'pos-main',
    label: 'نقطة البيع',
    icon: ShoppingCart,
    isStandalone: true,
    href: '/pos',
    colorConfig: { bg: 'from-emerald-500/10 to-green-500/10', icon: 'text-emerald-500', border: 'border-l-emerald-500' },
  },
  {
    id: 'pos-sales',
    label: 'المبيعات',
    icon: ClipboardList,
    colorConfig: { bg: 'from-blue-500/10 to-indigo-500/10', icon: 'text-blue-500', border: 'border-l-blue-500' },
    items: [
      { href: '/pos/invoices', label: 'فواتير مبيعات POS', icon: FileText },
      { href: '/pos/returns', label: 'مرتجعات مبيعات POS', icon: RotateCcw },
      { href: '/pos/customers', label: 'عملاء نقطة البيع', icon: Users },
    ],
  },
  {
    id: 'pos-dashboard',
    label: 'لوحة التحكم',
    icon: LayoutDashboard,
    isStandalone: true,
    href: '/pos/pos-dashboard',
    adminOnly: true,
    colorConfig: { bg: 'from-cyan-500/10 to-blue-500/10', icon: 'text-cyan-500', border: 'border-l-cyan-500' },
  },
  {
    id: 'pos-reports',
    label: 'تقارير POS',
    icon: BarChart3,
    isStandalone: true,
    href: '/pos/reports',
    adminOnly: true,
    colorConfig: { bg: 'from-purple-500/10 to-violet-500/10', icon: 'text-purple-500', border: 'border-l-purple-500' },
  },
  {
    id: 'pos-settings',
    label: 'إعدادات نقطة البيع',
    icon: Settings,
    adminOnly: true,
    colorConfig: { bg: 'from-orange-500/10 to-amber-500/10', icon: 'text-orange-500', border: 'border-l-orange-500' },
    items: [
      { href: '/pos/settings/users', label: 'إدارة مستخدمين نقاط البيع', icon: Users },
      { href: '/pos/settings/dashboard', label: 'إعدادات لوحة التحكم', icon: LayoutDashboard },
    ],
  },
];

export default function POSLayout({ children, branchName, branchCode }: POSLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);

  const [isPosAdmin, setIsPosAdmin] = useState(false);
  const [hasBranch, setHasBranch] = useState(false);
  const [ctxBranchId, setCtxBranchId] = useState<string | null>(null);
  const [ctxBranchName, setCtxBranchName] = useState<string | null>(null);
  const [adminDisplayName, setAdminDisplayName] = useState<string | null>(null);
  const [ctxLoading, setCtxLoading] = useState(true);

  const [adminBranches, setAdminBranches] = useState<AdminBranch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let hasAdmin = false;
      let hasBranchPos = false;
      let bId: string | null = null;
      let bName: string | null = null;
      let adminName: string | null = null;

      try {
        const sessionRes = await fetch('/api/pos/session/context', { credentials: 'include' });
        if (sessionRes.ok) {
          const sJson = await sessionRes.json();
          if (sJson.data?.pos_session_id && sJson.data?.branch_id) {
            hasBranchPos = true;
            bId = sJson.data.branch_id;
            if (sJson.data.pos_admin) {
              hasAdmin = true;
              adminName = sJson.data.cashier_name || 'أدمن';
            }
          }
        }
      } catch {}

      if (!hasAdmin) {
        try {
          const adminRes = await fetch('/api/pos/admin/context', { credentials: 'include' });
          if (adminRes.ok) {
            const aJson = await adminRes.json();
            if (aJson.data?.admin_id) {
              hasAdmin = true;
              adminName = aJson.data.display_name;
            }
          }
        } catch {}
      }

      if (bId && !bName) {
        try {
          const brRes = await fetch('/api/pos/admin/branches', { credentials: 'include' });
          if (brRes.ok) {
            const brJson = await brRes.json();
            const match = (brJson.data || []).find((b: AdminBranch) => b.branch_id === bId);
            if (match) bName = `${match.name} (${match.code})`;
          }
        } catch {}
      }

      if (!cancelled) {
        setIsPosAdmin(hasAdmin);
        setHasBranch(hasBranchPos);
        setCtxBranchId(bId);
        setCtxBranchName(bName);
        setAdminDisplayName(adminName);
        setCtxLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!isPosAdmin) return;
    setBranchesLoading(true);
    fetch('/api/pos/admin/branches', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (json?.data) setAdminBranches(json.data);
      })
      .catch(() => {})
      .finally(() => setBranchesLoading(false));
  }, [isPosAdmin]);

  const handleBranchChange = async (branchId: string) => {
    if (switchingBranch) return;
    setSwitchingBranch(true);
    try {
      const res = await fetch('/api/pos/admin/select-branch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: branchId }),
      });
      if (res.ok) {
        window.location.replace('/pos');
        return;
      }
    } catch {}
    setSwitchingBranch(false);
  };

  const isItemActive = (href: string) => {
    return location.pathname === href;
  };

  const CASHIER_ALLOWED_HREFS = ['/pos', '/pos/invoices', '/pos/returns'];

  const filteredSections = useMemo(() => {
    return posMenuSections
      .filter(s => !s.adminOnly || isPosAdmin)
      .map(s => {
        if (!s.items || isPosAdmin) return s;
        return {
          ...s,
          items: s.items.filter(item => CASHIER_ALLOWED_HREFS.includes(item.href)),
        };
      })
      .filter(s => s.isStandalone || (s.items && s.items.length > 0));
  }, [isPosAdmin]);

  const [openSections, setOpenSections] = useState<string[]>(() => {
    const current = filteredSections.find(s =>
      s.items?.some(item => isItemActive(item.href))
    );
    return current ? [current.id] : ['pos-sales'];
  });

  const prevPathnameRef = useRef(location.pathname);

  useEffect(() => {
    if (prevPathnameRef.current !== location.pathname) {
      const current = filteredSections.find(s =>
        s.items?.some(item => isItemActive(item.href))
      );
      if (current && !openSections.includes(current.id)) {
        setOpenSections(prev => [...prev, current.id]);
      }
      prevPathnameRef.current = location.pathname;
    }
  }, [location.pathname, filteredSections]);

  const toggleSection = (sectionId: string) => {
    setOpenSections(prev =>
      prev.includes(sectionId)
        ? prev.filter(id => id !== sectionId)
        : [...prev, sectionId]
    );
  };

  const handleLogout = () => {
    fetch('/api/pos/logout', { method: 'POST', credentials: 'include' })
      .then(() => navigate('/auth'))
      .catch(() => navigate('/auth'));
  };

  const displayBranch = branchName || ctxBranchName;
  const branchDisplay = displayBranch
    ? branchCode ? `${displayBranch} (${branchCode})` : displayBranch
    : 'فرع البيع';

  const adminCtxValue: POSAdminState = {
    isPosAdmin,
    hasBranch,
    branchId: ctxBranchId,
    branchName: ctxBranchName,
    adminDisplayName,
    loading: ctxLoading,
  };

  return (
    <POSAdminContext.Provider value={adminCtxValue}>
      <div className="flex w-screen h-screen overflow-hidden bg-background" dir="rtl">
        {isMobile && sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 transition-opacity"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={cn(
            'fixed top-3 md:top-4 z-[70] transition-all duration-300',
            isMobile
              ? 'right-3'
              : sidebarOpen ? 'right-[16.5rem]' : 'right-4'
          )}
          data-testid="button-pos-sidebar-toggle"
        >
          {sidebarOpen ? (
            <X className="w-5 h-5 md:w-4 md:h-4" />
          ) : (
            <Menu className="w-5 h-5 md:w-4 md:h-4" />
          )}
        </Button>

        <aside
          className={cn(
            'fixed top-0 right-0 h-full w-72 md:w-64 bg-sidebar border-l border-sidebar-border z-50 flex flex-col transition-transform duration-300',
            sidebarOpen ? 'translate-x-0' : 'translate-x-full'
          )}
        >
          <div className="p-4 md:p-6 border-b border-sidebar-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-gold flex items-center justify-center shadow-gold flex-shrink-0">
                <Gem className="w-5 h-5 text-navy" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-bold text-base text-sidebar-foreground">Almodyan</h2>
                {isPosAdmin ? (
                  <div className="mt-1">
                    {branchesLoading ? (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>تحميل الفروع...</span>
                      </div>
                    ) : (
                      <Select
                        value={ctxBranchId || ''}
                        onValueChange={handleBranchChange}
                        disabled={switchingBranch}
                      >
                        <SelectTrigger
                          className="h-7 text-xs w-full"
                          data-testid="select-admin-branch"
                        >
                          <SelectValue placeholder="فرع البيع" />
                        </SelectTrigger>
                        <SelectContent>
                          {adminBranches.map(b => (
                            <SelectItem
                              key={b.branch_id}
                              value={b.branch_id}
                              data-testid={`option-admin-branch-${b.branch_id}`}
                            >
                              {b.name} ({b.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {switchingBranch && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>جاري التبديل...</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-sidebar-foreground/60 truncate">{branchDisplay}</p>
                )}
              </div>
            </div>
          </div>

          <nav className="flex-1 p-3 md:p-4 space-y-1 overflow-y-auto overscroll-contain">
            {filteredSections.map((section) => {
              if (section.isStandalone && section.href) {
                const active = isItemActive(section.href);
                return (
                  <button
                    key={section.id}
                    onClick={() => {
                      navigate(section.href!);
                      if (isMobile) setSidebarOpen(false);
                    }}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium w-full transition-all duration-200',
                      'min-h-[44px] md:min-h-0 mb-1',
                      active
                        ? 'bg-sidebar-accent text-sidebar-primary'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/20'
                    )}
                    data-testid={`pos-nav-${section.href.replace(/[/?=]/g, '-')}`}
                  >
                    <section.icon className={cn('w-5 h-5 flex-shrink-0', active && 'text-gold')} />
                    <span className="truncate flex-1 text-right">{section.label}</span>
                  </button>
                );
              }

              if (!section.items) return null;
              const isOpen = openSections.includes(section.id);
              const hasActiveItem = section.items.some(item => isItemActive(item.href));
              const colors = section.colorConfig;

              return (
                <Collapsible
                  key={section.id}
                  open={isOpen}
                  onOpenChange={() => toggleSection(section.id)}
                  className="mb-1"
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium w-full transition-all duration-200',
                        'min-h-[44px] md:min-h-0 border-l-2 border-transparent cursor-pointer',
                        hasActiveItem || isOpen
                          ? cn('bg-gradient-to-r', colors.bg, colors.border, 'text-sidebar-foreground')
                          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/20'
                      )}
                    >
                      <section.icon className={cn(
                        'w-5 h-5 flex-shrink-0 transition-colors',
                        (hasActiveItem || isOpen) ? colors.icon : ''
                      )} />
                      <span className="truncate flex-1 text-right">{section.label}</span>
                      <ChevronDown className={cn(
                        'w-4 h-4 flex-shrink-0 transition-transform duration-200',
                        isOpen && 'rotate-180'
                      )} />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="animate-accordion-down">
                    <div className="mt-1 space-y-0.5">
                      {section.items.map(item => {
                        const active = isItemActive(item.href);
                        return (
                          <button
                            key={item.href}
                            onClick={() => {
                              navigate(item.href);
                              if (isMobile) setSidebarOpen(false);
                            }}
                            className={cn(
                              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 w-full',
                              'min-h-[40px] md:min-h-0 mr-3',
                              active
                                ? 'bg-sidebar-accent text-sidebar-primary font-medium'
                                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                            )}
                            data-testid={`pos-nav-${item.href.replace(/[/?=]/g, '-')}`}
                          >
                            <item.icon className={cn('w-4 h-4 flex-shrink-0', active && 'text-gold')} />
                            <span className="truncate">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </nav>

          <div className="p-3 md:p-4 border-t border-sidebar-border">
            {adminDisplayName && (
              <div className="flex items-center gap-3 px-3 py-2 mb-2">
                <div className="w-9 h-9 md:w-8 md:h-8 rounded-full bg-sidebar-accent flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-medium text-sidebar-foreground">
                    {adminDisplayName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-sidebar-foreground truncate">{adminDisplayName}</p>
                  <p className="text-xs text-sidebar-foreground/50 truncate">نقطة البيع</p>
                </div>
              </div>
            )}
            <Button
              variant="ghost"
              className="w-full justify-start text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10 min-h-[44px] md:min-h-0"
              onClick={handleLogout}
              data-testid="pos-logout-button"
            >
              <LogOut className="w-4 h-4 ml-2 flex-shrink-0" />
              تسجيل الخروج
            </Button>
          </div>
        </aside>

        <main
          className={cn(
            'flex-1 min-w-0 h-screen flex flex-col transition-all duration-300 overflow-auto',
            !isMobile && sidebarOpen ? 'md:mr-64' : 'mr-0'
          )}
        >
          {children}
        </main>
      </div>
    </POSAdminContext.Provider>
  );
}
