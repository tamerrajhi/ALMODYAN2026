/**
 * Returns Hub Details Page
 * 
 * Shows detailed view based on return_type:
 * - unique: purchase_returns + purchase_return_items + unique_items + item_movements + journal_entries
 * - general: invoices + purchase_invoice_lines + journal_entries
 * 
 * P3-A: New canonical detail page, does not modify legacy screens
 * P6-3: Added void/cancel action with eligibility checks
 */

import { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  ArrowRight, 
  RotateCcw, 
  Loader2,
  AlertCircle,
  FileText,
  Package,
  Gem,
  Building2,
  Truck,
  Calendar,
  Hash,
  ExternalLink,
  BookOpen,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowLeftRight,
  Database,
  Ban,
} from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { VoidReturnDialog } from '@/components/purchasing/returns/VoidReturnDialog';
import { queryTable } from '@/lib/dataGateway';

// Types
interface UniqueReturnData {
  id: string;
  return_number: string;
  status: string;
  return_date: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  reason: string | null;
  notes: string | null;
  journal_entry_id: string | null;
  branch_id: string | null;
  supplier_id: string | null;
  unique_invoice_id: string | null;
  created_at: string;
  created_by: string | null;
  branches?: { branch_name: string } | null;
  suppliers?: { supplier_name: string } | null;
  invoices?: { invoice_number: string } | null;
}

interface UniqueReturnItem {
  id: string;
  unique_return_id: string;
  unique_item_id: string;
  unit_cost: number;
  qty: number;
  line_total: number;
  created_at: string;
  unique_items?: {
    serial_no: string | null;
    stockcode: string | null;
    model: string | null;
    description: string | null;
    cost: number | null;
    tag_price: number | null;
    type: string | null;
    metal: string | null;
    g_weight: number | null;
    branch_id: string | null;
  } | null;
}

interface ItemMovement {
  id: string;
  movement_type: string;
  movement_date: string;
  item_id: string | null;
  from_branch_id: string | null;
  to_branch_id: string | null;
  cost: number | null;
  notes: string | null;
}

// General returns now use canonical purchase_returns + purchase_return_lines
interface GeneralReturnData {
  id: string;
  return_number: string;
  status: string;
  return_date: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  reason: string | null;
  notes: string | null;
  journal_entry_id: string | null;
  branch_id: string | null;
  supplier_id: string | null;
  purchase_invoice_id: string | null;
  created_at: string;
  branches?: { branch_name: string } | null;
  suppliers?: { supplier_name: string } | null;
  invoices?: { invoice_number: string } | null;
}

interface GeneralReturnLine {
  id: string;
  description?: string | null;
  quantity: number;
  unit_cost: number;
  vat_rate: number;
  tax_amount: number;
  line_total: number;
  item_type: string;
  invoice_line_id?: string | null;
}

interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  is_posted: boolean;
  total_debit: number;
  total_credit: number;
}

interface JournalEntryLine {
  id: string;
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  description: string | null;
  chart_of_accounts?: { account_name: string; account_code: string } | null;
}

const ReturnsHubDetailsPage = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const { return_type, canonical_id } = useParams<{ return_type: string; canonical_id: string }>();
  
  // Void dialog state
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  
  // Type mismatch detection state
  const [typeMismatch, setTypeMismatch] = useState<{
    urlType: string;
    dbType: string;
    correctUrl: string;
  } | null>(null);

  // Determine which view mode based on URL return_type:
  // - 'unique' OR 'import' → jewelry items view (import track with item-level returns)
  // - 'general' → line-based view (general track with qty-based returns)
  // NOTE: Both 'unique' and 'import' routes should use the same jewelry item tracking
  const isUnique = return_type === 'unique' || return_type === 'import';
  const isGeneral = return_type === 'general';
  
  // Query to detect type mismatch - check both tables
  const { data: returnRecordAnyType } = useQuery({
    queryKey: ['return-any-type', canonical_id],
    queryFn: async () => {
      // First check v_returns_hub (canonical source)
      const { data: hubRow } = await queryTable('v_returns_hub', {
        select: 'return_type, canonical_id',
        filters: [{ type: 'eq', column: 'canonical_id', value: canonical_id! }],
        maybeSingle: true,
      });
      if (hubRow) {
        return { source: 'hub', return_type: hubRow.return_type };
      }
      return null;
    },
    enabled: !!canonical_id,
  });

  // Effect to detect type mismatch between URL and DB
  useEffect(() => {
    if (returnRecordAnyType && return_type) {
      const dbReturnType = returnRecordAnyType.return_type;
      
      // Both 'unique' and 'import' URL types are valid for 'unique' db type
      const isMatch = 
        dbReturnType === return_type || 
        (dbReturnType === 'unique' && (return_type === 'unique' || return_type === 'import'));
      
      if (!isMatch) {
        setTypeMismatch({
          urlType: return_type,
          dbType: dbReturnType,
          correctUrl: `/purchasing/returns-hub/${dbReturnType}/${canonical_id}`,
        });
      } else {
        setTypeMismatch(null);
      }
    }
  }, [returnRecordAnyType, return_type, canonical_id]);

  // Fetch v_returns_hub row for integrity info
  // Map URL return_type to view return_type:
  // - URL 'import' → view 'unique' (import purchases use jewelry item tracking)
  // - URL 'unique' → view 'unique'
  // - URL 'general' → view 'general'
  const viewReturnType = return_type === 'import' ? 'unique' : return_type;
  
  const { data: hubRow } = useQuery({
    queryKey: ['returns-hub-row', return_type, canonical_id],
    queryFn: async () => {
      const { data, error } = await queryTable('v_returns_hub', {
        select: '*',
        filters: [
          { type: 'eq', column: 'canonical_id', value: canonical_id },
          { type: 'eq', column: 'return_type', value: viewReturnType },
        ],
        maybeSingle: true,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!canonical_id && !!return_type,
  });

  // Fetch unique return data from unique_purchase_returns table
  const { data: uniqueReturn, isLoading: loadingUnique, error: errorUnique } = useQuery({
    queryKey: ['unique-return-detail', canonical_id],
    queryFn: async () => {
      const { data, error } = await queryTable('unique_purchase_returns', {
        select: '*',
        filters: [{ type: 'eq', column: 'id', value: canonical_id! }],
        maybeSingle: true,
      });
      if (error) throw error;
      if (data) {
        if (data.supplier_id) {
          const { data: s } = await queryTable('suppliers', { select: 'supplier_name', filters: [{ type: 'eq', column: 'id', value: data.supplier_id }], maybeSingle: true });
          data.suppliers = s ? { supplier_name: s.supplier_name } : null;
        } else {
          data.suppliers = null;
        }
        if (data.branch_id) {
          const { data: b } = await queryTable('branches', { select: 'branch_name', filters: [{ type: 'eq', column: 'id', value: data.branch_id }], maybeSingle: true });
          data.branches = b ? { branch_name: b.branch_name } : null;
        } else {
          data.branches = null;
        }
        if (data.unique_invoice_id) {
          const { data: inv } = await queryTable('unique_purchase_invoices', { select: 'invoice_number', filters: [{ type: 'eq', column: 'id', value: data.unique_invoice_id }], maybeSingle: true });
          data.invoices = inv ? { invoice_number: inv.invoice_number } : null;
        } else {
          data.invoices = null;
        }
      }
      return data as UniqueReturnData | null;
    },
    enabled: isUnique && !!canonical_id,
  });

  // Fetch unique return items from unique_purchase_return_items table
  const { data: uniqueItems = [] } = useQuery({
    queryKey: ['unique-return-items', canonical_id],
    queryFn: async () => {
      const { data, error } = await queryTable('unique_purchase_return_items', {
        select: '*',
        filters: [{ type: 'eq', column: 'unique_return_id', value: canonical_id! }],
      });
      if (error) throw error;
      const items = data || [];
      for (const item of items) {
        if (item.unique_item_id) {
          const { data: ji } = await queryTable('unique_items', {
            select: 'serial_no, stockcode, model, description, cost, tag_price, type, metal, g_weight, branch_id',
            filters: [{ type: 'eq', column: 'id', value: item.unique_item_id }],
            maybeSingle: true,
          });
          item.unique_items = ji || null;
        } else {
          item.unique_items = null;
        }
      }
      return items as UniqueReturnItem[];
    },
    enabled: isUnique && !!canonical_id,
  });

  // Fetch item movements for unique return
  const { data: movements = [] } = useQuery({
    queryKey: ['unique-return-movements', canonical_id],
    queryFn: async () => {
      const { data, error } = await queryTable('unique_item_movements', {
        select: '*',
        filters: [
          { type: 'eq', column: 'reference_type', value: 'purchase_return' },
          { type: 'eq', column: 'reference_id', value: canonical_id! },
          { type: 'eq', column: 'movement_type', value: 'PURCHASE_RETURN' },
        ],
      });
      if (error) throw error;
      return (data || []) as ItemMovement[];
    },
    enabled: isUnique && !!canonical_id,
  });

  // Fetch general return data from CANONICAL purchase_returns table
  // Only enabled for 'general' URL route
  const { data: generalReturn, isLoading: loadingGeneral, error: errorGeneral } = useQuery({
    queryKey: ['general-return-detail', canonical_id],
    queryFn: async () => {
      const { data, error } = await queryTable('purchase_returns', {
        select: '*',
        filters: [
          { type: 'eq', column: 'id', value: canonical_id! },
          { type: 'eq', column: 'purchase_type', value: 'general' },
        ],
        maybeSingle: true,
      });
      if (error) throw error;
      if (data) {
        if (data.supplier_id) {
          const { data: s } = await queryTable('suppliers', { select: 'supplier_name', filters: [{ type: 'eq', column: 'id', value: data.supplier_id }], maybeSingle: true });
          data.suppliers = s ? { supplier_name: s.supplier_name } : null;
        } else {
          data.suppliers = null;
        }
        if (data.branch_id) {
          const { data: b } = await queryTable('branches', { select: 'branch_name', filters: [{ type: 'eq', column: 'id', value: data.branch_id }], maybeSingle: true });
          data.branches = b ? { branch_name: b.branch_name } : null;
        } else {
          data.branches = null;
        }
        if (data.purchase_invoice_id) {
          const { data: inv } = await queryTable('invoices', { select: 'invoice_number', filters: [{ type: 'eq', column: 'id', value: data.purchase_invoice_id }], maybeSingle: true });
          data.invoices = inv ? { invoice_number: inv.invoice_number } : null;
        } else {
          data.invoices = null;
        }
      }
      return data as GeneralReturnData | null;
    },
    enabled: isGeneral && !!canonical_id,
  });

  // Fetch general return lines from CANONICAL purchase_return_lines table
  const { data: generalLines = [] } = useQuery({
    queryKey: ['general-return-lines', canonical_id],
    queryFn: async () => {
      const { data, error } = await queryTable('purchase_return_lines', {
        select: '*',
        filters: [{ type: 'eq', column: 'return_id', value: canonical_id! }],
      });
      if (error) throw error;
      return (data || []) as GeneralReturnLine[];
    },
    enabled: isGeneral && !!canonical_id,
  });

  // Fetch journal entry
  const journalEntryId = isUnique ? uniqueReturn?.journal_entry_id : generalReturn?.journal_entry_id;
  
  const { data: journalEntry } = useQuery({
    queryKey: ['return-journal-entry', journalEntryId],
    queryFn: async () => {
      const { data, error } = await queryTable('journal_entries', {
        select: '*',
        filters: [{ type: 'eq', column: 'id', value: journalEntryId! }],
        maybeSingle: true,
      });
      if (error) throw error;
      return data as JournalEntry | null;
    },
    enabled: !!journalEntryId,
  });

  const { data: journalLines = [] } = useQuery({
    queryKey: ['return-journal-lines', journalEntryId],
    queryFn: async () => {
      const { data, error } = await queryTable('journal_entry_lines', {
        select: '*',
        filters: [{ type: 'eq', column: 'journal_entry_id', value: journalEntryId! }],
      });
      if (error) throw error;
      const lines = data || [];
      const accountIds = [...new Set(lines.map((l: any) => l.account_id).filter(Boolean))];
      if (accountIds.length > 0) {
        const { data: accounts } = await queryTable('chart_of_accounts', {
          select: 'id, account_name, account_code',
          filters: [{ type: 'in', column: 'id', value: accountIds }],
        });
        const acctMap: Record<string, any> = {};
        (accounts || []).forEach((a: any) => { acctMap[a.id] = a; });
        lines.forEach((l: any) => {
          l.chart_of_accounts = acctMap[l.account_id] || null;
        });
      }
      return lines as JournalEntryLine[];
    },
    enabled: !!journalEntryId,
  });

  const isLoading = isUnique ? loadingUnique : loadingGeneral;
  const error = isUnique ? errorUnique : errorGeneral;
  const returnData = isUnique ? uniqueReturn : generalReturn;
  const returnNumber = isUnique 
    ? (uniqueReturn as UniqueReturnData)?.return_number 
    : (generalReturn as GeneralReturnData)?.return_number;

  // Void eligibility check
  // Unique: status IN ('confirmed','posted') AND not voided/cancelled
  // General: status IN ('confirmed','posted','pending','partial') AND not voided/cancelled
  const canVoid = useMemo(() => {
    if (!returnData) return false;
    const status = returnData.status;
    
    // Already voided/cancelled = cannot void
    if (status === 'voided' || status === 'cancelled') return false;
    
    if (isUnique) {
      return ['confirmed', 'posted'].includes(status);
    } else {
      return ['confirmed', 'posted', 'pending', 'partial'].includes(status);
    }
  }, [returnData, isUnique]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return format(new Date(dateStr), 'dd/MM/yyyy', {
      locale: language === 'ar' ? ar : undefined,
    });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      pending: { label: language === 'ar' ? 'معلق' : 'Pending', variant: 'secondary' },
      approved: { label: language === 'ar' ? 'معتمد' : 'Approved', variant: 'default' },
      completed: { label: language === 'ar' ? 'مكتمل' : 'Completed', variant: 'default' },
      confirmed: { label: language === 'ar' ? 'مؤكد' : 'Confirmed', variant: 'default' },
      posted: { label: language === 'ar' ? 'مرحّل' : 'Posted', variant: 'default' },
      cancelled: { label: language === 'ar' ? 'ملغي' : 'Cancelled', variant: 'destructive' },
      voided: { label: language === 'ar' ? 'ملغي' : 'Voided', variant: 'destructive' },
    };
    const config = statusConfig[status] || { label: status, variant: 'outline' as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  // Invalid params - now supports 'unique', 'general', and 'import' types
  const validReturnTypes = ['unique', 'general', 'import'];
  if (!return_type || !canonical_id || !validReturnTypes.includes(return_type)) {
    return (
      <MainLayout>
        <div className="p-8">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {language === 'ar' ? 'معرف غير صالح' : 'Invalid return identifier'}
            </AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  if (error) {
    return (
      <MainLayout>
        <div className="p-8">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {language === 'ar' ? 'فشل في تحميل البيانات' : 'Failed to load data'}
            </AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => navigate('/purchasing/returns-hub')}
            >
              <ArrowRight className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Database className="w-6 h-6 text-orange-500" />
                {language === 'ar' ? 'تفاصيل المرتجع' : 'Return Details'}
              </h1>
              <p className="text-muted-foreground text-sm flex items-center gap-2">
                {returnNumber || '...'}
                <Badge variant="outline" className={cn(
                  "gap-1",
                  isUnique 
                    ? "bg-purple-50 text-purple-700 border-purple-200" 
                    : "bg-blue-50 text-blue-700 border-blue-200"
                )}>
                  {isUnique ? <Gem className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                  {isUnique 
                    ? (language === 'ar' ? 'قطع فريدة' : 'Unique') 
                    : (language === 'ar' ? 'كميات' : 'General')}
                </Badge>
              </p>
            </div>
          </div>

          {returnData && (
            <div className="flex items-center gap-3">
              {/* Void Button - only show when eligible */}
              {canVoid && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowVoidDialog(true)}
                >
                  <Ban className="w-4 h-4 mr-2" />
                  {language === 'ar' ? 'إلغاء المرتجع' : 'Void Return'}
                </Button>
              )}
              {getStatusBadge(returnData.status)}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : typeMismatch ? (
          <Alert className="border-amber-200 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-amber-800">
                {language === 'ar' 
                  ? `نوع المرتجع غير متطابق: هذا المرتجع من نوع "${typeMismatch.dbType}" لكن الرابط يشير إلى "${typeMismatch.urlType}"`
                  : `Return type mismatch: this return is "${typeMismatch.dbType}" but URL indicates "${typeMismatch.urlType}"`}
              </span>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => navigate(typeMismatch.correctUrl)}
              >
                {language === 'ar' ? 'الانتقال للنوع الصحيح' : 'Go to correct type'}
              </Button>
            </AlertDescription>
          </Alert>
        ) : !returnData ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {language === 'ar' ? 'المرتجع غير موجود' : 'Return not found'}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Return Info */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    {language === 'ar' ? 'معلومات المرتجع' : 'Return Information'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="flex items-start gap-2">
                      <Hash className="w-4 h-4 text-muted-foreground mt-0.5" />
                      <div>
                        <span className="text-muted-foreground block">
                          {language === 'ar' ? 'رقم المرتجع' : 'Return No.'}
                        </span>
                        <p className="font-medium">{returnNumber}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground mt-0.5" />
                      <div>
                        <span className="text-muted-foreground block">
                          {language === 'ar' ? 'التاريخ' : 'Date'}
                        </span>
                        <p className="font-medium">
                          {formatDate(isUnique 
                            ? (uniqueReturn as UniqueReturnData)?.return_date 
                            : (generalReturn as GeneralReturnData)?.return_date)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Truck className="w-4 h-4 text-muted-foreground mt-0.5" />
                      <div>
                        <span className="text-muted-foreground block">
                          {language === 'ar' ? 'المورد' : 'Supplier'}
                        </span>
                        <p className="font-medium">
                          {returnData.suppliers?.supplier_name || '-'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Building2 className="w-4 h-4 text-muted-foreground mt-0.5" />
                      <div>
                        <span className="text-muted-foreground block">
                          {language === 'ar' ? 'الفرع' : 'Branch'}
                        </span>
                        <p className="font-medium">
                          {returnData.branches?.branch_name || '-'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Linked Invoice (for unique) */}
                  {isUnique && (uniqueReturn as UniqueReturnData)?.invoices?.invoice_number && (
                    <>
                      <Separator className="my-4" />
                      <div className="flex items-center gap-2 text-sm">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {language === 'ar' ? 'الفاتورة الأصلية:' : 'Original Invoice:'}
                        </span>
                        <Link 
                          to={`/purchasing/invoices/${(uniqueReturn as UniqueReturnData)?.unique_invoice_id}/view`}
                          className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                        >
                          {(uniqueReturn as UniqueReturnData)?.invoices?.invoice_number}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    </>
                  )}

                  {/* Journal Entry Link */}
                  {journalEntryId && (
                    <>
                      <Separator className="my-4" />
                      <div className="flex items-center gap-2 text-sm">
                        <BookOpen className="w-4 h-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {language === 'ar' ? 'القيد المحاسبي:' : 'Journal Entry:'}
                        </span>
                        <Link 
                          to={`/accounting/journal-entries?id=${journalEntryId}`}
                          className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                        >
                          {journalEntry?.entry_number || (language === 'ar' ? 'عرض القيد' : 'View Entry')}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Items Table (Unique) */}
              {isUnique && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Gem className="w-4 h-4" />
                      {language === 'ar' ? 'القطع المرتجعة' : 'Returned Items'}
                      <Badge variant="secondary">{uniqueItems.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{language === 'ar' ? 'الرقم التسلسلي' : 'Serial No.'}</TableHead>
                          <TableHead>{language === 'ar' ? 'كود المخزون' : 'Stock Code'}</TableHead>
                          <TableHead>{language === 'ar' ? 'الوصف' : 'Description'}</TableHead>
                          <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                          <TableHead>{language === 'ar' ? 'المعدن' : 'Metal'}</TableHead>
                          <TableHead className="text-end">{language === 'ar' ? 'الوزن (جم)' : 'Weight (g)'}</TableHead>
                          <TableHead className="text-end">{language === 'ar' ? 'التكلفة' : 'Cost'}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {uniqueItems.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-mono text-sm">
                              {item.unique_items?.serial_no || '-'}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {item.unique_items?.stockcode || item.unique_items?.model || '-'}
                            </TableCell>
                            <TableCell>
                              {item.unique_items?.description || '-'}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {item.unique_items?.type || '-'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {item.unique_items?.metal || '-'}
                            </TableCell>
                            <TableCell className="text-end" dir="ltr">
                              {item.unique_items?.g_weight != null ? Number(item.unique_items.g_weight).toFixed(2) : '-'}
                            </TableCell>
                            <TableCell className="text-end" dir="ltr">
                              {formatCurrency(item.unit_cost || item.line_total)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Lines Table (General) */}
              {!isUnique && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Package className="w-4 h-4" />
                      {language === 'ar' ? 'بنود المرتجع' : 'Return Lines'}
                      <Badge variant="secondary">{generalLines.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {generalLines.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        {language === 'ar' ? 'لا توجد بنود' : 'No lines found'}
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{language === 'ar' ? 'الوصف' : 'Description'}</TableHead>
                            <TableHead className="text-center">{language === 'ar' ? 'الكمية' : 'Qty'}</TableHead>
                            <TableHead className="text-end">{language === 'ar' ? 'سعر الوحدة' : 'Unit Price'}</TableHead>
                            <TableHead className="text-end">{language === 'ar' ? 'الضريبة' : 'Tax'}</TableHead>
                            <TableHead className="text-end">{language === 'ar' ? 'الإجمالي' : 'Total'}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {generalLines.map((line) => (
                            <TableRow key={line.id}>
                              <TableCell>{line.description || '-'}</TableCell>
                              <TableCell className="text-center">{line.quantity}</TableCell>
                              <TableCell className="text-end" dir="ltr">{formatCurrency(line.unit_cost)}</TableCell>
                              <TableCell className="text-end" dir="ltr">{formatCurrency(line.tax_amount)}</TableCell>
                              <TableCell className="text-end" dir="ltr">{formatCurrency(line.line_total)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Movements Table (Unique Only) */}
              {isUnique && movements.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <ArrowLeftRight className="w-4 h-4" />
                      {language === 'ar' ? 'حركات المخزون' : 'Item Movements'}
                      <Badge variant="secondary">{movements.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                          <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                          <TableHead className="text-end">{language === 'ar' ? 'التكلفة' : 'Cost'}</TableHead>
                          <TableHead>{language === 'ar' ? 'ملاحظات' : 'Notes'}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {movements.map((mov) => (
                          <TableRow key={mov.id}>
                            <TableCell>
                              <Badge variant="outline">{mov.movement_type}</Badge>
                            </TableCell>
                            <TableCell>{formatDate(mov.movement_date)}</TableCell>
                            <TableCell className="text-end" dir="ltr">
                              {formatCurrency(mov.cost)}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {mov.notes || '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Journal Entry Lines */}
              {journalEntry && journalLines.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <BookOpen className="w-4 h-4" />
                      {language === 'ar' ? 'بنود القيد المحاسبي' : 'Journal Entry Lines'}
                      <Badge variant="secondary">{journalEntry.entry_number}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{language === 'ar' ? 'الحساب' : 'Account'}</TableHead>
                          <TableHead className="text-end">{language === 'ar' ? 'مدين' : 'Debit'}</TableHead>
                          <TableHead className="text-end">{language === 'ar' ? 'دائن' : 'Credit'}</TableHead>
                          <TableHead>{language === 'ar' ? 'البيان' : 'Description'}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {journalLines.map((line) => (
                          <TableRow key={line.id}>
                            <TableCell>
                              <span className="font-mono text-xs text-muted-foreground">
                                {line.chart_of_accounts?.account_code}
                              </span>
                              {' '}
                              {line.chart_of_accounts?.account_name || '-'}
                            </TableCell>
                            <TableCell className="text-end" dir="ltr">
                              {line.debit_amount > 0 ? formatCurrency(line.debit_amount) : '-'}
                            </TableCell>
                            <TableCell className="text-end" dir="ltr">
                              {line.credit_amount > 0 ? formatCurrency(line.credit_amount) : '-'}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {line.description || '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals row */}
                        <TableRow className="font-medium bg-muted/50">
                          <TableCell>{language === 'ar' ? 'الإجمالي' : 'Total'}</TableCell>
                          <TableCell className="text-end" dir="ltr">
                            {formatCurrency(journalEntry.total_debit)}
                          </TableCell>
                          <TableCell className="text-end" dir="ltr">
                            {formatCurrency(journalEntry.total_credit)}
                          </TableCell>
                          <TableCell>
                            {journalEntry.total_debit === journalEntry.total_credit ? (
                              <Badge variant="default" className="gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                {language === 'ar' ? 'متوازن' : 'Balanced'}
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                {language === 'ar' ? 'غير متوازن' : 'Unbalanced'}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Summary */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {language === 'ar' ? 'ملخص المرتجع' : 'Return Summary'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {language === 'ar' ? 'المبلغ الفرعي' : 'Subtotal'}
                    </span>
                    <span dir="ltr">{formatCurrency(returnData.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {language === 'ar' ? 'الضريبة' : 'Tax'}
                    </span>
                    <span dir="ltr">{formatCurrency(returnData.tax_amount)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-medium">
                    <span>{language === 'ar' ? 'الإجمالي' : 'Total'}</span>
                    <span className="text-lg text-primary" dir="ltr">
                      {formatCurrency(returnData.total_amount)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Integrity Panel (Unique Only) */}
              {isUnique && hubRow && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Database className="w-4 h-4" />
                      {language === 'ar' ? 'التكامل' : 'Integrity'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {language === 'ar' ? 'الحركات المتوقعة' : 'Expected Movements'}
                      </span>
                      <span>{hubRow.expected_movement_count ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {language === 'ar' ? 'الحركات الفعلية' : 'Actual Movements'}
                      </span>
                      <span>{hubRow.actual_movement_count ?? 0}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">
                        {language === 'ar' ? 'حالة التكامل' : 'Drift Status'}
                      </span>
                      {hubRow.has_drift ? (
                        <Badge variant="outline" className="gap-1 bg-orange-50 text-orange-700 border-orange-200">
                          <AlertTriangle className="w-3 h-3" />
                          {hubRow.drift_type === 'movement_mismatch' 
                            ? (language === 'ar' ? 'فرق حركة' : 'Movement Mismatch')
                            : hubRow.drift_type === 'branch_not_cleared'
                            ? (language === 'ar' ? 'فرع غير مُخلى' : 'Branch Not Cleared')
                            : (language === 'ar' ? 'انحراف' : 'Drift')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 bg-green-50 text-green-700 border-green-200">
                          <CheckCircle2 className="w-3 h-3" />
                          {language === 'ar' ? 'سليم' : 'OK'}
                        </Badge>
                      )}
                    </div>
                    {hubRow.mirror_exists && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">
                          {language === 'ar' ? 'مرآة فاتورة' : 'Invoice Mirror'}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {language === 'ar' ? 'موجود' : 'Exists'}
                        </Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Void Return Dialog */}
      {canonical_id && return_type && returnNumber && (
        <VoidReturnDialog
          open={showVoidDialog}
          onOpenChange={setShowVoidDialog}
          returnType={isUnique ? 'unique' : 'general'}
          canonicalId={canonical_id}
          returnNumber={returnNumber}
          branchId={returnData?.branch_id || undefined}
        />
      )}
    </MainLayout>
  );
};

export default ReturnsHubDetailsPage;
