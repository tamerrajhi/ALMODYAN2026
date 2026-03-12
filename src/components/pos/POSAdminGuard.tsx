import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

interface POSAdminGuardProps {
  children: React.ReactNode;
}

export default function POSAdminGuard({ children }: POSAdminGuardProps) {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      let found = false;
      try {
        const sessionRes = await fetch('/api/pos/session/context', { credentials: 'include' });
        if (sessionRes.ok) {
          const json = await sessionRes.json();
          if (json?.data?.pos_admin === true) {
            found = true;
          }
        }
      } catch {}

      if (!found) {
        try {
          const adminRes = await fetch('/api/pos/admin/context', { credentials: 'include' });
          if (adminRes.ok) {
            const aJson = await adminRes.json();
            if (aJson?.data?.admin_id) {
              found = true;
            }
          }
        } catch {}
      }

      setIsAdmin(found);
      setChecking(false);
    })();
  }, []);

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/pos" replace />;
  }

  return <>{children}</>;
}
