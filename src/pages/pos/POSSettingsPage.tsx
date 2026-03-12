import { useNavigate } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Settings, UserCog, LayoutDashboard, ChevronLeft } from 'lucide-react';

export default function POSSettingsPage() {
  const navigate = useNavigate();

  return (
    <POSLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="page-header-rtl">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <Settings className="w-6 h-6 text-primary" />
              إعدادات نقطة البيع
            </h1>
            <p className="page-description">إدارة إعدادات وتهيئة نقطة البيع</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card
            className="cursor-pointer hover-elevate"
            onClick={() => navigate('/pos/settings/users')}
            data-testid="card-pos-users-settings"
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <UserCog className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground">إدارة مستخدمين نقاط البيع</p>
                <p className="text-sm text-muted-foreground mt-0.5">الكاشير والمشرفين وإدارة رموز PIN والبائعين</p>
              </div>
              <ChevronLeft className="w-5 h-5 text-muted-foreground shrink-0" />
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer hover-elevate"
            onClick={() => navigate('/pos/settings/dashboard')}
            data-testid="card-pos-dashboard-settings"
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center shrink-0">
                <LayoutDashboard className="w-6 h-6 text-cyan-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground">إعدادات لوحة التحكم</p>
                <p className="text-sm text-muted-foreground mt-0.5">إظهار وإخفاء أقسام لوحة التحكم</p>
              </div>
              <ChevronLeft className="w-5 h-5 text-muted-foreground shrink-0" />
            </CardContent>
          </Card>
        </div>
      </div>
    </POSLayout>
  );
}
