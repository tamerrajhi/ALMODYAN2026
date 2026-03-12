import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckCircle, AlertCircle, Clock, Eye, Play, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Branch } from '@/hooks/useBranches';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';

interface BranchZatcaInfo {
  branchId: string;
  status: 'not_started' | 'in_progress' | 'compliance_done' | 'production_ready' | 'completed';
  csidExpiry: string | null;
  environment: 'sandbox' | 'production';
}

interface ZatcaBranchesOverviewProps {
  branches: Branch[];
  branchInfos: BranchZatcaInfo[];
  onSelectBranch: (branchId: string) => void;
  selectedBranchId: string | null;
}

export function ZatcaBranchesOverview({
  branches,
  branchInfos,
  onSelectBranch,
  selectedBranchId,
}: ZatcaBranchesOverviewProps) {
  const { language } = useLanguage();

  const getBranchInfo = (branchId: string): BranchZatcaInfo => {
    return branchInfos.find(info => info.branchId === branchId) || {
      branchId,
      status: 'not_started',
      csidExpiry: null,
      environment: 'sandbox',
    };
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge variant="default" className="bg-green-600 text-white">
            <CheckCircle className="h-3 w-3 mr-1" />
            {language === 'ar' ? 'مُسجل' : 'Registered'}
          </Badge>
        );
      case 'production_ready':
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
            <Clock className="h-3 w-3 mr-1" />
            {language === 'ar' ? 'جاهز للإنتاج' : 'Production Ready'}
          </Badge>
        );
      case 'compliance_done':
        return (
          <Badge variant="secondary" className="bg-amber-100 text-amber-800">
            <Clock className="h-3 w-3 mr-1" />
            {language === 'ar' ? 'اختبار مكتمل' : 'Compliance Done'}
          </Badge>
        );
      case 'in_progress':
        return (
          <Badge variant="secondary" className="bg-amber-100 text-amber-800">
            <Clock className="h-3 w-3 mr-1" />
            {language === 'ar' ? 'قيد التسجيل' : 'In Progress'}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground">
            <AlertCircle className="h-3 w-3 mr-1" />
            {language === 'ar' ? 'غير مُسجل' : 'Not Registered'}
          </Badge>
        );
    }
  };

  const getActionButton = (branchId: string, status: string) => {
    const isSelected = selectedBranchId === branchId;
    
    if (isSelected) {
      return (
        <Button variant="secondary" size="sm" disabled>
          <Eye className="h-4 w-4 mr-1" />
          {language === 'ar' ? 'معروض' : 'Viewing'}
        </Button>
      );
    }

    switch (status) {
      case 'completed':
        return (
          <Button variant="outline" size="sm" onClick={() => onSelectBranch(branchId)}>
            <Eye className="h-4 w-4 mr-1" />
            {language === 'ar' ? 'عرض' : 'View'}
          </Button>
        );
      case 'production_ready':
      case 'compliance_done':
      case 'in_progress':
        return (
          <Button variant="default" size="sm" onClick={() => onSelectBranch(branchId)}>
            <RotateCcw className="h-4 w-4 mr-1" />
            {language === 'ar' ? 'إكمال' : 'Continue'}
          </Button>
        );
      default:
        return (
          <Button variant="default" size="sm" onClick={() => onSelectBranch(branchId)}>
            <Play className="h-4 w-4 mr-1" />
            {language === 'ar' ? 'تسجيل' : 'Register'}
          </Button>
        );
    }
  };

  const formatExpiry = (expiry: string | null) => {
    if (!expiry) return '-';
    try {
      return format(new Date(expiry), 'yyyy-MM-dd', { locale: language === 'ar' ? ar : enUS });
    } catch {
      return '-';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {language === 'ar' ? 'نظرة عامة على الفروع' : 'Branches Overview'}
        </CardTitle>
        <CardDescription>
          {language === 'ar' 
            ? 'حالة تسجيل ZATCA لجميع الفروع'
            : 'ZATCA registration status for all branches'
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{language === 'ar' ? 'الفرع' : 'Branch'}</TableHead>
              <TableHead>{language === 'ar' ? 'الكود' : 'Code'}</TableHead>
              <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
              <TableHead>{language === 'ar' ? 'البيئة' : 'Environment'}</TableHead>
              <TableHead>{language === 'ar' ? 'انتهاء CSID' : 'CSID Expiry'}</TableHead>
              <TableHead>{language === 'ar' ? 'الإجراء' : 'Action'}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {branches.map((branch) => {
              const info = getBranchInfo(branch.id);
              return (
                <TableRow 
                  key={branch.id}
                  className={selectedBranchId === branch.id ? 'bg-muted/50' : ''}
                >
                  <TableCell className="font-medium">{branch.branch_name}</TableCell>
                  <TableCell>{branch.branch_code}</TableCell>
                  <TableCell>{getStatusBadge(info.status)}</TableCell>
                  <TableCell>
                    <Badge variant={info.environment === 'production' ? 'default' : 'secondary'}>
                      {info.environment === 'production' 
                        ? (language === 'ar' ? 'إنتاج' : 'Production')
                        : (language === 'ar' ? 'تجريبي' : 'Sandbox')
                      }
                    </Badge>
                  </TableCell>
                  <TableCell>{formatExpiry(info.csidExpiry)}</TableCell>
                  <TableCell>{getActionButton(branch.id, info.status)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
