import { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';

type EntryMode = 'select' | 'cashier' | 'admin_login' | 'admin_authenticated';

interface AdminSessionInfo {
  admin_id: string;
  display_name: string;
  branch_id?: string;
  branch_name?: string;
}

interface POSEntryGateProps {
  children: (mode: 'cashier' | 'admin', adminInfo?: AdminSessionInfo) => React.ReactNode;
  onModeResolved?: (mode: 'cashier' | 'admin', adminInfo?: AdminSessionInfo) => void;
}

export default function POSEntryGate({ children, onModeResolved }: POSEntryGateProps) {
  const [entryMode, setEntryMode] = useState<EntryMode>('select');
  const [checking, setChecking] = useState(true);
  const [adminInfo, setAdminInfo] = useState<AdminSessionInfo | null>(null);

  const checkExistingSession = useCallback(async () => {
    try {
      const res = await fetch('/api/pos/session/context', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        if (json.data?.pos_session_id) {
          if (json.data.pos_admin) {
            setAdminInfo({
              admin_id: json.data.pos_admin_id,
              display_name: json.data.cashier_name || 'أدمن',
              branch_id: json.data.branch_id,
            });
            setEntryMode('admin_authenticated');
          } else {
            setEntryMode('cashier');
          }
          setChecking(false);
          return;
        }
      }
    } catch {}
    try {
      const adminRes = await fetch('/api/pos/admin/context', { credentials: 'include' });
      if (adminRes.ok) {
        const adminJson = await adminRes.json();
        if (adminJson.data?.admin_id) {
          setAdminInfo({
            admin_id: adminJson.data.admin_id,
            display_name: adminJson.data.display_name,
          });
          setEntryMode('admin_authenticated');
          setChecking(false);
          return;
        }
      }
    } catch {}
    setEntryMode('cashier');
    setChecking(false);
  }, []);

  useEffect(() => {
    checkExistingSession();
  }, [checkExistingSession]);

  useEffect(() => {
    if (entryMode === 'cashier' && onModeResolved) {
      onModeResolved('cashier');
    } else if (entryMode === 'admin_authenticated' && adminInfo && onModeResolved) {
      onModeResolved('admin', adminInfo);
    }
  }, [entryMode, adminInfo, onModeResolved]);

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">جاري التحقق...</span>
        </div>
      </div>
    );
  }

  if (entryMode === 'cashier') {
    return <>{children('cashier')}</>;
  }

  if (entryMode === 'admin_authenticated' && adminInfo) {
    return <>{children('admin', adminInfo)}</>;
  }

  return <>{children('cashier')}</>;
}
