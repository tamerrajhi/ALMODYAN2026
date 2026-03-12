import { useState, useMemo, useRef, useEffect, useCallback, startTransition } from 'react';
import { useLocation } from 'react-router-dom';
import POSLayout, { AdminBranchGuard } from '@/components/pos/POSLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { 
  Search, 
  FileText, 
  Building2,
  User,
  Loader2,
  Printer,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Calendar,
  ScanBarcode,
  Clock,
  Wallet,
  Hash,
  RefreshCw,
  ShieldCheck,
  Lock
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import * as posGw from '@/lib/posDataGateway';
import * as apiClient from '@/lib/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import POSReturnReceipt from '@/components/pos/POSReturnReceipt';
// OPS-P1: Removed legacy pos-return-workflow import - now using atomic RPC
import { logAudit } from '@/lib/audit';
import { formatCurrency } from '@/lib/utils';
import { useUserBranches } from '@/hooks/useUserBranches';
import BranchLoginGate from '@/components/pos/BranchLoginGate';
import POSCashierGate, { CashierHeaderBadge } from '@/components/pos/POSCashierGate';
import { useLanguage } from '@/contexts/LanguageContext';
import { useReactToPrint } from 'react-to-print';
import { logPosAttemptStart, logPosAttemptFail, logPosAttemptSuccess, POS_ERROR_CODES } from '@/lib/posRequestLogger';
import { 
  SelectedInvoiceCard, 
  ReturnItemsTable, 
  ReturnSummaryCard, 
  ReturnDetailsCard,
  PreviousReturnsSection,
  AllReturnsSection
} from '@/components/pos/return';

interface SaleForReturn {
  id: string;
  sale_code: string;
  invoice_number?: string;
  sale_date: string;
  total_amount: number;
  customer_id?: string;
  customer_name?: string;
  branch_id: string;
  branch_name?: string;
  branch_code?: string;
  cashier_name?: string;
  shift_number?: string;
  payment_status?: 'paid' | 'partial' | 'pending';
}

interface SaleItem {
  id: string;
  item_id: string;
  item_code: string;
  item_name: string;
  barcode?: string;
  original_quantity: number;
  previously_returned: number;
  available_quantity: number;
  return_quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
  return_reason: string;
  selected: boolean;
}

interface CompletedReturn {
  returnCode: string;
  returnDate: Date;
  branchName: string;
  originalInvoice: string;
  customerName?: string;
  items: SaleItem[];
  subtotalBeforeTax: number;
  taxAmount: number;
  totalAmount: number;
  refundMethod: string;
  returnReason: string;
  processedBy: string;
  returnType?: 'partial' | 'full';
}

interface ReturnSettings {
  max_return_days: number;
  max_return_amount_without_approval: number;
  require_manager_approval: boolean;
  allow_store_credit: boolean;
  allow_cash_refund: boolean;
  allow_card_refund: boolean;
}

export default function POSReturnPage() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const { userBranches, primaryBranch, isLoading: branchesLoading } = useUserBranches();

  // Release any global interaction locks - optimized with requestAnimationFrame
  const releaseGlobalInteractionLocks = () => {
    requestAnimationFrame(() => {
      const html = document.documentElement;
      const body = document.body;
      const root = document.getElementById('root');

      html.style.pointerEvents = '';
      html.style.overflow = '';
      html.removeAttribute('inert');
      html.removeAttribute('aria-hidden');
      html.removeAttribute('data-scroll-locked');

      body.style.pointerEvents = '';
      body.style.overflow = '';
      body.removeAttribute('inert');
      body.removeAttribute('aria-hidden');
      body.removeAttribute('data-scroll-locked');

      if (root) {
        root.style.pointerEvents = '';
        root.style.overflow = '';
        root.removeAttribute('inert');
        root.removeAttribute('aria-hidden');
        root.removeAttribute('data-scroll-locked');
      }
    });
  };

  // State
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [serialSearch, setSerialSearch] = useState('');
  const [serialResults, setSerialResults] = useState<any[]>([]);
  const [serialLoading, setSerialLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [barcodeSearch, setBarcodeSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [searchAllBranches, setSearchAllBranches] = useState(false);
  const [selectedSale, setSelectedSale] = useState<SaleForReturn | null>(null);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [returnType, setReturnType] = useState<'partial' | 'full'>('partial');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'card' | 'store_credit'>('cash');
  const [selectedBankAccount, setSelectedBankAccount] = useState<string>('');
  const [returnReason, setReturnReason] = useState('');
  const [notes, setNotes] = useState('');

  const [showCheckoutDialog, setShowCheckoutDialog] = useState(false);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [completedReturn, setCompletedReturn] = useState<CompletedReturn | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  // OPS-P1: Idempotency key via useRef - stable across retries
  const clientRequestIdRef = useRef<string | null>(null);

  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [overrideSupervisorId, setOverrideSupervisorId] = useState('');
  const [overridePin, setOverridePin] = useState('');
  const [overrideNotes, setOverrideNotes] = useState('موافقة مشرف على مرتجع POS');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isPosAdmin, setIsPosAdmin] = useState(false);

  const receiptRef = useRef<HTMLDivElement>(null);

  // Release interaction locks on mount and cleanup
  useEffect(() => {
    releaseGlobalInteractionLocks();
    return () => {
      releaseGlobalInteractionLocks();
    };
  }, []);

  useEffect(() => {
    fetch('/api/pos/session/context', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (json?.data?.pos_admin) setIsPosAdmin(true);
      })
      .catch(() => {});
  }, []);

  // Loading timeout to prevent infinite loading
  useEffect(() => {
    if (!branchesLoading) {
      setLoadingTimeout(false);
      return;
    }
    
    const timer = setTimeout(() => {
      if (branchesLoading) {
        setLoadingTimeout(true);
      }
    }, 8000);
    
    return () => clearTimeout(timer);
  }, [branchesLoading]);

  const [gateBranchId, setGateBranchId] = useState<string | null>(null);
  const [gateBranchName, setGateBranchName] = useState<string | null>(null);

  useEffect(() => {
    if (gateBranchId) {
      setSelectedBranch(gateBranchId);
    } else if (primaryBranch) {
      setSelectedBranch(prev => prev || primaryBranch.branch_id);
    }
  }, [gateBranchId, primaryBranch]);

  // Serial number search - debounced
  useEffect(() => {
    if (serialSearch.length < 2) {
      setSerialResults([]);
      return;
    }
    setSerialLoading(true);
    const timer = setTimeout(async () => {
      try {
        const params: Record<string, string> = { serial_no: serialSearch };
        if (selectedBranch && !searchAllBranches) params.branch_id = selectedBranch;
        const res = await fetch(`/api/pos/sale-by-serial?${new URLSearchParams(params)}`, { credentials: 'include' });
        if (res.ok) {
          const json = await res.json();
          setSerialResults(json.data || []);
        }
      } catch (err) {
        console.error('Serial search error:', err);
      } finally {
        setSerialLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [serialSearch, selectedBranch, searchAllBranches]);

  // Auto-load sale from ?sale_id= or ?invoice_id= query param
  const location = useLocation();
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const querySaleId = useMemo(() => queryParams.get('sale_id'), [queryParams]);
  const queryInvoiceId = useMemo(() => queryParams.get('invoice_id'), [queryParams]);
  const [autoLoadAttempted, setAutoLoadAttempted] = useState(false);
  const [autoLoading, setAutoLoading] = useState(!!(querySaleId || queryInvoiceId));

  // Resolve sale_id: either directly from query param, or by fetching invoice first
  const resolveSaleId = useCallback(async (): Promise<string | null> => {
    if (querySaleId) return querySaleId;
    if (queryInvoiceId) {
      const res = await fetch(`/api/pos/invoice/${queryInvoiceId}`, { credentials: 'include' });
      if (!res.ok) {
        toast.error('لم يتم العثور على الفاتورة المطلوبة');
        return null;
      }
      const inv = await res.json();
      if (!inv?.sale_id) {
        toast.error('هذه فاتورة مبيعات عامة — استخدم مرتجع المبيعات العامة');
        return null;
      }
      return inv.sale_id;
    }
    return null;
  }, [querySaleId, queryInvoiceId]);

  useEffect(() => {
    if ((!querySaleId && !queryInvoiceId) || autoLoadAttempted || selectedSale) return;
    setAutoLoadAttempted(true);
    setAutoLoading(true);

    (async () => {
      try {
        const resolvedSaleId = await resolveSaleId();
        if (!resolvedSaleId) {
          setAutoLoading(false);
          return;
        }

        const { data: saleData } = await posGw.queryTable('sales', {
          select: 'id, sale_code, created_at, total_amount, customer_id, branch_id',
          filters: [{ type: 'eq', column: 'id', value: resolvedSaleId }],
          maybeSingle: true,
        });
        if (!saleData) {
          toast.error('لم يتم العثور على عملية البيع المطلوبة');
          setAutoLoading(false);
          return;
        }
        const sale = saleData as any;
        let customerName = '';
        let branchName = '';
        let branchCode = '';
        if (sale.customer_id) {
          const { data: cust } = await posGw.queryTable('customers', {
            select: 'full_name',
            filters: [{ type: 'eq', column: 'id', value: sale.customer_id }],
            maybeSingle: true,
          });
          if (cust) customerName = (cust as any).full_name || '';
        }
        if (sale.branch_id) {
          const { data: br } = await posGw.queryTable('branches', {
            select: 'branch_name, branch_code',
            filters: [{ type: 'eq', column: 'id', value: sale.branch_id }],
            maybeSingle: true,
          });
          if (br) {
            branchName = (br as any).branch_name || '';
            branchCode = (br as any).branch_code || '';
          }
          setSelectedBranch(sale.branch_id);
        }
        const saleForReturn: SaleForReturn = {
          id: sale.id,
          sale_code: sale.sale_code,
          sale_date: sale.created_at,
          total_amount: sale.total_amount,
          customer_id: sale.customer_id || undefined,
          customer_name: customerName,
          branch_id: sale.branch_id,
          branch_name: branchName,
          branch_code: branchCode,
        };
        startTransition(() => {
          setSelectedSale(saleForReturn);
          setAutoLoading(false);
        });
      } catch (err) {
        console.error('Error auto-loading sale:', err);
        toast.error('حدث خطأ في تحميل بيانات عملية البيع');
        setAutoLoading(false);
      }
    })();
  }, [querySaleId, queryInvoiceId, autoLoadAttempted, selectedSale, resolveSaleId]);

  // Fetch return settings - only when branch is selected
  const { data: returnSettings } = useQuery({
    queryKey: ['return-settings', selectedBranch],
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async (): Promise<ReturnSettings> => {
      if (selectedBranch) {
        const { data: branchSettings } = await posGw.queryTable('return_settings', {
          select: '*',
          filters: [{ type: 'eq', column: 'branch_id', value: selectedBranch }],
          maybeSingle: true,
        });
        if (branchSettings) {
          return branchSettings as ReturnSettings;
        }
      }
      const { data: globalSettings } = await posGw.queryTable('return_settings', {
        select: '*',
        filters: [{ type: 'is', column: 'branch_id', value: null }],
        maybeSingle: true,
      });
      return globalSettings as ReturnSettings || {
        max_return_days: 30,
        max_return_amount_without_approval: 5000,
        require_manager_approval: false,
        allow_store_credit: true,
        allow_cash_refund: true,
        allow_card_refund: true,
      };
    },
    enabled: !!selectedBranch,
  });

  // Fetch current user profile
  const { data: currentUserProfile } = useQuery({
    queryKey: ['current-user-profile'],
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await posGw.queryTable('profiles', {
        select: 'user_id, full_name, username',
        filters: [{ type: 'eq', column: 'user_id', value: user.id }],
        maybeSingle: true,
      });
      return data;
    },
  });

  // Fetch customer credit balance
  const { data: customerCreditBalance = 0 } = useQuery({
    queryKey: ['customer-credit-balance', selectedSale?.customer_id],
    queryFn: async () => {
      if (!selectedSale?.customer_id) return 0;
      
      const { data, error } = await posGw.rpc('get_customer_credit_balance', {
        p_customer_id: selectedSale.customer_id
      });
      
      if (error) {
        console.error('Error fetching credit balance:', error);
        return 0;
      }
      
      return data || 0;
    },
    enabled: !!selectedSale?.customer_id,
  });

  // Fetch sales for search with advanced filters
  const { data: salesList = [], isLoading: salesLoading } = useQuery({
    queryKey: ['pos-sales-for-return', selectedBranch, invoiceSearch, customerSearch, barcodeSearch, dateFrom, dateTo, searchAllBranches],
    queryFn: async () => {
      const hasSearchCriteria = invoiceSearch.length >= 2 || customerSearch.length >= 2 || barcodeSearch.length >= 2 || dateFrom || dateTo;
      if (!hasSearchCriteria) return [];

      const branchesToSearch: string[] = [];
      if (searchAllBranches) {
        const branchIds = userBranches.map(b => b.branch_id);
        if (branchIds.length > 0) branchesToSearch.push(...branchIds);
      } else if (selectedBranch) {
        branchesToSearch.push(selectedBranch);
      }
      if (branchesToSearch.length === 0) return [];

      const searchTerm = invoiceSearch.length >= 2 ? invoiceSearch : '';

      const allInvoiceResults: any[] = [];
      for (const brId of branchesToSearch) {
        const params: Record<string, string> = { branch_id: brId };
        if (searchTerm) params.search = searchTerm;
        const { data } = await apiClient.get<any[]>('/api/pos/invoices-for-link', params);
        if (data) allInvoiceResults.push(...data);
      }

      const saleIds = [...new Set(allInvoiceResults.filter(inv => inv.sale_id).map(inv => inv.sale_id))];
      if (saleIds.length === 0) return [];

      const filters: any[] = [{ type: 'in', column: 'id', value: saleIds }];
      if (dateFrom) {
        filters.push({ type: 'gte', column: 'created_at', value: `${dateFrom}T00:00:00` });
      }
      if (dateTo) {
        filters.push({ type: 'lte', column: 'created_at', value: `${dateTo}T23:59:59` });
      }
      const { data: salesData } = await posGw.queryTable('sales', {
        select: 'id, sale_code, created_at, total_amount, customer_id, branch_id',
        filters,
        order: { column: 'created_at', ascending: false },
        limit: 30,
      });
      const salesArr = (salesData as any[]) || [];

      const invoiceMap = new Map<string, string>();
      for (const inv of allInvoiceResults) {
        if (inv.sale_id && inv.invoice_number) {
          invoiceMap.set(inv.sale_id, inv.invoice_number);
        }
      }

      const customerIds = [...new Set(salesArr.filter(s => s.customer_id).map(s => s.customer_id))];
      const branchIds = [...new Set(salesArr.map(s => s.branch_id))];
      let customerMap = new Map<string, string>();
      let branchMap = new Map<string, { branch_name: string; branch_code: string }>();
      if (customerIds.length > 0) {
        const { data: custData } = await posGw.queryTable('customers', {
          select: 'id, full_name',
          filters: [{ type: 'in', column: 'id', value: customerIds }],
        });
        for (const c of (custData as any[]) || []) {
          customerMap.set(c.id, c.full_name);
        }
      }
      if (branchIds.length > 0) {
        const { data: brData } = await posGw.queryTable('branches', {
          select: 'id, branch_name, branch_code',
          filters: [{ type: 'in', column: 'id', value: branchIds }],
        });
        for (const b of (brData as any[]) || []) {
          branchMap.set(b.id, { branch_name: b.branch_name, branch_code: b.branch_code });
        }
      }
      let filteredData = salesArr.map((s: any) => ({
        id: s.id,
        sale_code: s.sale_code,
        invoice_number: invoiceMap.get(s.id) || undefined,
        sale_date: s.created_at,
        total_amount: s.total_amount,
        customer_id: s.customer_id,
        customer_name: customerMap.get(s.customer_id) || undefined,
        branch_id: s.branch_id,
        branch_name: branchMap.get(s.branch_id)?.branch_name,
        branch_code: branchMap.get(s.branch_id)?.branch_code,
      }));
      
      if (customerSearch.length >= 2) {
        filteredData = filteredData.filter((s: any) => 
          s.customer_name?.toLowerCase().includes(customerSearch.toLowerCase())
        );
      }
      
      if (barcodeSearch.length >= 2) {
        const barcodeResponse = await fetch(`/api/pos/sale-items-by-barcode?barcode=${encodeURIComponent(barcodeSearch)}`, { credentials: 'include' });
        const saleIdsWithBarcode = barcodeResponse.ok ? await barcodeResponse.json() : null;
        
        if (saleIdsWithBarcode && saleIdsWithBarcode.length > 0) {
          const validSaleIds = new Set(saleIdsWithBarcode.map((s: any) => s.sale_id));
          filteredData = filteredData.filter((s: any) => validSaleIds.has(s.id));
        } else {
          filteredData = [];
        }
      }
      
      return filteredData;
    },
    enabled: (!!selectedBranch || searchAllBranches) && (invoiceSearch.length >= 2 || customerSearch.length >= 2 || barcodeSearch.length >= 2 || !!dateFrom || !!dateTo),
  });

  // Fetch count from other branches when no local results
  const { data: otherBranchesResults = [] } = useQuery({
    queryKey: ['pos-sales-other-branches', selectedBranch, invoiceSearch, userBranches],
    queryFn: async () => {
      if (!selectedBranch || salesList.length > 0 || invoiceSearch.length < 2) return [];
      
      const otherBranchIds = userBranches
        .filter(b => b.branch_id !== selectedBranch)
        .map(b => b.branch_id);
      
      if (otherBranchIds.length === 0) return [];
      
      const allResults: any[] = [];
      for (const brId of otherBranchIds) {
        const params: Record<string, string> = { branch_id: brId, search: invoiceSearch };
        const { data } = await apiClient.get<any[]>('/api/pos/invoices-for-link', params);
        if (data) allResults.push(...data.map(inv => ({ ...inv, branch_id: brId })));
      }

      const otherBrIds = [...new Set(allResults.map(s => s.branch_id))];
      let otherBranchMap = new Map<string, string>();
      if (otherBrIds.length > 0) {
        const { data: brData } = await posGw.queryTable('branches', {
          select: 'id, branch_name',
          filters: [{ type: 'in', column: 'id', value: otherBrIds }],
        });
        for (const b of (brData as any[]) || []) {
          otherBranchMap.set(b.id, b.branch_name);
        }
      }
      return allResults.slice(0, 10).map((s: any) => ({
        id: s.sale_id || s.id,
        sale_code: s.sale_code,
        invoice_number: s.invoice_number,
        branch_id: s.branch_id,
        branch_name: otherBranchMap.get(s.branch_id),
      }));
    },
    enabled: !!selectedBranch && salesList.length === 0 && invoiceSearch.length >= 2 && !searchAllBranches,
  });

  // Calculate invoice age and check if old
  const invoiceAge = useMemo(() => {
    if (!selectedSale) return { days: 0, isOld: false };
    const saleDate = new Date(selectedSale.sale_date);
    const daysDiff = Math.floor((Date.now() - saleDate.getTime()) / (1000 * 60 * 60 * 24));
    const maxDays = returnSettings?.max_return_days || 30;
    return { days: daysDiff, isOld: daysDiff > maxDays };
  }, [selectedSale, returnSettings]);

  // Calculate invoice totals for display
  const invoiceTotals = useMemo(() => {
    if (!selectedSale) return null;
    
    const originalTotal = selectedSale.total_amount;
    const previouslyReturned = saleItems.reduce((sum, item) => 
      sum + (item.previously_returned * item.unit_price * 1.15), 0);
    const availableForReturn = originalTotal - previouslyReturned;
    
    return { originalTotal, previouslyReturned, availableForReturn };
  }, [selectedSale, saleItems]);

  // Fetch sale items when a sale is selected
  const { data: fetchedSaleItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['sale-items-for-return', selectedSale?.id],
    queryFn: async () => {
      if (!selectedSale) return [];
      
      const saleItemsResponse = await fetch(`/api/pos/sale-items?sale_id=${selectedSale.id}`, { credentials: 'include' });
      const saleItemsData = saleItemsResponse.ok ? await saleItemsResponse.json() : null;
      
      if (!saleItemsData) return [];

      const itemMap = new Map<string, any>();
      
      for (const si of saleItemsData as any[]) {
        const itemId = si.item_id;
        if (itemMap.has(itemId)) {
          const existing = itemMap.get(itemId);
          existing.original_quantity += 1;
          existing.total_cost += (si.jewelry_items?.cost || 0);
        } else {
          itemMap.set(itemId, {
            id: si.id,
            item_id: itemId,
            item_code: si.jewelry_items?.item_code || '',
            item_name: si.jewelry_items?.model || si.jewelry_items?.description || '',
            barcode: si.jewelry_items?.stockcode || '',
            original_quantity: 1,
            unit_price: si.sale_price || 0,
            discount_amount: 0,
            total_cost: si.jewelry_items?.cost || 0,
          });
        }
      }

      const { data: returnsForSale } = await posGw.queryTable('returns', {
        select: 'id',
        filters: [{ type: 'eq', column: 'original_sale_id', value: selectedSale.id }],
      });
      const returnIds = ((returnsForSale as any[]) || []).map((r: any) => r.id);
      let returnedData: any[] = [];
      if (returnIds.length > 0) {
        const { data: riData } = await posGw.queryTable('return_items', {
          select: 'item_id, quantity',
          filters: [{ type: 'in', column: 'return_id', value: returnIds }],
        });
        returnedData = (riData as any[]) || [];
      }

      const returnedMap = new Map<string, number>();
      for (const ri of returnedData as any[] || []) {
        const current = returnedMap.get(ri.item_id) || 0;
        returnedMap.set(ri.item_id, current + (ri.quantity || 1));
      }

      const items: SaleItem[] = [];
      for (const [itemId, data] of itemMap.entries()) {
        const previouslyReturned = returnedMap.get(itemId) || 0;
        const availableQty = Math.max(0, data.original_quantity - previouslyReturned);
        
        const taxRate = 0.15;
        items.push({
          ...data,
          previously_returned: previouslyReturned,
          available_quantity: availableQty,
          return_quantity: 0,
          tax_rate: taxRate,
          tax_amount: 0,
          line_total: 0,
          return_reason: '',
          selected: false,
        });
      }

      return items;
    },
    enabled: !!selectedSale,
  });

  // Update saleItems when fetchedSaleItems changes
  useEffect(() => {
    startTransition(() => {
      setSaleItems(fetchedSaleItems);
    });
  }, [fetchedSaleItems]);

  // Auto-suggest refund method based on return settings
  useEffect(() => {
    if (selectedSale) {
      if (returnSettings?.allow_cash_refund) {
        setRefundMethod('cash');
      } else if (returnSettings?.allow_card_refund) {
        setRefundMethod('card');
      } else if (returnSettings?.allow_store_credit) {
        setRefundMethod('store_credit');
      }
    }
  }, [selectedSale, returnSettings]);

  // Fetch bank accounts for card refund
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts'],
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    enabled: refundMethod === 'card',
    queryFn: async () => {
      const { data } = await posGw.queryTable('chart_of_accounts', {
        select: 'id, account_code, account_name',
        filters: [
          { type: 'like', column: 'account_code', value: '1112%' },
          { type: 'eq', column: 'is_active', value: true },
        ],
        order: { column: 'account_code', ascending: true },
      });
      return data || [];
    },
  });

  const { data: supervisorsList = [], isLoading: supervisorsLoading, error: supervisorsError } = useQuery({
    queryKey: ['pos-cashiers-supervisors'],
    staleTime: 5 * 60 * 1000,
    enabled: showOverrideDialog,
    queryFn: async () => {
      const res = await fetch('/api/pos/cashiers', { credentials: 'include' });
      if (!res.ok) throw new Error('فشل تحميل قائمة المشرفين');
      const json = await res.json();
      const all = json.data || [];
      return all.filter((c: any) => c.is_supervisor === true || c.is_admin === true);
    },
  });

  // Calculate totals
  const totals = useMemo(() => {
    const selectedItems = saleItems.filter(item => item.return_quantity > 0);
    const subtotalBeforeTax = selectedItems.reduce((sum, item) => {
      const lineSubtotal = item.unit_price * item.return_quantity - item.discount_amount;
      return sum + lineSubtotal;
    }, 0);
    const taxAmount = subtotalBeforeTax * 0.15;
    const totalAmount = subtotalBeforeTax + taxAmount;
    
    return { subtotalBeforeTax, taxAmount, totalAmount, itemsCount: selectedItems.length };
  }, [saleItems]);

  // Check if manager approval is required
  const requiresApproval = useMemo(() => {
    if (!returnSettings?.require_manager_approval) return false;
    const maxWithoutApproval = returnSettings?.max_return_amount_without_approval || 5000;
    return totals.totalAmount > maxWithoutApproval;
  }, [returnSettings, totals.totalAmount]);

  // Handle quantity change with strict validation
  const handleQuantityChange = (itemId: string, quantity: number) => {
    setSaleItems(prev => prev.map(item => {
      if (item.item_id === itemId) {
        const validQty = Math.min(Math.max(0, quantity), item.available_quantity);
        
        if (quantity > item.available_quantity) {
          toast.error(`الكمية المراد إرجاعها (${quantity}) أكبر من الكمية المتاحة للإرجاع (${item.available_quantity})`);
        }
        
        const lineSubtotal = item.unit_price * validQty - item.discount_amount;
        const taxAmount = lineSubtotal * item.tax_rate;
        
        return {
          ...item,
          return_quantity: validQty,
          tax_amount: taxAmount,
          line_total: lineSubtotal + taxAmount,
          selected: validQty > 0,
        };
      }
      return item;
    }));
  };

  // Handle reason change
  const handleReasonChange = (itemId: string, reason: string) => {
    setSaleItems(prev => prev.map(item => {
      if (item.item_id === itemId) {
        return { ...item, return_reason: reason };
      }
      return item;
    }));
  };

  // Select all items
  const handleSelectAll = () => {
    setSaleItems(prev => prev.map(item => {
      const lineSubtotal = item.unit_price * item.available_quantity - item.discount_amount;
      const taxAmount = lineSubtotal * item.tax_rate;
      return {
        ...item,
        return_quantity: item.available_quantity,
        tax_amount: taxAmount,
        line_total: lineSubtotal + taxAmount,
        selected: true,
      };
    }));
    setReturnType('full');
  };

  // Clear selection
  const handleClearSelection = () => {
    setSaleItems(prev => prev.map(item => ({
      ...item,
      return_quantity: 0,
      tax_amount: 0,
      line_total: 0,
      selected: false,
    })));
    setReturnType('partial');
  };

  // Select a sale
  const handleSelectSale = useCallback((sale: SaleForReturn) => {
    startTransition(() => {
      setSelectedSale(sale);
      setInvoiceSearch('');
    });
  }, []);

  // Reset form
  const resetForm = () => {
    setSelectedSale(null);
    setSaleItems([]);
    setReturnType('partial');
    setRefundMethod('cash');
    setSelectedBankAccount('');
    setReturnReason('');
    setNotes('');
    setInvoiceSearch('');
    setCustomerSearch('');
    setBarcodeSearch('');
    setDateFrom('');
    setDateTo('');
    setShowAdvancedSearch(false);
    clientRequestIdRef.current = null; // OPS-P1: Clear idempotency key on success
  };

  // Validate before checkout
  const validateReturn = (): string | null => {
    if (!selectedSale) {
      return 'لا يمكن إنشاء مرتجع بدون اختيار فاتورة أصلية';
    }
    
    const itemsToReturn = saleItems.filter(item => item.return_quantity > 0);
    if (itemsToReturn.length === 0) {
      return 'لم يتم تحديد أصناف للإرجاع';
    }
    
    for (const item of itemsToReturn) {
      if (item.return_quantity > item.available_quantity) {
        return `الكمية المراد إرجاعها للصنف "${item.item_name}" (${item.return_quantity}) أكبر من الكمية المتاحة للإرجاع (${item.available_quantity})`;
      }
      if (item.return_quantity <= 0) {
        return `الكمية المراد إرجاعها للصنف "${item.item_name}" يجب أن تكون أكبر من صفر`;
      }
    }
    
    if (refundMethod === 'card' && !selectedBankAccount) {
      return 'يجب اختيار الحساب البنكي عند الرد بالبطاقة';
    }
    
    if (refundMethod === 'store_credit' && !selectedSale.customer_id) {
      return 'لا يمكن استخدام رصيد العميل للعملاء النقديين. يرجى اختيار طريقة أخرى';
    }
    
    if (!returnReason.trim()) {
      return 'يجب إدخال سبب الإرجاع';
    }
    
    return null;
  };

  // OPS-P1: Process return using ATOMIC RPC only - no legacy workflow
  // P1B-FIX: Added No-Silent-Fail Logging
  const processReturn = async () => {
    setIsProcessing(true);
    
    // OPS-P1: Generate idempotency key ONCE per attempt, reuse on retry
    if (!clientRequestIdRef.current) {
      clientRequestIdRef.current = crypto.randomUUID();
    }
    const requestId = clientRequestIdRef.current;

    // Build preliminary payload for logging BEFORE guards
    const itemsToReturn = saleItems.filter(item => item.return_quantity > 0);
    const prelimPayload = {
      sale_id: selectedSale?.id || null,
      branch_id: selectedSale?.branch_id || selectedBranch,
      customer_id: selectedSale?.customer_id || null,
      items_count: itemsToReturn.length,
      total_amount: totals.totalAmount,
      refund_method: refundMethod,

    };

    // Log attempt start BEFORE any guards
    await logPosAttemptStart({
      clientRequestId: requestId,
      workflowType: 'pos_return',
      payload: prelimPayload,
    });

    // Guard 1: Sale must be selected
    if (!selectedSale) {
      const errorMsg = 'لا يمكن إنشاء مرتجع بدون اختيار فاتورة أصلية';
      await logPosAttemptFail({
        clientRequestId: requestId,
        errorCode: POS_ERROR_CODES.SALE_NOT_SELECTED,
        errorMessage: errorMsg,
      });
      toast.error(errorMsg);
      setIsProcessing(false);
      return;
    }

    // Guard 2: Items to return
    if (itemsToReturn.length === 0) {
      const errorMsg = 'لم يتم تحديد أصناف للإرجاع';
      await logPosAttemptFail({
        clientRequestId: requestId,
        errorCode: POS_ERROR_CODES.NO_ITEMS_TO_RETURN,
        errorMessage: errorMsg,
      });
      toast.error(errorMsg);
      setIsProcessing(false);
      return;
    }

    // Guard 3: Quantity validation
    for (const item of itemsToReturn) {
      if (item.return_quantity > item.available_quantity) {
        const errorMsg = `الكمية المراد إرجاعها للصنف "${item.item_name}" (${item.return_quantity}) أكبر من الكمية المتاحة للإرجاع (${item.available_quantity})`;
        await logPosAttemptFail({
          clientRequestId: requestId,
          errorCode: 'QUANTITY_EXCEEDS_AVAILABLE',
          errorMessage: errorMsg,
        });
        toast.error(errorMsg);
        setIsProcessing(false);
        return;
      }
    }

    // Guard 4: Bank account for card refund
    if (refundMethod === 'card' && !selectedBankAccount) {
      const errorMsg = 'يجب اختيار الحساب البنكي عند الرد بالبطاقة';
      await logPosAttemptFail({
        clientRequestId: requestId,
        errorCode: 'BANK_ACCOUNT_REQUIRED',
        errorMessage: errorMsg,
      });
      toast.error(errorMsg);
      setIsProcessing(false);
      return;
    }

    // Guard 5: Store credit requires customer
    if (refundMethod === 'store_credit' && !selectedSale.customer_id) {
      const errorMsg = 'لا يمكن استخدام رصيد العميل للعملاء النقديين. يرجى اختيار طريقة أخرى';
      await logPosAttemptFail({
        clientRequestId: requestId,
        errorCode: 'STORE_CREDIT_NO_CUSTOMER',
        errorMessage: errorMsg,
      });
      toast.error(errorMsg);
      setIsProcessing(false);
      return;
    }

    // Guard 6: Return reason required
    if (!returnReason.trim()) {
      const errorMsg = 'يجب إدخال سبب الإرجاع';
      await logPosAttemptFail({
        clientRequestId: requestId,
        errorCode: 'REASON_REQUIRED',
        errorMessage: errorMsg,
      });
      toast.error(errorMsg);
      setIsProcessing(false);
      return;
    }
    
    try {
      // Use original sale branch for correct inventory accounting
      const saleBranchId = selectedSale.branch_id;
      
      // OPS-P1: Build p_payload for atomic RPC
      const p_payload = {
        client_request_id: requestId,
        sale_id: selectedSale.id,
        branch_id: saleBranchId,
        customer_id: selectedSale.customer_id || null,
        refund_method: refundMethod,
  
        create_invoice: false,
        items: itemsToReturn.map(item => ({
          jewelry_item_id: item.item_id,
          line_amount: item.line_total || (item.unit_price * item.return_quantity),
          sale_item_id: item.id || null, // sale_item link if available
        })),
      };

      // OPS-P1: Single atomic RPC call - replaces all direct writes
      const { data: rpcResult, error: rpcError } = await posGw.rpc(
        'complete_pos_piece_return_atomic',
        { p_payload }
      );

      if (rpcError) {
        // Network/timeout - idempotent, safe to retry
        await logPosAttemptFail({
          clientRequestId: requestId,
          errorCode: POS_ERROR_CODES.RPC_ERROR,
          errorMessage: rpcError.message || 'RPC call failed',
        });
        if (rpcError.message?.includes('timeout') || rpcError.message?.includes('network')) {
          toast.error('خطأ في الشبكة. يمكنك إعادة المحاولة بأمان.');
        }
        throw new Error(rpcError.message || 'فشل في إنشاء المرتجع');
      }

      // Type assertion for RPC response
      const result = rpcResult as { success: boolean; return_id?: string; return_code?: string; error?: string; error_code?: string } | null;

      if (!result?.success) {
        await logPosAttemptFail({
          clientRequestId: requestId,
          errorCode: result?.error_code || POS_ERROR_CODES.RPC_ERROR,
          errorMessage: result?.error || 'Return creation failed',
        });
        throw new Error(result?.error || result?.error_code || 'فشل في إنشاء المرتجع');
      }

      // Log success
      await logPosAttemptSuccess({
        clientRequestId: requestId,
        entityId: result.return_id || '',
        result: {
          return_code: result.return_code,
          items_count: itemsToReturn.length,
          total_amount: totals.totalAmount,
        },
      });

      // OPS-P1: Clear idempotency key on success
      clientRequestIdRef.current = null;

      const returnCode = result.return_code || '';
      // Set completed return for receipt
      const branchName = userBranches.find(b => b.branch_id === saleBranchId)?.branch_name || '';
      setCompletedReturn({
        returnCode,
        returnDate: new Date(),
        branchName,
        originalInvoice: selectedSale.invoice_number || selectedSale.sale_code,
        customerName: selectedSale.customer_name,
        items: itemsToReturn,
        subtotalBeforeTax: totals.subtotalBeforeTax,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        refundMethod,
        returnReason,
        processedBy: currentUserProfile?.full_name || currentUserProfile?.username || '',
        returnType,
      });

      toast.success(`تم إنشاء المرتجع بنجاح - رقم: ${returnCode}`);
      setShowCheckoutDialog(false);
      setTimeout(() => setShowReceiptDialog(true), 50);
      
      queryClient.invalidateQueries({ queryKey: ['pos-sales-for-return'] });
      queryClient.invalidateQueries({ queryKey: ['sale-items-for-return'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['customer-credit-balance'] });
      
    } catch (error: any) {
      console.error('Error processing return:', error);
      toast.error(error.message || 'فشل في إنشاء المرتجع');
      // OPS-P1: Do NOT clear clientRequestIdRef on error - allow retry with same ID
      setShowCheckoutDialog(false);
      releaseGlobalInteractionLocks();
    } finally {
      setIsProcessing(false);
      releaseGlobalInteractionLocks();
    }
  };

  const handleConfirmClick = () => {
    const itemsToReturn = saleItems.filter(item => item.return_quantity > 0);
    if (!selectedSale) { toast.error('لا يمكن إنشاء مرتجع بدون اختيار فاتورة أصلية'); return; }
    if (itemsToReturn.length === 0) { toast.error('لم يتم تحديد أصناف للإرجاع'); return; }
    for (const item of itemsToReturn) {
      if (item.return_quantity > item.available_quantity) {
        toast.error(`الكمية المراد إرجاعها للصنف "${item.item_name}" أكبر من المتاحة`);
        return;
      }
    }
    if (refundMethod === 'card' && !selectedBankAccount) { toast.error('يجب اختيار الحساب البنكي عند الرد بالبطاقة'); return; }
    if (refundMethod === 'store_credit' && !selectedSale.customer_id) { toast.error('لا يمكن استخدام رصيد العميل للعملاء النقديين'); return; }
    if (!returnReason.trim()) { toast.error('يجب إدخال سبب الإرجاع'); return; }
    if (isPosAdmin) {
      handleAdminAutoOverride();
      return;
    }
    setOverridePin('');
    setOverrideSupervisorId('');
    setOverrideError(null);
    setOverrideNotes('موافقة مشرف على مرتجع POS');
    setShowOverrideDialog(true);
  };

  const mapOverrideError = (status: number, serverMsg?: string): string => {
    if (status === 400 && serverMsg && (
      serverMsg.toLowerCase().includes('no pin') ||
      (serverMsg.toLowerCase().includes('pin') && serverMsg.toLowerCase().includes('not set')) ||
      serverMsg.includes('PIN غير مضبوط') ||
      serverMsg.includes('pin غير')
    )) {
      return 'لا يوجد PIN لهذا المشرف. اطلب من المدير تعيين PIN من شاشة المستخدمين.';
    }
    if (status === 400) return serverMsg || 'طلب غير صالح.';
    if (status === 401) return 'رمز PIN غير صحيح.';
    if (status === 403) {
      if (serverMsg?.includes('branch') || serverMsg?.includes('فرع')) {
        return 'المشرف غير مرتبط بالفرع.';
      }
      return 'المشرف غير مصرح له.';
    }
    if (status === 423) {
      let msg = 'تم قفل المشرف مؤقتًا بسبب محاولات كثيرة. حاول مرة أخرى لاحقًا.';
      if (serverMsg) {
        const match = serverMsg.match(/locked.until[:\s]*([^\s,]+)/i);
        if (match?.[1]) {
          try {
            const d = new Date(match[1]);
            if (!isNaN(d.getTime())) {
              msg += ` (يُفتح الساعة ${d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })})`;
            }
          } catch {}
        }
      }
      return msg;
    }
    if (status >= 500) return 'تعذر الاتصال بالخادم. حاول مرة أخرى.';
    return serverMsg || 'حدث خطأ غير متوقع.';
  };

  const handleAdminAutoOverride = async () => {
    setIsApproving(true);
    try {
      const res = await fetch('/api/pos/override', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_key: 'pos_return_confirm',
          notes: 'موافقة أدمن POS تلقائية',
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error || 'فشل في الحصول على موافقة الأدمن');
        return;
      }
      processReturn();
    } catch {
      toast.error('تعذر الاتصال بالخادم');
    } finally {
      setIsApproving(false);
    }
  };

  const handleOverrideApprove = async () => {
    if (isApproving) return;
    if (!overrideSupervisorId || !/^\d{4}$/.test(overridePin)) return;
    setIsApproving(true);
    setOverrideError(null);
    try {
      const res = await fetch('/api/pos/override', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_key: 'pos_return_confirm',
          supervisor_user_id: overrideSupervisorId,
          pin: overridePin,
          notes: overrideNotes || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const errMsg = mapOverrideError(res.status, json?.error);
        setOverrideError(errMsg);
        if (res.status === 401 || res.status === 423) {
          setOverridePin('');
        }
        return;
      }
      setShowOverrideDialog(false);
      processReturn();
    } catch {
      setOverrideError('تعذر الاتصال بالخادم. حاول مرة أخرى.');
    } finally {
      setIsApproving(false);
    }
  };

  // Print handler
  const handlePrint = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: `مرتجع-${completedReturn?.returnCode}`,
  });

  const handlePrintAndClose = () => {
    handlePrint();
    setTimeout(() => {
      setShowReceiptDialog(false);
      resetForm();
    }, 500);
  };

  const isContentReady = !!gateBranchId || (!branchesLoading && userBranches.length > 0);

  return (
    <POSLayout branchName={gateBranchName}>
      <AdminBranchGuard>
      <BranchLoginGate
        branches={userBranches.map(b => ({ branch_id: b.branch_id, branch_name: b.branch_name }))}
        onBranchChange={(id, name) => { setGateBranchId(id); if (name) setGateBranchName(name); }}
      >
        {(activeBranchId, activeBranchName, onChangeBranch) => {
          return (
      <POSCashierGate>
        {(cashierInfo, onChangeCashier) => (
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="page-header-rtl">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10">
                <RotateCcw className="w-7 h-7 text-primary" />
              </div>
              مرتجع مبيعات POS
            </h1>
            <p className="text-muted-foreground text-sm mt-1">نظام مرتجعات نقطة البيع متوافق مع ZATCA</p>
          </div>
          
          <div className="flex items-center gap-3 flex-wrap">
            <CashierHeaderBadge
              cashierName={cashierInfo.cashier_name}
              onChangeCashier={onChangeCashier}
              isPosAdmin={cashierInfo.pos_admin}
              cashierKind={cashierInfo.cashier_kind}
              onSwitchToAdmin={async () => {
                try {
                  const res = await fetch('/api/pos/admin/assume-self', {
                    method: 'POST',
                    credentials: 'include',
                  });
                  if (res.ok) {
                    window.location.reload();
                  } else {
                    alert('تعذر التبديل إلى وضع الأدمن');
                  }
                } catch {
                  alert('تعذر الاتصال بالخادم');
                }
              }}
            />
            <div className="flex items-center gap-2 bg-muted/50 p-2 rounded-xl">
              <Badge variant="outline" className="gap-1 px-3 py-1.5">
                <Building2 className="w-3.5 h-3.5" />
                {activeBranchName || 'جاري التحميل...'}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                onClick={onChangeBranch}
                data-testid="button-change-branch-return"
                title="تغيير الفرع"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Branches Loading Skeleton */}
        {branchesLoading && !loadingTimeout && (
          <Card>
            <CardContent className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <span className="text-muted-foreground">جاري تحميل البيانات...</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading Timeout */}
        {loadingTimeout && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <AlertTriangle className="w-12 h-12 text-amber-500" />
              <p className="text-muted-foreground">تأخر تحميل البيانات. يرجى تحديث الصفحة.</p>
              <Button variant="outline" onClick={() => window.location.reload()}>
                تحديث الصفحة
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Main Content */}
        {isContentReady && (
          <>
            {/* Auto-loading indicator */}
            {autoLoading && !selectedSale && (
              <Card>
                <CardContent className="flex items-center justify-center py-16">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <span className="text-muted-foreground">جاري تحميل بيانات الفاتورة...</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Invoice Search Section */}
            {!selectedSale && !autoLoading && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    اختيار الفاتورة الأصلية <span className="text-destructive">*</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Search All Branches Checkbox */}
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="searchAllBranches"
                        checked={searchAllBranches}
                        onCheckedChange={(checked) => setSearchAllBranches(checked === true)}
                        disabled={!selectedBranch && userBranches.length === 0}
                      />
                      <Label htmlFor="searchAllBranches" className="text-sm cursor-pointer flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                        البحث في جميع فروعي
                        {searchAllBranches && userBranches.length > 1 && (
                          <Badge variant="secondary" className="text-xs">
                            {userBranches.length} فروع
                          </Badge>
                        )}
                      </Label>
                    </div>

                    {/* Basic Search - Invoice Number */}
                    <div className="relative">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <Input
                        placeholder="بحث برقم الفاتورة (مثال: SL-20260101-0001)..."
                        value={invoiceSearch}
                        onChange={(e) => { setInvoiceSearch(e.target.value); if (e.target.value) setSerialSearch(''); }}
                        className="pr-11 h-12 text-lg"
                        disabled={!selectedBranch && !searchAllBranches}
                        data-testid="input-invoice-search"
                      />
                    </div>

                    {/* Serial Number Search */}
                    <div className="space-y-2">
                      <div className="relative">
                        <Hash className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                        <Input
                          placeholder="بحث برقم السيريال (مثال: FSETN000001)..."
                          value={serialSearch}
                          onChange={(e) => { setSerialSearch(e.target.value); if (e.target.value) setInvoiceSearch(''); }}
                          className="pr-11 h-12 text-lg"
                          disabled={!selectedBranch && !searchAllBranches}
                          data-testid="input-serial-search"
                        />
                      </div>

                      {serialLoading && (
                        <div className="flex items-center gap-2 text-muted-foreground justify-center py-3">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          جاري البحث بالسيريال...
                        </div>
                      )}

                      {serialSearch.length >= 2 && !serialLoading && serialResults.length > 0 && (
                        <div className="responsive-table-wrapper border rounded-xl overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-muted/50">
                                <TableHead>السيريال</TableHead>
                                <TableHead>الوصف</TableHead>
                                <TableHead>رقم الفاتورة</TableHead>
                                <TableHead>الفرع</TableHead>
                                <TableHead>العميل</TableHead>
                                <TableHead>التاريخ</TableHead>
                                <TableHead></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {serialResults.map((row: any, idx: number) => (
                                <TableRow key={`${row.item_id}-${idx}`} className="hover-elevate">
                                  <TableCell className="font-mono text-sm font-medium">{row.serial_no}</TableCell>
                                  <TableCell className="text-sm">{row.description || row.model || row.stockcode || '-'}</TableCell>
                                  <TableCell className="font-mono text-sm">{row.invoice_number || '-'}</TableCell>
                                  <TableCell className="text-sm">{row.branch_name || '-'}</TableCell>
                                  <TableCell className="text-sm">{row.customer_name || 'عميل نقدي'}</TableCell>
                                  <TableCell className="text-sm">{row.sale_date ? new Date(row.sale_date).toLocaleDateString('en-CA') : '-'}</TableCell>
                                  <TableCell>
                                    <Button
                                      size="sm"
                                      onClick={async () => {
                                        if (!row.sale_id) {
                                          toast.error('لا توجد عملية بيع مرتبطة بهذا السيريال');
                                          return;
                                        }
                                        if (row.invoice_status === 'cancelled') {
                                          toast.error('فاتورة هذه القطعة ملغية');
                                          return;
                                        }
                                        try {
                                          const { data: saleData } = await posGw.queryTable('sales', {
                                            select: '*',
                                            filters: [{ type: 'eq', column: 'id', value: row.sale_id }],
                                            limit: 1,
                                          });
                                          const sale = (saleData as any[])?.[0];
                                          if (!sale) {
                                            toast.error('لم يتم العثور على عملية البيع');
                                            return;
                                          }
                                          setSelectedSale({
                                            id: sale.id,
                                            sale_code: sale.sale_code,
                                            invoice_number: row.invoice_number,
                                            sale_date: sale.created_at,
                                            total_amount: Number(sale.total_amount),
                                            customer_id: sale.customer_id,
                                            customer_name: row.customer_name,
                                            branch_id: sale.branch_id,
                                            branch_name: row.branch_name,
                                          });
                                          if (sale.branch_id && sale.branch_id !== selectedBranch) {
                                            setSelectedBranch(sale.branch_id);
                                          }
                                          setSerialSearch('');
                                          setSerialResults([]);
                                          toast.success(`تم تحميل الفاتورة ${row.invoice_number || row.sale_code}`);
                                        } catch (err) {
                                          toast.error('خطأ في تحميل بيانات البيع');
                                        }
                                      }}
                                      data-testid={`button-select-serial-${idx}`}
                                    >
                                      اختيار
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}

                      {serialSearch.length >= 2 && !serialLoading && serialResults.length === 0 && (
                        <Alert>
                          <AlertTriangle className="w-4 h-4" />
                          <AlertDescription>لا توجد قطع مباعة بهذا السيريال</AlertDescription>
                        </Alert>
                      )}
                    </div>

                    {/* Advanced Search Toggle */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
                      className="w-full justify-between"
                      disabled={!selectedBranch && !searchAllBranches}
                    >
                      <span className="flex items-center gap-2">
                        <Search className="w-4 h-4" />
                        بحث متقدم
                      </span>
                      {showAdvancedSearch ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>

                    {/* Advanced Search Fields */}
                    {showAdvancedSearch && (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-muted/30 rounded-xl border">
                        <div className="space-y-1.5">
                          <Label className="text-xs flex items-center gap-1">
                            <User className="w-3 h-3" />
                            اسم العميل
                          </Label>
                          <Input
                            placeholder="البحث بالاسم..."
                            value={customerSearch}
                            onChange={(e) => setCustomerSearch(e.target.value)}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs flex items-center gap-1">
                            <ScanBarcode className="w-3 h-3" />
                            كود/باركود الصنف
                          </Label>
                          <Input
                            placeholder="البحث بالباركود..."
                            value={barcodeSearch}
                            onChange={(e) => setBarcodeSearch(e.target.value)}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            من تاريخ
                          </Label>
                          <Input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            إلى تاريخ
                          </Label>
                          <Input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="h-9"
                          />
                        </div>
                      </div>
                    )}
                    
                    {!selectedBranch && !searchAllBranches && (
                      <Alert>
                        <AlertTriangle className="w-4 h-4" />
                        <AlertDescription>يرجى اختيار الفرع أولاً أو تفعيل "البحث في جميع فروعي"</AlertDescription>
                      </Alert>
                    )}

                    {salesLoading && (
                      <div className="flex items-center gap-2 text-muted-foreground justify-center py-4">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        جاري البحث...
                      </div>
                    )}

                    {/* No results message */}
                    {!salesLoading && invoiceSearch.length >= 2 && salesList.length === 0 && (
                      <div className="space-y-3">
                        <Alert variant="default" className="bg-muted/50">
                          <Search className="w-4 h-4" />
                          <AlertDescription>
                            لم يتم العثور على فواتير مطابقة لـ "{invoiceSearch}"
                            {selectedBranch && !searchAllBranches && (
                              <span> في الفرع الحالي</span>
                            )}
                          </AlertDescription>
                        </Alert>
                        
                        {/* Show results from other branches */}
                        {otherBranchesResults.length > 0 && !searchAllBranches && (
                          <Alert className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900">
                            <Building2 className="w-4 h-4 text-blue-600" />
                            <AlertDescription className="text-blue-800 dark:text-blue-200">
                              <div className="mb-2">
                                تم العثور على {otherBranchesResults.length} فاتورة في فروع أخرى:
                              </div>
                              <div className="space-y-1">
                                {otherBranchesResults.slice(0, 5).map((result) => (
                                  <div 
                                    key={result.id} 
                                    className="flex items-center justify-between p-2 bg-background rounded border cursor-pointer hover:bg-muted/50 transition-colors"
                                    onClick={() => {
                                      setSelectedBranch(result.branch_id);
                                      setInvoiceSearch(result.invoice_number || result.sale_code);
                                    }}
                                  >
                                    <span className="font-mono text-sm">{result.invoice_number || result.sale_code}</span>
                                    <Badge variant="outline" className="text-xs">
                                      {result.branch_name}
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                              <Button
                                variant="link"
                                size="sm"
                                className="mt-2 p-0 h-auto text-blue-600"
                                onClick={() => setSearchAllBranches(true)}
                              >
                                أو فعّل "البحث في جميع فروعي" لرؤية كل النتائج
                              </Button>
                            </AlertDescription>
                          </Alert>
                        )}
                        
                        {/* Suggest enabling cross-branch search */}
                        {otherBranchesResults.length === 0 && !searchAllBranches && userBranches.length > 1 && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => setSearchAllBranches(true)}
                          >
                            <Building2 className="w-4 h-4 ml-2" />
                            البحث في جميع الفروع ({userBranches.length})
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Search Results Table */}
                    {salesList.length > 0 && (
                      <div className="responsive-table-wrapper border rounded-xl overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50">
                              <TableHead>رقم الفاتورة</TableHead>
                              {searchAllBranches && <TableHead>الفرع</TableHead>}
                              <TableHead>التاريخ</TableHead>
                              <TableHead>العميل</TableHead>
                              <TableHead>طريقة الدفع</TableHead>
                              <TableHead>المبلغ</TableHead>
                              <TableHead></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {salesList.map(sale => (
                              <TableRow key={sale.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                                <TableCell className="font-mono font-medium">{sale.invoice_number || sale.sale_code}</TableCell>
                                {searchAllBranches && (
                                  <TableCell>
                                    <Badge variant="secondary" className="text-xs">
                                      {sale.branch_name || sale.branch_code}
                                    </Badge>
                                  </TableCell>
                                )}
                                <TableCell>{new Date(sale.sale_date).toLocaleDateString('ar-SA')}</TableCell>
                                <TableCell>{sale.customer_name || 'عميل نقدي'}</TableCell>
                                <TableCell className="font-medium">{formatCurrency(sale.total_amount)}</TableCell>
                                <TableCell>
                                  <Button 
                                    size="sm" 
                                    onClick={() => {
                                      if (sale.branch_id !== selectedBranch) {
                                        setSelectedBranch(sale.branch_id);
                                      }
                                      handleSelectSale(sale);
                                    }}
                                  >
                                    اختيار
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* All Returns Section - Show on main screen */}
            {!selectedSale && (
              <AllReturnsSection branchId={selectedBranch} />
            )}

            {/* Selected Invoice Card */}
            {selectedSale && (
              <>
                <SelectedInvoiceCard
                  sale={selectedSale}
                  invoiceTotals={invoiceTotals}
                  onReset={resetForm}
                />

                {/* Old Invoice Warning */}
                {invoiceAge.isOld && (
                  <Alert variant="destructive" className="border-2">
                    <Clock className="w-4 h-4" />
                    <AlertDescription>
                      <strong>تنبيه:</strong> هذه الفاتورة قديمة ({invoiceAge.days} يوم). 
                      الحد الأقصى للإرجاع هو {returnSettings?.max_return_days || 30} يوم.
                      قد يتطلب المرتجع موافقة المدير.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Customer Credit Balance */}
                {selectedSale.customer_id && customerCreditBalance > 0 && (
                  <Alert className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900">
                    <Wallet className="w-4 h-4 text-blue-600" />
                    <AlertDescription className="text-blue-800 dark:text-blue-200">
                      رصيد العميل الحالي: <strong>{formatCurrency(customerCreditBalance)}</strong>
                    </AlertDescription>
                  </Alert>
                )}
                
                {/* Fully Returned Warning */}
                {invoiceTotals && invoiceTotals.availableForReturn <= 0 && (
                  <Alert variant="destructive" className="border-2">
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>
                      تم إرجاع جميع أصناف هذه الفaتورة بالكامل. لا يمكن إنشاء مرتجع إضافي.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Previous Returns Section */}
                <PreviousReturnsSection
                  saleId={selectedSale.id}
                  saleCode={selectedSale.invoice_number || selectedSale.sale_code}
                  branchName={selectedSale.branch_name}
                  customerName={selectedSale.customer_name}
                />
              </>
            )}

            {/* Items Table */}
            {selectedSale && invoiceTotals && invoiceTotals.availableForReturn > 0 && (
              <ReturnItemsTable
                items={saleItems}
                isLoading={itemsLoading}
                onQuantityChange={handleQuantityChange}
                onReasonChange={handleReasonChange}
                onSelectAll={handleSelectAll}
                onClearSelection={handleClearSelection}
              />
            )}

            {/* Return Details & Summary */}
            {selectedSale && totals.itemsCount > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Return Details */}
                <ReturnDetailsCard
                  returnType={returnType}
                  refundMethod={refundMethod}
                  selectedBankAccount={selectedBankAccount}
                  returnReason={returnReason}
                  notes={notes}
                  bankAccounts={bankAccounts}
                  returnSettings={returnSettings}
                  hasCustomer={!!selectedSale?.customer_id}
                  onReturnTypeChange={(v) => setReturnType(v)}
                  onRefundMethodChange={(v) => setRefundMethod(v)}
                  onBankAccountChange={setSelectedBankAccount}
                  onReturnReasonChange={setReturnReason}
                  onNotesChange={setNotes}
                />

                {/* Summary */}
                <ReturnSummaryCard
                  totals={totals}
                  refundMethod={refundMethod}
                  requiresApproval={requiresApproval}
                  maxApprovalAmount={returnSettings?.max_return_amount_without_approval}
                  customerCreditBalance={customerCreditBalance}
                  onConfirm={() => setShowCheckoutDialog(true)}
                  disabled={totals.itemsCount === 0}
                />
              </div>
            )}

            {/* Checkout Confirmation Dialog */}
            <Dialog
              open={showCheckoutDialog}
              onOpenChange={(open) => {
                setShowCheckoutDialog(open);
                if (!open) {
                  window.setTimeout(releaseGlobalInteractionLocks, 250);
                }
              }}
            >
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <RotateCcw className="w-5 h-5 text-primary" />
                    تأكيد مرتجع المبيعات
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="text-center p-6 bg-primary/5 rounded-xl border border-primary/20">
                    <div className="text-4xl font-bold text-primary mb-2">
                      {formatCurrency(totals.totalAmount)}
                    </div>
                    <div className="text-muted-foreground">
                      {refundMethod === 'store_credit' 
                        ? 'سيضاف لرصيد العميل' 
                        : 'صافي المبلغ المسترد للعميل'}
                    </div>
                  </div>

                  <div className="bg-muted/50 rounded-xl p-4 space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">الفاتورة الأصلية:</span>
                      <span className="font-mono font-medium">{selectedSale?.invoice_number || selectedSale?.sale_code}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">عدد الأصناف:</span>
                      <span className="font-medium">{totals.itemsCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">طريقة رد المبلغ:</span>
                      <span className="font-medium">
                        {refundMethod === 'cash' ? 'نقداً' : 
                         refundMethod === 'card' ? 'بطاقة' : 'رصيد للعميل'}
                      </span>
                    </div>
                    {invoiceAge.isOld && (
                      <div className="flex justify-between text-amber-600">
                        <span>عمر الفاتورة:</span>
                        <span>{invoiceAge.days} يوم (قديمة)</span>
                      </div>
                    )}
                  </div>
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setShowCheckoutDialog(false)} disabled={isProcessing}>
                    إلغاء
                  </Button>
                  <Button onClick={handleConfirmClick} disabled={isProcessing} size="lg">
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                        جاري المعالجة...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4 ml-2" />
                        تأكيد المرتجع
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Receipt Dialog */}
            <Dialog
              open={showReceiptDialog}
              onOpenChange={(open) => {
                setShowReceiptDialog(open);
                if (!open) {
                  resetForm();
                  window.setTimeout(releaseGlobalInteractionLocks, 250);
                }
              }}
            >
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>إيصال المرتجع</DialogTitle>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-auto">
                  {completedReturn && (
                    <div ref={receiptRef}>
                      <POSReturnReceipt return={completedReturn} />
                    </div>
                  )}
                </div>
                <DialogFooter className="flex gap-2">
                  <Button variant="outline" onClick={() => { setShowReceiptDialog(false); resetForm(); }}>
                    إغلاق
                  </Button>
                  <Button onClick={handlePrintAndClose}>
                    <Printer className="w-4 h-4 ml-2" />
                    طباعة
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={showOverrideDialog} onOpenChange={(open) => { if (!open && !isApproving) { setShowOverrideDialog(false); setOverrideSupervisorId(''); setOverridePin(''); setOverrideNotes(''); setOverrideError(null); } }}>
              <DialogContent className="max-w-md" dir="rtl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-primary" />
                    موافقة المشرف
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  {supervisorsError && (
                    <Alert variant="destructive">
                      <AlertTriangle className="w-4 h-4" />
                      <AlertDescription>فشل تحميل قائمة المشرفين</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <Label>المشرف</Label>
                    <Select value={overrideSupervisorId} onValueChange={setOverrideSupervisorId} disabled={isApproving}>
                      <SelectTrigger data-testid="select-supervisor">
                        <SelectValue placeholder={supervisorsLoading ? 'جاري التحميل...' : 'اختر المشرف'} />
                      </SelectTrigger>
                      <SelectContent>
                        {supervisorsList.map((s: any) => (
                          <SelectItem key={String(s.user_id)} value={String(s.user_id)}>
                            {s.full_name || s.username}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>رمز PIN</Label>
                    <div className="relative">
                      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        data-testid="input-override-pin"
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="____"
                        className="text-center text-lg tracking-[0.5em] pr-10"
                        value={overridePin}
                        onChange={(e) => {
                          const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                          setOverridePin(v);
                          setOverrideError(null);
                        }}
                        disabled={isApproving}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !isApproving && overrideSupervisorId && /^\d{4}$/.test(overridePin)) handleOverrideApprove(); }}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>ملاحظات (اختياري)</Label>
                    <Textarea
                      data-testid="input-override-notes"
                      value={overrideNotes}
                      onChange={(e) => setOverrideNotes(e.target.value)}
                      disabled={isApproving}
                      rows={2}
                    />
                  </div>

                  {overrideError && (
                    <Alert variant="destructive">
                      <AlertTriangle className="w-4 h-4" />
                      <AlertDescription>{overrideError}</AlertDescription>
                    </Alert>
                  )}
                </div>
                <DialogFooter className="gap-2">
                  <Button data-testid="button-override-cancel" variant="outline" onClick={() => { setShowOverrideDialog(false); setOverrideSupervisorId(''); setOverridePin(''); setOverrideNotes(''); setOverrideError(null); }} disabled={isApproving}>
                    إلغاء
                  </Button>
                  <Button
                    data-testid="button-override-approve"
                    onClick={handleOverrideApprove}
                    disabled={isApproving || !overrideSupervisorId || !/^\d{4}$/.test(overridePin) || !!supervisorsError}
                  >
                    {isApproving ? (
                      <>
                        <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                        جاري التحقق...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4 ml-2" />
                        موافقة
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
        )}
      </POSCashierGate>
        );
        }}
      </BranchLoginGate>
      </AdminBranchGuard>
    </POSLayout>
  );
}
