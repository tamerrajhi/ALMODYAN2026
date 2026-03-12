import { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { tafqeet } from '@/lib/tafqeet';
import { 
  Search, 
  ShoppingCart, 
  Trash2, 
  Plus, 
  Building2,
  Package,
  CreditCard,
  Banknote,
  User,
  X,
  Check,
  Loader2,
  ScanBarcode,
  Gem,
  Scale,
  Tag,
  Printer,
  Sparkles,
  ShieldCheck,
  Camera,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { useModules } from '@/core/contexts/ModuleContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import SaleInvoice from '@/components/pos/SaleInvoice';
import PhoneCustomerSearch from '@/components/pos/PhoneCustomerSearch';
import POSQuickCustomerDialog from '@/components/pos/POSQuickCustomerDialog';
import POSDebugPanel, { type CapturedSalePayload } from '@/components/pos/debug/POSDebugPanel';
import { createSaleJournalEntry, createSplitSaleJournalEntry } from '@/lib/accounting';
import { formatCurrency } from '@/lib/utils';
import { useUserBranches } from '@/hooks/useUserBranches';
import BranchLoginGate from '@/components/pos/BranchLoginGate';
import POSCashierGate, { CashierHeaderBadge } from '@/components/pos/POSCashierGate';
import POSEntryGate from '@/components/pos/POSEntryGate';
import { 
  logPosAttemptStart, 
  logPosAttemptFail, 
  logPosAttemptSuccess,
  POS_ERROR_CODES 
} from '@/lib/posRequestLogger';
type Json = Record<string, any> | string | number | boolean | null;

function BranchNameSync({ name, onSync }: { name: string | null; onSync: (n: string | null) => void }) {
  useEffect(() => { onSync(name); }, [name, onSync]);
  return null;
}

function SellerSync({ sellerProfileId, sellerDisplayName, onSync }: { sellerProfileId: string; sellerDisplayName: string; onSync: (id: string, name: string) => void }) {
  useEffect(() => {
    if (sellerProfileId) { onSync(sellerProfileId, sellerDisplayName); }
  }, [sellerProfileId, sellerDisplayName, onSync]);
  return null;
}

interface CartItem {
  id: string;
  item_code: string;
  model: string | null;
  description: string | null;
  type: string | null;
  metal: string | null;
  g_weight: number | null;
  d_weight: number | null;
  b_weight: number | null;
  clarity: string | null;
  tag_price: number | null;
  sale_price: number;
  stockcode: string | null;
  calculated_gold_price?: number | null;
  karat_value?: number | null;
  supp_ref?: string | null;
}

interface GoldPrice {
  karat_id: string;
  karat_value: number;
  karat_name: string;
  sell_price_per_gram: number;
}

interface Customer {
  id: string;
  customer_code: string;
  full_name: string;
  phone: string | null;
  loyalty_points: number;
  vat_number?: string | null;
  address?: string | null;
  customer_type?: 'individual' | 'company';
  company_name?: string | null;
}

interface CompletedSale {
  saleCode: string;
  saleDate: Date;
  branchName: string;
  customer: Customer | null;
  items: CartItem[];
  totalAmount: number;
  discountAmount: number;
  taxAmount: number;
  finalAmount: number;
  paymentMethod: string;
  cashAmount?: number;
  cardAmount?: number;
  notes: string;
  soldBy: string;
}

export default function POSPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { userBranches, primaryBranch, isLoading: branchesLoading } = useUserBranches();
  const [posMode, setPosMode] = useState<'unknown' | 'cashier' | 'admin'>('unknown');
  const [adminCashierName, setAdminCashierName] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [contextSellerProfileId, setContextSellerProfileId] = useState<string>('');
  const [contextSellerName, setContextSellerName] = useState<string>('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDialog, setShowCustomerDialog] = useState(false);
  const [showNewCustomerDialog, setShowNewCustomerDialog] = useState(false);
  const [showPOSQuickCustomerDialog, setShowPOSQuickCustomerDialog] = useState(false);
  const [prefillPhone, setPrefillPhone] = useState('');
  const [showCheckoutDialog, setShowCheckoutDialog] = useState(false);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [cardAmount, setCardAmount] = useState<number>(0);
  const [selectedBankAccount, setSelectedBankAccount] = useState<string>('');
  const [grossTarget, setGrossTarget] = useState<string>('');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [discountType, setDiscountType] = useState<'amount' | 'percentage'>('amount');
  const [notes, setNotes] = useState('');
  const [newCustomer, setNewCustomer] = useState({ 
    full_name: '', 
    phone: '', 
    email: '', 
    address: '', 
    vat_number: '',
    customer_type: 'individual' as 'individual' | 'company',
    company_name: '',
  });
  const [barcodeMode, setBarcodeMode] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [cameraDebugInfo, setCameraDebugInfo] = useState<Record<string, any>>({});
  const [cameraError, setCameraError] = useState<string | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const invoiceRef = useRef<HTMLDivElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraRafRef = useRef<number | null>(null);
  const cameraScanningRef = useRef(false);
  const barcodeFirstKeystrokeRef = useRef<number>(0);
  const barcodeLastKeystrokeRef = useRef<number>(0);
  
  // P4-3: Use ref for per-attempt client_request_id generation (no silent fail)
  const clientRequestIdRef = useRef<string | null>(null);
  
  // P2L: Debug panel state - captures last successful sale payload for replay tests
  const [lastCapturedPayload, setLastCapturedPayload] = useState<CapturedSalePayload | null>(null);
  
  // P2L: Check if debug mode is enabled via URL param
  const isDebugMode = searchParams.get('posDebug') === '1';
  
  // Generate new client request ID for each attempt
  const generateClientRequestId = () => {
    clientRequestIdRef.current = crypto.randomUUID();
    return clientRequestIdRef.current;
  };
  
  // Reset client_request_id after successful sale
  const regenerateClientRequestId = () => {
    clientRequestIdRef.current = null;
  };

  const { isAdmin = false } = useModules();

  const currentSellerName = contextSellerName || null;

  const [gateBranchId, setGateBranchId] = useState<string | null>(null);
  const [gateBranchName, setGateBranchName] = useState<string | null>(null);

  useEffect(() => {
    if (gateBranchId) {
      setSelectedBranch(gateBranchId);
    } else if (primaryBranch && !selectedBranch) {
      setSelectedBranch(primaryBranch.branch_id);
    }
  }, [gateBranchId, primaryBranch, selectedBranch]);

  const prevBranchRef = useRef(selectedBranch);
  useEffect(() => {
    if (prevBranchRef.current && selectedBranch && prevBranchRef.current !== selectedBranch) {
      setCart([]);
      setContextSellerProfileId('');
      setContextSellerName('');
    }
    prevBranchRef.current = selectedBranch;
  }, [selectedBranch]);


  // Auto-focus barcode input when in barcode mode
  useEffect(() => {
    if (barcodeMode && barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
  }, [barcodeMode]);

  // Fetch branch inventory stats
  const { data: branchStats } = useQuery({
    queryKey: ['pos-branch-stats', selectedBranch],
    queryFn: async () => {
      if (!selectedBranch) return null;
      
      const { data: items } = await dataGateway.queryTable('unique_items', {
        select: 'id, tag_price, g_weight, sold_at',
        filters: [{ column: 'branch_id', type: 'eq', value: selectedBranch }],
      });

      const available = (items || []).filter((i: any) => !i.sold_at);
      const totalValue = available.reduce((sum: number, i: any) => sum + (parseFloat(i.tag_price) || 0), 0);
      const totalWeight = available.reduce((sum: number, i: any) => sum + (parseFloat(i.g_weight) || 0), 0);

      return {
        totalItems: available.length,
        totalValue,
        totalWeight,
      };
    },
    enabled: !!selectedBranch,
  });

  // Check if branch is gold type
  const selectedBranchData = userBranches.find(b => b.branch_id === selectedBranch);
  const isGoldBranch = selectedBranchData?.branch_type === 'gold';

  // Fetch today's gold prices for gold branches
  const { data: todayGoldPrices = [] } = useQuery({
    queryKey: ['today-gold-prices'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data: prices } = await dataGateway.queryTable('gold_prices', {
        select: 'karat_id, sell_price_per_gram',
        filters: [{ type: 'eq', column: 'price_date', value: today }],
      });
      if (!prices || (prices as any[]).length === 0) return [];
      const { data: karats } = await dataGateway.queryTable('gold_karats', {
        select: 'id, karat_value, karat_name',
      });
      const karatMap = new Map((karats as any[] || []).map((k: any) => [k.id, k]));
      return (prices as any[]).map((p: any) => {
        const karat = karatMap.get(p.karat_id);
        return {
          karat_id: p.karat_id,
          karat_value: karat?.karat_value,
          karat_name: karat?.karat_name,
          sell_price_per_gram: p.sell_price_per_gram,
        };
      }).filter((p: any) => p.karat_value != null) as GoldPrice[];
    },
    enabled: isGoldBranch,
  });

  // Fetch available items for selected branch
  const { data: items = [] } = useQuery({
    queryKey: ['pos-items', selectedBranch],
    queryFn: async () => {
      if (!selectedBranch) return [];
      
      // P4-1: Canonical sellable pieces filter - sold_at IS NULL AND status = 'in_stock'
      const filters: any[] = [
        { column: 'branch_id', type: 'eq', value: selectedBranch },
        { column: 'sold_at', type: 'is', value: null },
        { column: 'status', type: 'eq', value: 'in_stock' },
      ];

      const { data } = await dataGateway.queryTable('unique_items', {
        select: 'id, serial_no, model, description, type, metal, g_weight, d_weight, b_weight, clarity, tag_price, stockcode',
        filters,
        order: [{ column: 'serial_no', ascending: true }],
        limit: 50,
      });
      return (data || []).map((item: any) => ({ ...item, item_code: item.serial_no }));
    },
    enabled: !!selectedBranch,
  });

  // Fetch customers
  const { data: customers = [] } = useQuery({
    queryKey: ['pos-customers', customerSearch],
    queryFn: async () => {
      const filters: any[] = [];
      if (customerSearch) {
        filters.push({ type: 'or', value: `full_name.ilike.%${customerSearch}%,phone.ilike.%${customerSearch}%,customer_code.ilike.%${customerSearch}%,vat_number.ilike.%${customerSearch}%` });
      }
      const { data } = await dataGateway.queryTable('customers', {
        select: 'id, customer_code, full_name, phone, loyalty_points, vat_number, address',
        filters,
        order: { column: 'full_name', ascending: true },
        limit: 20,
      });
      return data || [];
    },
  });

  // Fetch bank accounts for card payment
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: async () => {
      const { data } = await dataGateway.queryTable('chart_of_accounts', {
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

  // Create new customer mutation
  const createCustomerMutation = useMutation({
    mutationFn: async (customerData: typeof newCustomer) => {
      // Generate customer code
      const { data: codeData } = await dataGateway.generateCustomerCode();
      
      forbidDirectWrite('insert', 'POSPage.tsx:376');
      return null as any;
    },
    onSuccess: (data) => {
      setSelectedCustomer({ ...data, customer_type: data.customer_type as 'individual' | 'company' } as Customer);
      setShowNewCustomerDialog(false);
      setNewCustomer({ full_name: '', phone: '', email: '', address: '', vat_number: '', customer_type: 'individual', company_name: '' });
      queryClient.invalidateQueries({ queryKey: ['pos-customers'] });
      toast.success('تم إضافة العميل بنجاح');
    },
    onError: () => {
      toast.error('فشل في إضافة العميل');
    },
  });

  // P4-3 + P1B: Complete sale mutation - WITH NO-SILENT-FAIL LOGGING
  const completeSaleMutation = useMutation({
    mutationFn: async () => {
      // ==========================================
      // P1B: Generate client_request_id per attempt (before any guards)
      // ==========================================
      const requestId = clientRequestIdRef.current || generateClientRequestId();
      
      // Build preliminary payload for logging
      const prelimPayload = {
        branch_id: selectedBranch,
        customer_id: selectedCustomer?.id || null,
        payment_method: paymentMethod,
        items_count: cart.length,
        seller_id: contextSellerProfileId,
      };
      
      // ==========================================
      // P1B: Log attempt start BEFORE guards (No Silent Fail)
      // ==========================================
      const beginResult = await logPosAttemptStart({
        clientRequestId: requestId,
        workflowType: 'pos_sale',
        payload: prelimPayload,
      });
      
      // Check for idempotent replay
      if (beginResult?.idempotent && beginResult.status === 'succeeded') {
        console.log('[P1B] Idempotent replay detected - sale already processed');
        return beginResult.result as any;
      }
      
      // ==========================================
      // P4-3 PRE-RPC VALIDATIONS (Client-side guardrails) - NOW WITH LOGGING
      // ==========================================
      
      // Validate seller is selected
      if (!contextSellerProfileId || !currentSellerName || currentSellerName.trim() === '') {
        await logPosAttemptFail({
          clientRequestId: requestId,
          errorCode: POS_ERROR_CODES.SELLER_REQUIRED,
          errorMessage: 'يجب اختيار البائع أولاً',
        });
        throw new Error('يجب اختيار البائع أولاً');
      }

      // Validate customer phone only if customer is selected
      if (selectedCustomer) {
        const customerPhone = selectedCustomer.phone?.replace(/\D/g, '') || '';
        const phoneDigits = customerPhone.slice(-9);
        if (customerPhone && phoneDigits && !/^5\d{8}$/.test(phoneDigits)) {
          await logPosAttemptFail({
            clientRequestId: requestId,
            errorCode: POS_ERROR_CODES.INVALID_PHONE,
            errorMessage: 'رقم جوال العميل غير صحيح',
          });
          throw new Error('رقم جوال العميل غير صحيح - يجب أن يبدأ بـ 5 ويتكون من 9 أرقام');
        }
      }

      // P4-3 GUARDRAIL: Validate branch selected
      if (!selectedBranch) {
        await logPosAttemptFail({
          clientRequestId: requestId,
          errorCode: POS_ERROR_CODES.BRANCH_REQUIRED,
          errorMessage: 'يرجى اختيار الفرع أولاً',
        });
        throw new Error('يرجى اختيار الفرع أولاً');
      }

      // P4-3 GUARDRAIL: Validate cart has items
      if (cart.length === 0) {
        await logPosAttemptFail({
          clientRequestId: requestId,
          errorCode: POS_ERROR_CODES.CART_EMPTY,
          errorMessage: 'السلة فارغة',
        });
        throw new Error('السلة فارغة - يرجى إضافة قطع للبيع');
      }

      const soldByName = currentSellerName;
      
      const totalAmt = cart.reduce((sum, item) => sum + Number(item.sale_price || 0), 0);
      let discountAmt: number;
      let subtotalAfterDisc: number;
      let taxAmt: number;
      let finalAmt: number;

      const gtNum = parseFloat(grossTarget);
      const origGross = totalAmt * (1 + 0.15);
      const useGrossTarget = grossTarget !== '' && !isNaN(gtNum) && gtNum > 0 && totalAmt > 0 && gtNum <= origGross + 0.01;

      if (useGrossTarget) {
        const netTarget = gtNum / (1 + 0.15);
        discountAmt = Math.round((totalAmt - netTarget) * 100) / 100;
        subtotalAfterDisc = Math.round(netTarget * 100) / 100;
        taxAmt = Math.round((gtNum - netTarget) * 100) / 100;
        finalAmt = gtNum;
      } else {
        discountAmt = discountType === 'percentage' ? (totalAmt * discountValue) / 100 : discountValue;
        subtotalAfterDisc = totalAmt - discountAmt;
        taxAmt = subtotalAfterDisc * 0.15;
        finalAmt = subtotalAfterDisc + taxAmt;
      }

      const discountRate = totalAmt > 0 ? discountAmt / totalAmt : 0;
      const itemsWithDiscount = cart.map((item, idx) => {
        const lineNet = Number(item.sale_price || 0);
        let lineNetAfter = Math.round(lineNet * (1 - discountRate) * 100) / 100;
        let lineVat = Math.round(lineNetAfter * 0.15 * 100) / 100;
        let lineGross = lineNetAfter + lineVat;
        return { item, lineNetAfter, lineVat, lineGross, lineDiscount: Math.round((lineNet - lineNetAfter) * 100) / 100, idx };
      });
      if (useGrossTarget && itemsWithDiscount.length > 0) {
        const sumGross = itemsWithDiscount.reduce((s, l) => s + l.lineGross, 0);
        const delta = Math.round((gtNum - sumGross) * 100) / 100;
        if (Math.abs(delta) > 0.001) {
          const last = itemsWithDiscount[itemsWithDiscount.length - 1];
          last.lineNetAfter = Math.round((last.lineNetAfter + delta / (1 + 0.15)) * 100) / 100;
          last.lineVat = Math.round(last.lineNetAfter * 0.15 * 100) / 100;
          last.lineGross = last.lineNetAfter + last.lineVat;
          last.lineDiscount = Math.round((Number(last.item.sale_price || 0) - last.lineNetAfter) * 100) / 100;
        }
      }

      // ==========================================
      // P4-3 BUILD ATOMIC RPC PAYLOAD (saleCmd)
      // ==========================================
      const saleCmd = {
        client_request_id: requestId,
        branch_id: selectedBranch,
        customer_id: selectedCustomer?.id || null,
        payment_method: paymentMethod === 'split' 
          ? `split:cash=${cashAmount},card=${cardAmount}` 
          : paymentMethod,
        cash_amount: paymentMethod === 'split' ? cashAmount : (paymentMethod === 'cash' ? finalAmt : 0),
        card_amount: paymentMethod === 'split' ? cardAmount : (paymentMethod === 'card' || paymentMethod === 'bank_transfer' ? finalAmt : 0),
        discount_amount: discountAmt,
        notes: notes || null,
        sold_by: soldByName,
        bank_account_code: selectedBankAccount || null,
        admin_fallback: false,
        seller_profile_id: contextSellerProfileId || null,
        items: itemsWithDiscount.map(l => ({
          jewelry_item_id: l.item.id,
          unit_price: l.item.sale_price,
          discount_amount: l.lineDiscount,
          tax_rate: 15,
          is_tax_inclusive: false,
        })),
      };

      // ==========================================
      // P4-3 EXECUTE ATOMIC RPC
      // ==========================================
      console.log('[P4-3] Executing complete_pos_sale_atomic with payload:', saleCmd);
      
      const { data: rpcResult, error: rpcError } = await dataGateway.completePOSSaleAtomic(saleCmd);

      if (rpcError) {
        console.error('[P4-3] RPC Error:', rpcError);
        await logPosAttemptFail({
          clientRequestId: requestId,
          errorCode: POS_ERROR_CODES.RPC_ERROR,
          errorMessage: rpcError.message,
        });
        throw new Error(`خطأ في عملية البيع: ${rpcError.message}`);
      }

      // Parse RPC result
      const result = rpcResult as {
        success: boolean;
        sale_id?: string;
        sale_code?: string;
        invoice_id?: string;
        invoice_number?: string;
        journal_entry_id?: string;
        journal_entry_number?: string;
        total_amount?: number;
        discount_amount?: number;
        tax_amount?: number;
        final_amount?: number;
        items_count?: number;
        payment_method?: string;
        error?: string;
        error_code?: string;
        idempotent?: boolean;
        message?: string;
      };

      if (!result.success) {
        // P4-3 ERROR HANDLING: Log and map error codes
        const errorCode = result.error_code || 'UNKNOWN';
        const errorMessage = result.error || 'خطأ غير معروف';
        
        await logPosAttemptFail({
          clientRequestId: requestId,
          errorCode: errorCode,
          errorMessage: errorMessage,
        });
        
        if (errorCode.includes('STATUS_LOCKED') || errorMessage.includes('locked')) {
          throw new Error('القطعة محجوزة حالياً - لا يمكن البيع');
        } else if (errorCode.includes('VALIDATION') || errorMessage.includes('INVALID_INPUT')) {
          throw new Error(`خطأ في البيانات: ${errorMessage}`);
        } else if (errorCode.includes('OUT_OF_STOCK') || errorMessage.includes('not available')) {
          throw new Error('القطعة غير متوفرة للبيع');
        } else if (errorCode.includes('BRANCH_MISMATCH') || errorMessage.includes('branch')) {
          throw new Error('القطعة ليست في الفرع الحالي');
        } else if (errorCode.includes('CONFLICT')) {
          throw new Error('العملية قيد التنفيذ - يرجى الانتظار');
        } else {
          throw new Error(`فشل البيع: ${errorMessage}`);
        }
      }

      // Log idempotent response if applicable
      if (result.idempotent) {
        console.log('[P4-3] Idempotent response - sale already processed:', result.message);
      }

      console.log('[P4-3] Sale completed successfully:', result);
      
      // P1B: Log success to pos_workflow_requests
      await logPosAttemptSuccess({
        clientRequestId: requestId,
        entityId: result.sale_id || '',
        result: { sale_code: result.sale_code, invoice_id: result.invoice_id },
      });

      // P2L: Capture payload for debug panel replay tests (Admin only)
      setLastCapturedPayload({
        clientRequestId: requestId,
        payload: saleCmd as Json,
        saleId: result.sale_id,
        invoiceId: result.invoice_id,
        journalEntryId: result.journal_entry_id,
        timestamp: new Date(),
      });

      // Return success data for onSuccess handler
      return {
        sale: {
          id: result.sale_id,
          sale_code: result.sale_code,
          invoice_number: result.invoice_number,
        },
        cartItems: cart, 
        customerData: selectedCustomer, 
        totalAmt: result.total_amount || totalAmt, 
        discountAmt: result.discount_amount || discountAmt, 
        taxAmt: result.tax_amount || taxAmt, 
        finalAmt: result.final_amount || finalAmt, 
        paymentMeth: paymentMethod,
        cashAmt: cashAmount,
        cardAmt: cardAmount,
        saleNotes: notes, 
        soldByName,
        journalEntryId: result.journal_entry_id,
        invoiceId: result.invoice_id,
      };
    },
    onSuccess: ({ sale, cartItems, customerData, totalAmt, discountAmt, taxAmt, finalAmt, paymentMeth, cashAmt, cardAmt, saleNotes, soldByName }) => {
      // Prepare completed sale for invoice
      const branchName = userBranches.find(b => b.branch_id === selectedBranch)?.branch_name || '';
      setCompletedSale({
        saleCode: sale.sale_code,
        saleDate: new Date(),
        branchName,
        customer: customerData,
        items: cartItems,
        totalAmount: totalAmt,
        discountAmount: discountAmt,
        taxAmount: taxAmt,
        finalAmount: finalAmt,
        paymentMethod: paymentMeth,
        cashAmount: cashAmt,
        cardAmount: cardAmt,
        notes: saleNotes,
        soldBy: soldByName,
      });
      
      toast.success(`تم إتمام البيع بنجاح - رقم الفاتورة: ${sale.invoice_number || sale.sale_code}`);
      
      // P4-3: Regenerate client_request_id after successful sale
      regenerateClientRequestId();
      
      setCart([]);
      setSelectedCustomer(null);
      setGrossTarget('');
      setDiscountValue(0);
      setDiscountType('amount');
      setCashAmount(0);
      setCardAmount(0);
      setPaymentMethod('cash');
      setSelectedBankAccount('');
      setNotes('');
      setShowCheckoutDialog(false);
      setShowInvoiceDialog(true);
      queryClient.invalidateQueries({ queryKey: ['pos-items'] });
      queryClient.invalidateQueries({ queryKey: ['pos-branch-stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
    onError: () => {
      toast.error('فشل في إتمام عملية البيع');
    },
  });

  // Helper function to extract karat from metal field (e.g., "18K", "21K", "Gold 24")
  const extractKaratFromMetal = (metal: string | null): number | null => {
    if (!metal) return null;
    const match = metal.match(/(\d+)\s*[Kك]/i);
    if (match) return parseInt(match[1]);
    // Check for common patterns
    if (metal.includes('24')) return 24;
    if (metal.includes('22')) return 22;
    if (metal.includes('21')) return 21;
    if (metal.includes('18')) return 18;
    return null;
  };

  // Calculate gold price based on weight and karat
  const calculateGoldPrice = (item: any): { price: number; karatValue: number | null } | null => {
    if (!isGoldBranch || todayGoldPrices.length === 0) return null;
    
    const karatValue = extractKaratFromMetal(item.metal);
    if (!karatValue || !item.g_weight) return null;
    
    const goldPrice = todayGoldPrices.find(p => p.karat_value === karatValue);
    if (!goldPrice) return null;
    
    return {
      price: item.g_weight * goldPrice.sell_price_per_gram,
      karatValue,
    };
  };

  const addToCart = (item: any) => {
    if (cart.find(c => c.id === item.id)) {
      toast.error('هذه القطعة موجودة في السلة بالفعل');
      return;
    }
    
    // Calculate gold price if applicable
    const goldCalc = calculateGoldPrice(item);
    const salePrice = Number(goldCalc?.price || item.tag_price || 0);
    
    setCart([...cart, {
      ...item,
      sale_price: salePrice,
      calculated_gold_price: goldCalc?.price || null,
      karat_value: goldCalc?.karatValue || null,
    }]);
    
    if (goldCalc) {
      toast.success(`تم حساب السعر تلقائياً: ${goldCalc.karatValue}K × ${item.g_weight}g`);
    }
  };

  const removeFromCart = (itemId: string) => {
    setCart(cart.filter(c => c.id !== itemId));
  };

  const updateSalePrice = (itemId: string, price: number) => {
    setCart(cart.map(c => c.id === itemId ? { ...c, sale_price: price } : c));
  };

  // Handle barcode scan
  const handleBarcodeScan = async (barcode: string) => {
    if (!barcode.trim() || !selectedBranch) return;
    
    // P4-1: Barcode scan also uses canonical sellable filter - sold_at IS NULL AND status = 'in_stock'
    const { data: item } = await dataGateway.queryTable('unique_items', {
      select: 'id, serial_no, model, description, type, metal, g_weight, d_weight, b_weight, clarity, tag_price, stockcode',
      filters: [
        { column: 'branch_id', type: 'eq', value: selectedBranch },
        { column: 'sold_at', type: 'is', value: null },
        { column: 'status', type: 'eq', value: 'in_stock' },
        { type: 'or', value: `stockcode.eq.${barcode},serial_no.eq.${barcode}` },
      ],
      maybeSingle: true,
    });
    if (item) {
      (item as any).item_code = (item as any).serial_no;
    }

    if (item) {
      // Calculate gold price if applicable
      const goldCalc = calculateGoldPrice(item);
      const salePrice = Number(goldCalc?.price || item.tag_price || 0);
      
      const cartItem = {
        ...item,
        sale_price: salePrice,
        calculated_gold_price: goldCalc?.price || null,
        karat_value: goldCalc?.karatValue || null,
      };
      
      if (cart.find(c => c.id === cartItem.id)) {
        toast.error('هذه القطعة موجودة في السلة بالفعل');
      } else {
        setCart([...cart, cartItem]);
        if (goldCalc) {
          toast.success(`تم حساب السعر تلقائياً: ${goldCalc.karatValue}K × ${item.g_weight}g`);
        }
      }
    } else {
      toast.error('لم يتم العثور على القطعة');
    }
  };

  const stopCameraStream = () => {
    cameraScanningRef.current = false;
    if (cameraRafRef.current) {
      cancelAnimationFrame(cameraRafRef.current);
      cameraRafRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
  };

  const openCameraScanner = async () => {
    setCameraError(null);
    const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const hasBD = typeof (window as any).BarcodeDetector !== 'undefined';
    const debugInfo: Record<string, any> = {
      isSecureContext: window.isSecureContext,
      hasMediaDevices: hasMedia,
      hasBarcodeDetector: hasBD,
      userAgent: navigator.userAgent.substring(0, 120),
    };
    if (hasBD) {
      try {
        const supported = await (window as any).BarcodeDetector.getSupportedFormats();
        debugInfo.supportedFormats = supported;
      } catch { debugInfo.supportedFormats = 'error'; }
    }
    setCameraDebugInfo(debugInfo);
    setShowCameraModal(true);

    if (!hasMedia) {
      setCameraError('الكاميرا غير متوفرة على هذا الجهاز');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      cameraStreamRef.current = stream;

      await new Promise<void>(resolve => {
        const check = () => {
          if (cameraVideoRef.current) { resolve(); return; }
          requestAnimationFrame(check);
        };
        check();
      });

      const video = cameraVideoRef.current!;
      video.srcObject = stream;
      await video.play();

      if (!hasBD) {
        setCameraError('BarcodeDetector غير مدعوم على هذا المتصفح (Debug)');
        return;
      }

      const detector = new (window as any).BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e'],
      });

      cameraScanningRef.current = true;
      const detectLoop = async () => {
        if (!cameraScanningRef.current || !cameraVideoRef.current) return;
        try {
          const barcodes = await detector.detect(cameraVideoRef.current);
          if (barcodes.length > 0 && barcodes[0].rawValue) {
            const scannedValue = barcodes[0].rawValue;
            stopCameraStream();
            setShowCameraModal(false);
            handleBarcodeScan(scannedValue);
            requestAnimationFrame(() => barcodeInputRef.current?.focus());
            return;
          }
        } catch {}
        if (cameraScanningRef.current) {
          cameraRafRef.current = requestAnimationFrame(detectLoop);
        }
      };
      cameraRafRef.current = requestAnimationFrame(detectLoop);
    } catch (err: any) {
      setCameraError(`${err.name}: ${err.message}`);
    }
  };

  useEffect(() => {
    return () => { stopCameraStream(); };
  }, []);

  const VAT_RATE = 0.15;
  const totalAmount = useMemo(() => cart.reduce((sum, item) => sum + Number(item.sale_price || 0), 0), [cart]);
  const originalGross = useMemo(() => totalAmount * (1 + VAT_RATE), [totalAmount]);

  const grossTargetNum = useMemo(() => {
    const v = parseFloat(grossTarget);
    return isNaN(v) || v < 0 ? 0 : v;
  }, [grossTarget]);

  const grossTargetError = useMemo(() => {
    if (!grossTarget || grossTargetNum === 0) return null;
    if (totalAmount <= 0) return 'السلة فارغة';
    if (grossTargetNum > originalGross + 0.01) return 'الإجمالي المدخل أكبر من قيمة السلة الأصلية';
    return null;
  }, [grossTarget, grossTargetNum, totalAmount, originalGross]);

  const hasGrossTarget = grossTarget !== '' && grossTargetNum > 0 && !grossTargetError;

  const { discountAmount, subtotalAfterDiscount, taxAmount, finalAmount, computedDiscountRate } = useMemo(() => {
    if (hasGrossTarget && totalAmount > 0) {
      const netTarget = grossTargetNum / (1 + VAT_RATE);
      const rate = 1 - (netTarget / totalAmount);
      const discAmt = totalAmount - netTarget;
      const tax = grossTargetNum - netTarget;
      return {
        discountAmount: Math.round(discAmt * 100) / 100,
        subtotalAfterDiscount: Math.round(netTarget * 100) / 100,
        taxAmount: Math.round(tax * 100) / 100,
        finalAmount: grossTargetNum,
        computedDiscountRate: Math.round(rate * 10000) / 100,
      };
    }
    const discAmt = discountType === 'percentage' ? (totalAmount * discountValue) / 100 : discountValue;
    const subAfterDisc = totalAmount - discAmt;
    const tax = subAfterDisc * VAT_RATE;
    return {
      discountAmount: discAmt,
      subtotalAfterDiscount: subAfterDisc,
      taxAmount: tax,
      finalAmount: subAfterDisc + tax,
      computedDiscountRate: totalAmount > 0 ? Math.round((discAmt / totalAmount) * 10000) / 100 : 0,
    };
  }, [hasGrossTarget, grossTargetNum, totalAmount, discountType, discountValue]);

  const cartItemNetPrices = useMemo(() => {
    if (discountAmount <= 0 || totalAmount <= 0) return new Map<string, number>();
    const rate = discountAmount / totalAmount;
    const prices = new Map<string, number>();
    let runningNet = 0;
    cart.forEach((item, idx) => {
      const lineNet = Number(item.sale_price || 0);
      let netAfter = Math.round(lineNet * (1 - rate) * 100) / 100;
      if (idx === cart.length - 1) {
        netAfter = Math.round((subtotalAfterDiscount - runningNet) * 100) / 100;
      }
      runningNet += netAfter;
      prices.set(item.id, netAfter);
    });
    return prices;
  }, [cart, discountAmount, totalAmount, subtotalAfterDiscount]);

  return (
    <POSLayout branchName={gateBranchName}>
      <POSEntryGate onModeResolved={(mode, info) => {
        if (mode === 'admin' && info) {
          setPosMode('admin');
          setAdminCashierName(info.display_name);
          if (info.branch_name) setGateBranchName(info.branch_name);
        } else {
          setPosMode('cashier');
        }
      }}>
        {(entryMode, adminInfo) => entryMode === 'admin' && !adminInfo?.branch_id ? (
      <div className="rtl-mode content-full-width page-container space-y-4">
        <div className="page-header-rtl">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 md:w-6 md:h-6 text-gold" />
              نقطة البيع
            </h1>
            <p className="page-description">إتمام عمليات البيع للعملاء</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <ShieldCheck className="w-3 h-3" />
              أدمن: {adminInfo?.display_name || 'أدمن POS'}
            </Badge>
          </div>
        </div>
        <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <AlertTitle className="text-amber-800 dark:text-amber-400">اختر الفرع للمتابعة</AlertTitle>
          <AlertDescription className="text-amber-700 dark:text-amber-300">
            استخدم القائمة المنسدلة في الشريط الجانبي لاختيار فرع قبل بدء عمليات البيع.
          </AlertDescription>
        </Alert>
      </div>
        ) : (
      <BranchLoginGate
        branches={userBranches.map(b => ({ branch_id: b.branch_id, branch_name: b.branch_name }))}
        onBranchChange={(id) => { setGateBranchId(id); }}
      >
        {(activeBranchId, activeBranchName, onChangeBranch) => {
          return (
      <>
      <BranchNameSync name={activeBranchName} onSync={setGateBranchName} />
      <POSCashierGate>
        {(cashierInfo, onChangeCashier) => (
          <>
          <SellerSync
            sellerProfileId={cashierInfo.seller_profile_id || ''}
            sellerDisplayName={cashierInfo.seller_display_name || cashierInfo.cashier_name || ''}
            onSync={(id, name) => { setContextSellerProfileId(id); setContextSellerName(name); }}
          />
      <div className="rtl-mode content-full-width page-container space-y-4">
        {/* Cashier mode POS */}
        {/* Header */}
        <div className="page-header-rtl">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 md:w-6 md:h-6 text-gold" />
              نقطة البيع
            </h1>
            <p className="page-description">إتمام عمليات البيع للعملاء</p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
            {/* Seller Badge (auto-determined from cashier session) */}
            <Badge
              variant="outline"
              className="gap-1 px-3 py-1.5 bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
              data-testid="badge-seller"
            >
              <User className="w-3.5 h-3.5 text-green-600" />
              <span className="text-sm font-medium">
                {currentSellerName || 'جاري التحميل...'}
              </span>
            </Badge>
            <Button
              variant={barcodeMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => setBarcodeMode(!barcodeMode)}
              className="min-h-[40px] sm:min-h-0"
            >
              <ScanBarcode className="w-4 h-4 ml-2" />
              وضع الباركود
            </Button>
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
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1 px-3 py-1.5">
                <Building2 className="w-3.5 h-3.5" />
                {activeBranchName || 'جاري التحميل...'}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                onClick={onChangeBranch}
                data-testid="button-change-branch"
                title="تغيير الفرع"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {!selectedBranch ? (
          <Card className="p-8 md:p-12 text-center">
            <Building2 className="w-12 h-12 md:w-16 md:h-16 mx-auto mb-3 md:mb-4 text-muted-foreground/50" />
            <h3 className="text-base md:text-lg font-semibold mb-2">اختر الفرع</h3>
            <p className="text-sm md:text-base text-muted-foreground">يرجى اختيار الفرع لبدء عملية البيع</p>
          </Card>
        ) : (
          <>
            {/* Gold Prices Banner for Gold Branches */}
            {isGoldBranch && (
              <Card className="border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/20 dark:to-yellow-950/20">
                <CardContent className="p-3 md:p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-5 h-5 text-amber-500" />
                    <span className="font-semibold text-amber-700 dark:text-amber-400">أسعار الذهب اليوم</span>
                  </div>
                  {todayGoldPrices.length === 0 ? (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      ⚠️ لم يتم تسجيل أسعار اليوم - يرجى تحديث الأسعار من شاشة أسعار الذهب
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {todayGoldPrices.map((price) => (
                        <div key={price.karat_id} className="bg-white dark:bg-background rounded-lg px-3 py-1.5 shadow-sm">
                          <span className="font-bold text-amber-600">{price.karat_value}K</span>
                          <span className="text-sm text-muted-foreground mx-1">:</span>
                          <span className="font-medium">{formatCurrency(price.sell_price_per_gram)}/g</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
              {/* Search & Add Items Section */}
              <div className="space-y-3 md:space-y-4">
                {/* Barcode Scanner Input */}
                <Card>
                  <CardContent className="px-3 md:px-6 pb-3 md:pb-4 pt-3 md:pt-4 space-y-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <ScanBarcode className="w-3.5 h-3.5" />
                      مسح / إدخال رقم القطعة
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        data-testid="button-barcode-add"
                        onClick={() => {
                          const input = barcodeInputRef.current;
                          if (input && input.value) {
                            handleBarcodeScan(input.value);
                            input.value = '';
                            requestAnimationFrame(() => input.focus());
                          }
                        }}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Input
                        ref={barcodeInputRef}
                        placeholder="امسح الباركود أو اكتب رقم القطعة..."
                        className="flex-1"
                        data-testid="input-barcode-scan"
                        onChange={(e) => {
                          const now = Date.now();
                          if (!barcodeFirstKeystrokeRef.current || e.target.value.length <= 1) {
                            barcodeFirstKeystrokeRef.current = now;
                          }
                          barcodeLastKeystrokeRef.current = now;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = (e.target as HTMLInputElement).value.trim();
                            if (!val) return;
                            const duration = barcodeLastKeystrokeRef.current - barcodeFirstKeystrokeRef.current;
                            const likelyScan = duration <= 200 && val.length >= 6;
                            barcodeFirstKeystrokeRef.current = 0;
                            barcodeLastKeystrokeRef.current = 0;
                            if (likelyScan || val.length >= 6) {
                              handleBarcodeScan(val);
                              (e.target as HTMLInputElement).value = '';
                              requestAnimationFrame(() => barcodeInputRef.current?.focus());
                            }
                          }
                        }}
                        autoFocus={barcodeMode}
                      />
                      <Button
                        variant="outline"
                        data-testid="button-camera-scan"
                        onClick={openCameraScanner}
                      >
                        <Camera className="w-4 h-4" />
                      </Button>
                    </div>
                    {cart.length === 0 && (
                      <div className="border rounded-lg p-8 md:p-10 flex flex-col items-center justify-center text-center" data-testid="status-empty-cart">
                        <ScanBarcode className="w-8 h-8 text-muted-foreground/40 mb-3" />
                        <p className="text-sm text-muted-foreground" data-testid="text-empty-cart-message">امسح الباركود أو اكتب رقم القطعة لإضافتها</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Cart Items - Larger */}
                <Card className="flex-1">
                  <CardHeader className="pb-3 px-3 md:px-6 pt-3 md:pt-4">
                    <CardTitle className="text-base flex items-center gap-2">
                      <ShoppingCart className="w-5 h-5 text-primary" />
                      السلة ({cart.length} قطعة)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {cart.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground">
                        <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">السلة فارغة</p>
                        <p className="text-xs mt-1">أضف قطع عن طريق الباركود أو البحث</p>
                      </div>
                    ) : (
                      <div className="max-h-80 md:max-h-96 overflow-y-auto divide-y">
                        {cart.map((item) => (
                          <div key={item.id} className="p-3 md:p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-mono text-sm font-medium">{item.item_code}</p>
                                  {item.karat_value && (
                                    <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">
                                      {item.karat_value}K
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground truncate">{item.model} {item.description && `• ${item.description}`}</p>
                                {item.supp_ref && (
                                  <p className="text-xs text-muted-foreground">فاتورة المورد: {item.supp_ref}</p>
                                )}
                                <p className="text-xs text-muted-foreground">
                                  G: {Number(item.g_weight || 0).toFixed(2)}g
                                  {item.d_weight ? ` • D: ${Number(item.d_weight).toFixed(2)}` : ''}
                                  {item.b_weight ? ` • B: ${Number(item.b_weight).toFixed(2)}` : ''}
                                </p>
                                {item.calculated_gold_price && (
                                  <p className="text-xs text-amber-600 mt-1">
                                    {Number(item.g_weight || 0).toFixed(2)}g × {formatCurrency(todayGoldPrices.find(p => p.karat_value === item.karat_value)?.sell_price_per_gram || 0)}/g
                                  </p>
                                )}
                              </div>
                              <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={() => removeFromCart(item.id)}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">السعر:</span>
                              {cartItemNetPrices.has(item.id) ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground line-through">{formatCurrency(item.sale_price)}</span>
                                  <span className="text-sm font-semibold text-primary">{formatCurrency(cartItemNetPrices.get(item.id)!)}</span>
                                </div>
                              ) : (
                                <span className="text-sm font-semibold">{formatCurrency(item.sale_price)}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Totals & Customer Section */}
              <div className="space-y-3 md:space-y-4">
                {/* Totals */}
                <Card>
                  <CardHeader className="pb-2 px-3 md:px-6 pt-3 md:pt-4">
                    <CardTitle className="text-base flex items-center gap-2">
                      <CreditCard className="w-4 h-4" />
                      ملخص الفاتورة
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 md:px-6 pb-4 space-y-3">
                    <div className="flex justify-between text-sm">
                      <span>المجموع ({cart.length} قطعة)</span>
                      <span className="font-medium">{formatCurrency(totalAmount)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>شامل الضريبة</span>
                      <span>{formatCurrency(originalGross)}</span>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">الإجمالي النهائي (شامل الضريبة)</Label>
                      <Input
                        type="number"
                        value={grossTarget}
                        onChange={(e) => setGrossTarget(e.target.value)}
                        className="h-9"
                        placeholder="اكتب إجمالي البيع النهائي..."
                        data-testid="input-gross-target"
                      />
                      {grossTargetError && (
                        <p className="text-xs text-destructive">{grossTargetError}</p>
                      )}
                    </div>
                    {hasGrossTarget && (
                      <>
                        <div className="flex justify-between text-sm text-destructive">
                          <span>نسبة الخصم المحسوبة</span>
                          <span>{computedDiscountRate}%</span>
                        </div>
                        <div className="flex justify-between text-sm text-destructive">
                          <span>قيمة الخصم</span>
                          <span>-{formatCurrency(discountAmount)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between text-sm">
                      <span>الإجمالي (بدون ضريبة)</span>
                      <span className="font-medium">{formatCurrency(subtotalAfterDiscount)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>ضريبة القيمة المضافة (15%)</span>
                      <span>{formatCurrency(taxAmount)}</span>
                    </div>
                    <div className="flex justify-between text-xl font-bold border-t pt-3">
                      <span>الإجمالي شامل الضريبة</span>
                      <span className="text-primary">{formatCurrency(finalAmount)}</span>
                    </div>
                    {finalAmount > 0 && (
                      <p className="text-xs text-muted-foreground text-center mt-2" data-testid="text-total-tafqeet">{tafqeet(finalAmount)}</p>
                    )}
                  </CardContent>
                </Card>

                {/* Customer Search by Phone */}
                <PhoneCustomerSearch
                  selectedCustomer={selectedCustomer}
                  onCustomerSelect={setSelectedCustomer}
                  onCreateNewCustomer={(phone) => {
                    setPrefillPhone(phone);
                    setShowPOSQuickCustomerDialog(true);
                  }}
                  isRequired={paymentMethod === 'credit'}
                  paymentMethod={paymentMethod}
                />

                {/* Checkout Button */}
                <Button
                  className="w-full h-14 text-lg"
                  size="lg"
                  disabled={cart.length === 0 || !contextSellerProfileId}
                  onClick={() => setShowCheckoutDialog(true)}
                >
                  <Check className="w-5 h-5 ml-2" />
                  إتمام البيع
                </Button>
                {cart.length > 0 && !selectedCustomer && contextSellerProfileId && (
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    البيع سيتم كعميل نقدي (Walk-in)
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {/* Customer Selection Dialog */}
        <Dialog open={showCustomerDialog} onOpenChange={setShowCustomerDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>اختيار العميل</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="البحث بالاسم أو رقم الهاتف..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="pr-10"
                />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {customers.map((customer) => (
                  <div
                    key={customer.id}
                    className="p-3 border rounded-lg cursor-pointer hover:bg-muted/50"
                    onClick={() => {
                      setSelectedCustomer(customer);
                      setShowCustomerDialog(false);
                    }}
                  >
                    <p className="font-medium">{customer.full_name}</p>
                    <p className="text-sm text-muted-foreground">{customer.phone} • {customer.customer_code}</p>
                  </div>
                ))}
              </div>
              <Button variant="outline" className="w-full" onClick={() => {
                setShowCustomerDialog(false);
                setShowNewCustomerDialog(true);
              }}>
                <Plus className="w-4 h-4 ml-2" />
                إضافة عميل جديد
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* New Customer Dialog */}
        <Dialog open={showNewCustomerDialog} onOpenChange={setShowNewCustomerDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>إضافة عميل جديد</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Customer Type Toggle */}
              <div>
                <Label className="mb-2 block">نوع العميل *</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={newCustomer.customer_type === 'individual' ? 'default' : 'outline'}
                    className="flex-1"
                    onClick={() => setNewCustomer({ ...newCustomer, customer_type: 'individual', company_name: '', vat_number: '' })}
                  >
                    <User className="w-4 h-4 ml-2" />
                    فرد
                  </Button>
                  <Button
                    type="button"
                    variant={newCustomer.customer_type === 'company' ? 'default' : 'outline'}
                    className="flex-1"
                    onClick={() => setNewCustomer({ ...newCustomer, customer_type: 'company' })}
                  >
                    <Building2 className="w-4 h-4 ml-2" />
                    شركة
                  </Button>
                </div>
              </div>

              {/* Company-specific fields */}
              {newCustomer.customer_type === 'company' && (
                <>
                  <div>
                    <Label>اسم الشركة *</Label>
                    <Input
                      value={newCustomer.company_name}
                      onChange={(e) => setNewCustomer({ ...newCustomer, company_name: e.target.value })}
                      placeholder="اسم الشركة أو المؤسسة"
                    />
                  </div>
                  <div>
                    <Label>الرقم الضريبي *</Label>
                    <Input
                      value={newCustomer.vat_number}
                      onChange={(e) => setNewCustomer({ ...newCustomer, vat_number: e.target.value })}
                      placeholder="300000000000003"
                      className="font-mono"
                      dir="ltr"
                    />
                  </div>
                </>
              )}

              <div>
                <Label>{newCustomer.customer_type === 'company' ? 'اسم المسؤول' : 'الاسم الكامل'} *</Label>
                <Input
                  value={newCustomer.full_name}
                  onChange={(e) => setNewCustomer({ ...newCustomer, full_name: e.target.value })}
                />
              </div>

              <div>
                <Label>رقم الهاتف {newCustomer.customer_type === 'individual' ? '*' : ''}</Label>
                <Input
                  value={newCustomer.phone}
                  onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                />
              </div>

              <div>
                <Label>العنوان</Label>
                <Textarea
                  value={newCustomer.address}
                  onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNewCustomerDialog(false)}>
                إلغاء
              </Button>
              <Button
                onClick={() => createCustomerMutation.mutate(newCustomer)}
                disabled={
                  !newCustomer.full_name || 
                  createCustomerMutation.isPending ||
                  (newCustomer.customer_type === 'company' && (!newCustomer.company_name || !newCustomer.vat_number)) ||
                  (newCustomer.customer_type === 'individual' && !newCustomer.phone)
                }
              >
                {createCustomerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'حفظ'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Checkout Dialog */}
        <Dialog open={showCheckoutDialog} onOpenChange={setShowCheckoutDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>إتمام عملية البيع</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <div className="flex justify-between mb-2">
                  <span>عدد القطع</span>
                  <span className="font-medium">{cart.length}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span>المجموع</span>
                  <span className="font-medium">{formatCurrency(totalAmount)}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between mb-2">
                    <span>الخصم ({computedDiscountRate}%)</span>
                    <span className="font-medium text-destructive">-{formatCurrency(discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between mb-2">
                  <span>الإجمالي (بدون ضريبة)</span>
                  <span className="font-medium">{formatCurrency(subtotalAfterDiscount)}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span>ضريبة القيمة المضافة (15%)</span>
                  <span className="font-medium">{formatCurrency(taxAmount)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>الإجمالي شامل الضريبة</span>
                  <span className="text-primary">{formatCurrency(finalAmount)}</span>
                </div>
                {finalAmount > 0 && (
                  <p className="text-xs text-muted-foreground text-center mt-2" data-testid="text-checkout-tafqeet">{tafqeet(finalAmount)}</p>
                )}
              </div>

              <div>
                <Label>طريقة الدفع</Label>
                <div className="grid grid-cols-4 gap-2 mt-2">
                  <Button
                    variant={paymentMethod === 'cash' ? 'default' : 'outline'}
                    onClick={() => {
                      setPaymentMethod('cash');
                      setCashAmount(finalAmount);
                      setCardAmount(0);
                    }}
                    className="gap-1"
                    size="sm"
                  >
                    <Banknote className="w-4 h-4" />
                    نقداً
                  </Button>
                  <Button
                    variant={paymentMethod === 'card' ? 'default' : 'outline'}
                    onClick={() => {
                      setPaymentMethod('card');
                      setCashAmount(0);
                      setCardAmount(finalAmount);
                    }}
                    className="gap-1"
                    size="sm"
                  >
                    <CreditCard className="w-4 h-4" />
                    بطاقة
                  </Button>
                  <Button
                    variant={paymentMethod === 'split' ? 'default' : 'outline'}
                    onClick={() => {
                      setPaymentMethod('split');
                      setCashAmount(0);
                      setCardAmount(finalAmount);
                    }}
                    className="gap-1"
                    size="sm"
                  >
                    <Banknote className="w-3 h-3" />
                    <CreditCard className="w-3 h-3" />
                  </Button>
                  <Button
                    variant={paymentMethod === 'credit' ? 'default' : 'outline'}
                    onClick={() => {
                      setPaymentMethod('credit');
                      setCashAmount(0);
                      setCardAmount(0);
                    }}
                    className={`gap-1 ${!selectedCustomer ? 'opacity-70' : ''}`}
                    size="sm"
                  >
                    <User className="w-4 h-4" />
                    آجل
                  </Button>
                </div>
              </div>

              {paymentMethod === 'split' && (
                <div className="space-y-3 p-3 bg-muted/50 rounded-lg border">
                  <div className="flex items-center gap-2">
                    <Label className="w-20">نقدي:</Label>
                    <Input
                      type="number"
                      value={cashAmount || ''}
                      onChange={(e) => {
                        const cash = Number(e.target.value) || 0;
                        setCashAmount(cash);
                        setCardAmount(Math.max(0, finalAmount - cash));
                      }}
                      className="flex-1"
                      placeholder="المبلغ النقدي"
                    />
                    <span className="text-sm text-muted-foreground">ر.س</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="w-20">بطاقة:</Label>
                    <Input
                      type="number"
                      value={cardAmount || ''}
                      onChange={(e) => {
                        const card = Number(e.target.value) || 0;
                        setCardAmount(card);
                        setCashAmount(Math.max(0, finalAmount - card));
                      }}
                      className="flex-1"
                      placeholder="مبلغ البطاقة"
                    />
                    <span className="text-sm text-muted-foreground">ر.س</span>
                  </div>
                  {Math.abs(cashAmount + cardAmount - finalAmount) > 0.01 && (
                    <div className="text-sm text-destructive flex justify-between">
                      <span>الفرق:</span>
                      <span>{formatCurrency(finalAmount - cashAmount - cardAmount)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Bank Account Selection for Card Payment */}
              {(paymentMethod === 'card' || (paymentMethod === 'split' && cardAmount > 0)) && bankAccounts.length > 0 && (
                <div>
                  <Label>الحساب البنكي</Label>
                  <Select value={selectedBankAccount} onValueChange={setSelectedBankAccount}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="اختر البنك..." />
                    </SelectTrigger>
                    <SelectContent>
                      {bankAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.account_code}>
                          {account.account_code} - {account.account_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    سيتم تسجيل مبلغ البطاقة في هذا الحساب
                  </p>
                </div>
              )}

              <div>
                <Label>ملاحظات</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات إضافية..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCheckoutDialog(false)}>
                إلغاء
              </Button>
              <Button
                onClick={() => completeSaleMutation.mutate()}
                disabled={
                  completeSaleMutation.isPending ||
                  (paymentMethod === 'split' && Math.abs(cashAmount + cardAmount - finalAmount) > 0.01)
                }
              >
                {completeSaleMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Check className="w-4 h-4 ml-2" />
                    تأكيد البيع
                  </>
                )}
              </Button>
            </DialogFooter>
            {/* Walk-in Customer Info */}
            {!selectedCustomer && (
              <div className="text-sm text-muted-foreground text-center mt-2 p-2 bg-muted/50 rounded-lg">
                💡 البيع سيتم كعميل نقدي (Walk-in) بدون ربط بحساب عميل
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Invoice Dialog */}
        <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Printer className="w-5 h-5" />
                فاتورة البيع
              </DialogTitle>
            </DialogHeader>
            {completedSale && (
              <SaleInvoice
                ref={invoiceRef}
                saleCode={completedSale.saleCode}
                saleDate={completedSale.saleDate}
                branchName={completedSale.branchName}
                customer={completedSale.customer}
                items={completedSale.items}
                totalAmount={completedSale.totalAmount}
                discountAmount={completedSale.discountAmount}
                taxAmount={completedSale.taxAmount}
                finalAmount={completedSale.finalAmount}
                paymentMethod={completedSale.paymentMethod}
                cashAmount={completedSale.cashAmount}
                cardAmount={completedSale.cardAmount}
                notes={completedSale.notes}
                soldBy={completedSale.soldBy}
              />
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowInvoiceDialog(false)}>
                إغلاق
              </Button>
              <Button
                onClick={() => {
                  const printContent = invoiceRef.current;
                  if (printContent) {
                    const printWindow = window.open('', '_blank');
                    if (printWindow) {
                      printWindow.document.write(`
                        <!DOCTYPE html>
                        <html dir="rtl">
                          <head>
                            <title>فاتورة - ${completedSale?.saleCode}</title>
                            <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
                            <style>
                              * { margin: 0; padding: 0; box-sizing: border-box; }
                              body { 
                                font-family: 'Cairo', Arial, sans-serif; 
                                direction: rtl;
                                background: white;
                                color: black;
                                font-size: 10pt;
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                              }
                              
                              /* Invoice Container */
                              .bg-white { background: white; }
                              .text-black { color: black; }
                              .p-4 { padding: 1rem; }
                              .p-3 { padding: 0.75rem; }
                              .max-w-\\[800px\\] { max-width: 800px; }
                              .mx-auto { margin-left: auto; margin-right: auto; }
                              
                              /* Flexbox utilities */
                              .flex { display: flex; }
                              .items-center { align-items: center; }
                              .justify-between { justify-content: space-between; }
                              .justify-end { justify-content: flex-end; }
                              .flex-col { flex-direction: column; }
                              .gap-2 { gap: 0.5rem; }
                              .gap-3 { gap: 0.75rem; }
                              
                              /* Grid utilities */
                              .grid { display: grid; }
                              .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                              
                              /* Spacing */
                              .space-y-1 > * + * { margin-top: 0.25rem; }
                              .space-y-0\\.5 > * + * { margin-top: 0.125rem; }
                              .mb-1 { margin-bottom: 0.25rem; }
                              .mb-2 { margin-bottom: 0.5rem; }
                              .mb-3 { margin-bottom: 0.75rem; }
                              .mt-1 { margin-top: 0.25rem; }
                              .pt-0\\.5 { padding-top: 0.125rem; }
                              .pt-1 { padding-top: 0.25rem; }
                              .pt-2 { padding-top: 0.5rem; }
                              .pb-0\\.5 { padding-bottom: 0.125rem; }
                              .pb-1 { padding-bottom: 0.25rem; }
                              .pb-2 { padding-bottom: 0.5rem; }
                              .p-1 { padding: 0.25rem; }
                              .p-2 { padding: 0.5rem; }
                              .px-1 { padding-left: 0.25rem; padding-right: 0.25rem; }
                              .-mx-1 { margin-left: -0.25rem; margin-right: -0.25rem; }
                              
                              /* Border utilities */
                              .border { border: 1px solid #d1d5db; }
                              .border-b { border-bottom: 1px solid #d1d5db; }
                              .border-t { border-top: 1px solid #d1d5db; }
                              .border-b-2 { border-bottom: 2px solid black; }
                              .border-t-2 { border-top: 2px solid black; }
                              .border-gray-200 { border-color: #e5e7eb; }
                              .border-gray-300 { border-color: #d1d5db; }
                              .border-black { border-color: black; }
                              .border-collapse { border-collapse: collapse; }
                              .rounded { border-radius: 0.25rem; }
                              .rounded-lg { border-radius: 0.5rem; }
                              
                              /* Typography */
                              .text-center { text-align: center; }
                              .text-right { text-align: right; }
                              .text-left { text-align: left; }
                              .font-bold { font-weight: 700; }
                              .font-medium { font-weight: 500; }
                              .font-mono { font-family: monospace; }
                              .text-lg { font-size: 1.125rem; }
                              .text-base { font-size: 1rem; }
                              .text-sm { font-size: 0.875rem; }
                              .text-xs { font-size: 0.75rem; }
                              .text-\\[10px\\] { font-size: 10px; }
                              .text-\\[9px\\] { font-size: 9px; }
                              
                              /* Colors */
                              .text-gray-600 { color: #4b5563; }
                              .text-gray-400 { color: #9ca3af; }
                              .text-green-700 { color: #15803d; }
                              .text-red-600 { color: #dc2626; }
                              .bg-gray-100 { background-color: #f3f4f6; }
                              .bg-gray-50 { background-color: #f9fafb; }
                              .bg-green-50 { background-color: #f0fdf4; }
                              .text-slate-900 { color: #0f172a; }
                              
                              /* Gradient */
                              .bg-gradient-to-br { 
                                background: linear-gradient(to bottom right, #fbbf24, #d97706); 
                              }
                              
                              /* Sizing */
                              .w-full { width: 100%; }
                              .w-5 { width: 1.25rem; }
                              .w-10 { width: 2.5rem; }
                              .w-16 { width: 4rem; }
                              .w-56 { width: 14rem; }
                              .h-5 { height: 1.25rem; }
                              .h-10 { height: 2.5rem; }
                              .h-16 { height: 4rem; }
                              
                              /* Table */
                              table { width: 100%; border-collapse: collapse; }
                              th, td { border: 1px solid #d1d5db; padding: 0.25rem; text-align: right; font-size: 10px; }
                              th { background-color: #f3f4f6; font-weight: 600; }
                              tfoot td { background-color: #f9fafb; font-weight: 500; }
                              
                              @media print {
                                @page { size: A4; margin: 10mm; }
                                body { 
                                  -webkit-print-color-adjust: exact !important;
                                  print-color-adjust: exact !important;
                                }
                                .bg-gradient-to-br { 
                                  background: linear-gradient(to bottom right, #fbbf24, #d97706) !important; 
                                }
                              }
                            </style>
                          </head>
                          <body>
                            ${printContent.innerHTML}
                          </body>
                        </html>
                      `);
                      printWindow.document.close();
                      setTimeout(() => {
                        printWindow.print();
                      }, 250);
                    }
                  }
                }}
              >
                <Printer className="w-4 h-4 ml-2" />
                طباعة
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* POS Quick Customer Dialog */}
        <POSQuickCustomerDialog
          open={showPOSQuickCustomerDialog}
          onOpenChange={setShowPOSQuickCustomerDialog}
          prefillPhone={prefillPhone}
          onCustomerCreated={(customer) => {
            setSelectedCustomer(customer);
            setShowPOSQuickCustomerDialog(false);
          }}
        />

        {/* P2L: Debug Panel - Admin-only + ?posDebug=1 */}
        {isDebugMode && isAdmin && (
          <div className="fixed bottom-4 left-4 z-50 w-96 max-h-[80vh] overflow-auto">
            <POSDebugPanel lastCapturedPayload={lastCapturedPayload} />
          </div>
        )}

        {/* Camera Scanner Modal */}
        <Dialog open={showCameraModal} onOpenChange={(open) => {
          if (!open) { stopCameraStream(); }
          setShowCameraModal(open);
        }}>
          <DialogContent className="max-w-md" data-testid="dialog-camera-scanner">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5" />
                مسح الباركود بالكاميرا
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="relative rounded-lg overflow-hidden bg-black aspect-[4/3]">
                <video
                  ref={cameraVideoRef}
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {!cameraError && cameraScanningRef.current && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-48 h-48 border-2 border-white/60 rounded-lg" />
                  </div>
                )}
              </div>

              {cameraError && (
                <Alert variant="destructive">
                  <AlertDescription className="text-sm">{cameraError}</AlertDescription>
                </Alert>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">معلومات التشخيص (Debug)</summary>
                <pre className="mt-1 p-2 bg-muted rounded text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-all" dir="ltr">
                  {JSON.stringify(cameraDebugInfo, null, 2)}
                </pre>
              </details>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { stopCameraStream(); setShowCameraModal(false); }} data-testid="button-camera-close">
                إغلاق
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
          </>
        )}
      </POSCashierGate>
      </>
        );
        }}
      </BranchLoginGate>
        )}
      </POSEntryGate>
    </POSLayout>
  );
}
