import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarIcon, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBranches } from '@/hooks/useBranches';
import { cn } from '@/lib/utils';

interface ReportFiltersProps {
  showBranchFilter?: boolean;
  showDateFilter?: boolean;
  selectedBranch?: string;
  onBranchChange?: (branchId: string) => void;
  dateFrom?: Date;
  dateTo?: Date;
  onDateFromChange?: (date: Date | undefined) => void;
  onDateToChange?: (date: Date | undefined) => void;
  onReset?: () => void;
}

export default function ReportFilters({
  showBranchFilter = true,
  showDateFilter = true,
  selectedBranch,
  onBranchChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onReset
}: ReportFiltersProps) {
  const { t, language } = useLanguage();
  const { data: branches } = useBranches();
  const dateLocale = language === 'ar' ? ar : enUS;

  return (
    <div className="flex flex-wrap gap-3 items-center p-4 bg-muted/30 rounded-lg border">
      <Filter className="w-4 h-4 text-muted-foreground" />
      
      {showBranchFilter && (
        <Select value={selectedBranch || 'all'} onValueChange={onBranchChange}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t.dashboard.allBranches} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.dashboard.allBranches}</SelectItem>
            {branches?.map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.branch_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {showDateFilter && (
        <>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-40 justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateFrom ? format(dateFrom, 'PP', { locale: dateLocale }) : t.common.from}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateFrom}
                onSelect={onDateFromChange}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-40 justify-start text-left font-normal", !dateTo && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateTo ? format(dateTo, 'PP', { locale: dateLocale }) : t.common.to}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateTo}
                onSelect={onDateToChange}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </>
      )}

      {onReset && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          {t.common.reset}
        </Button>
      )}
    </div>
  );
}
