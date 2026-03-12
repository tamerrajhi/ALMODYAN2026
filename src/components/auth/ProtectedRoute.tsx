import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useScreenPermissions } from '@/hooks/useScreenPermissions';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const { isAdmin, isLoading: permissionsLoading, canViewScreen, getAllowedPaths } = useScreenPermissions();

  if (loading || permissionsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-gold mx-auto mb-4" />
          <p className="text-muted-foreground">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Admin can access everything
  if (isAdmin) {
    return <>{children}</>;
  }

  const currentPath = location.pathname;
  
  // Check if user has permission to view this screen
  if (!canViewScreen(currentPath)) {
    // Redirect to first allowed screen
    const allowedPaths = getAllowedPaths();
    if (allowedPaths.length > 0 && allowedPaths[0] !== '*') {
      return <Navigate to={allowedPaths[0]} replace />;
    }
    // No permissions at all - show unauthorized
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🚫</span>
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">غير مصرح لك بالوصول</h1>
          <p className="text-muted-foreground mb-4">ليس لديك صلاحية للوصول إلى هذه الصفحة</p>
          <p className="text-sm text-muted-foreground">تواصل مع المسؤول للحصول على الصلاحيات اللازمة</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
