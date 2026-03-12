import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { MapPin, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Branch } from '@/hooks/useBranches';

interface BranchZatcaStatus {
  branchId: string;
  status: 'not_started' | 'in_progress' | 'compliance_done' | 'production_ready' | 'completed';
}

interface ZatcaBranchSelectorProps {
  branches: Branch[];
  selectedBranchId: string | null;
  onBranchChange: (branchId: string) => void;
  branchStatuses: BranchZatcaStatus[];
  isLoading?: boolean;
}

export function ZatcaBranchSelector({
  branches,
  selectedBranchId,
  onBranchChange,
  branchStatuses,
  isLoading,
}: ZatcaBranchSelectorProps) {
  const { language } = useLanguage();

  const getStatusBadge = (branchId: string) => {
    const status = branchStatuses.find(s => s.branchId === branchId)?.status || 'not_started';
    
    switch (status) {
      case 'completed':
        return (
          <Badge variant="default" className="bg-green-600 text-white">
            <CheckCircle className="h-3 w-3 mr-1" />
            {language === 'ar' ? 'مُسجل' : 'Registered'}
          </Badge>
        );
      case 'production_ready':
      case 'compliance_done':
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          <CardTitle>
            {language === 'ar' ? 'اختر الفرع' : 'Select Branch'}
          </CardTitle>
        </div>
        <CardDescription>
          {language === 'ar' 
            ? 'اختر الفرع لعرض أو تعديل إعدادات ZATCA الخاصة به'
            : 'Select a branch to view or edit its ZATCA settings'
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Select
          value={selectedBranchId || ''}
          onValueChange={onBranchChange}
          disabled={isLoading}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={language === 'ar' ? 'اختر الفرع...' : 'Select branch...'} />
          </SelectTrigger>
          <SelectContent>
            {branches.map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                <div className="flex items-center justify-between gap-4 w-full">
                  <span>{branch.branch_name} ({branch.branch_code})</span>
                  {getStatusBadge(branch.id)}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
