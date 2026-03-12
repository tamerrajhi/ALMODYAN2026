import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Plus, Save, Loader2, Building2, SaveAll, RotateCcw, FileText, AlertTriangle, Package } from 'lucide-react';
import { toast } from 'sonner';
import { format, addDays } from 'date-fns';
import { UnifiedInvoiceLineRow, UnifiedInvoiceLine, calculateUnifiedLine } from '@/components/purchasing/UnifiedInvoiceLineRow';
import { ItemType } from '@/components/purchasing/UnifiedItemCombobox';
import { QuickSupplierDialog } from '@/components/purchasing/QuickSupplierDialog';
import JewelryItemFormDialog from '@/components/products/JewelryItemFormDialog';
import { DocumentType, getDocumentConfig, isReturnDocument } from '@/types/document.types';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  createPurchaseReturnGeneralAtomic,
  createPurchaseReturnUniqueAtomic,
  createPurchaseInvoiceAtomic,
  CreatePurchaseReturnGeneralCommand,
  CreatePurchaseReturnUniqueCommand,
  PurchaseReturnLineInput,
  PurchaseReturnItemInput,
  AtomicCreatePurchaseInvoiceCommand,
  AtomicCreatePurchaseReturnGeneralCommand,
  AtomicCreatePurchaseReturnUniqueCommand,
} from '@/domain/purchasing';

interface Supplier {
  id: string;
  supplier_name: string;
  supplier_ref: string;
  phone: string | null;
  email: string | null;
  vat_number: string | null;
  address: string | null;
}

// Return reasons
const RETURN_REASONS = [
  { value: 'defect', labelAr: 'عيب تصنيع', labelEn: 'Manufacturing Defect' },
  { value: 'excess', labelAr: 'زيادة عن الحاجة', labelEn: 'Excess Stock' },
  { value: 'wrong_item', labelAr: 'خطأ في التوريد', labelEn: 'Wrong Item' },
  { value: 'quality', labelAr: 'مشكلة جودة', labelEn: 'Quality Issue' },
  { value: 'price_difference', labelAr: 'فرق سعر', labelEn: 'Price Difference' },
  { value: 'other', labelAr: 'أخرى', labelEn: 'Other' },
];

// Return types
const RETURN_TYPES = [
  { value: 'inventory_return', labelAr: 'مرتجع مخزني', labelEn: 'Inventory Return' },
  { value: 'discount_only', labelAr: 'خصم فقط', labelEn: 'Discount Only' },
  { value: 'price_adjustment', labelAr: 'تعديل سعر', labelEn: 'Price Adjustment' },
];

// Extended line interface for returns with additional fields
interface ReturnLine extends UnifiedInvoiceLine {
  original_quantity: number;
  returned_quantity: number;
  available_quantity: number;
  return_reason?: string;
  return_type?: string;
  line_notes?: string;
  warehouse_id?: string;
}

interface UnifiedPurchaseDocumentPageProps {
  documentType: 'PURCHASE_INVOICE' | 'PURCHASE_RETURN';
  viewMode?: boolean;
}

const UnifiedPurchaseDocumentPage = ({ documentType, viewMode = false }: UnifiedPurchaseDocumentPageProps) => {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  const config = getDocumentConfig(documentType);
  const isReturn = isReturnDocument(documentType);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSupplierDialog, setShowSupplierDialog] = useState(false);
  const [showJewelryDialog, setShowJewelryDialog] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    reference: '',
    description: '',
    supplier_id: '',
    issue_date: format(new Date(), 'yyyy-MM-dd'),
    payment_terms: 'cash',
    due_date: format(new Date(), 'yyyy-MM-dd'),
    delivery_date: format(new Date(), 'yyyy-MM-dd'),
    branch_id: '',
    linked_invoice_id: '',
    return_reason: '',
    return_type: 'inventory_return',
    notes: '',
  });

  // Helper function to create an empty line
  const createEmptyLine = useCallback((lineNumber: number = 1): ReturnLine => ({
    id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    line_number: lineNumber,
    item_id: null,
    item_type: null,
    item_code: '',
    description: '',
    quantity: 0,
    unit_price: 0,
    is_inclusive: false,
    discount_amount: 0,
    subtotal: 0,
    tax_rate: 15,
    tax_amount: 0,
    total_amount: 0,
    gl_account_id: null,
    warehouse_account_id: null,
    original_quantity: 0,
    returned_quantity: 0,
    available_quantity: 0,
    return_reason: '',
    return_type: 'inventory_return',
    line_notes: '',
    warehouse_id: '',
  }), []);

  // Initialize with one empty line for new documents
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // PR-2: Client request ID for idempotency
  const clientRequestIdRef = useRef<string | null>(null);

  // Fetch suppliers
  const { data: suppliers = [], refetch: refetchSuppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data, error } = await dataGateway.queryTable('suppliers', {
        select: '*',
        order: { column: 'supplier_name', ascending: true }
      });
      if (error) throw error;
      return (data || []) as Supplier[];
    }
  });

  // Fetch branches
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data, error } = await dataGateway.queryTable('branches', {
        select: '*',
        filters: [{ type: 'eq', column: 'is_active', value: true }],
        order: { column: 'branch_name', ascending: true }
      });
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch jewelry items
  const { data: jewelryItems = [], refetch: refetchJewelry } = useQuery({
    queryKey: ['jewelry-items-for-invoice'],
    queryFn: async () => {
      const { data, error } = await dataGateway.queryTable('unique_items', {
        select: 'id, item_code, description',
        filters: [{ type: 'is', column: 'sold_at', value: null }],
        order: { column: 'item_code', ascending: true },
        limit: 500
      });
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch cost entries
  const { data: costEntries = [] } = useQuery({
    queryKey: ['cost-entries-for-invoice'],
    queryFn: async () => {
      const { data, error } = await dataGateway.queryTable('cost_entries', {
        select: 'id, cost_code, name_ar, cost_type, gl_account_id, tax_rate',
        filters: [{ type: 'eq', column: 'is_active', value: true }],
        order: { column: 'cost_code', ascending: true }
      });
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch products
  const { data: products = [] } = useQuery({
    queryKey: ['products-for-invoice'],
    queryFn: async () => {
      const { data, error } = await dataGateway.queryTable('products', {
        select: 'id, product_code, name_ar, product_type, inventory_account_id, expense_account_id, tax_rate',
        filters: [{ type: 'eq', column: 'is_active', value: true }],
        order: { column: 'product_code', ascending: true }
      });
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch original invoices for returns (to link)
  const { data: originalInvoices = [] } = useQuery({
    queryKey: ['purchase-invoices-for-return', formData.supplier_id],
    queryFn: async () => {
      if (!isReturn || !formData.supplier_id) return [];
      const { data, error } = await dataGateway.queryTable('invoices', {
        select: 'id, invoice_number, total_amount, subtotal, tax_amount, invoice_date, branch_id',
        filters: [
          { type: 'eq', column: 'invoice_type', value: 'purchase' },
          { type: 'eq', column: 'supplier_id', value: formData.supplier_id }
        ],
        order: { column: 'invoice_date', ascending: false }
      });
      if (error) throw error;
      return data || [];
    },
    enabled: isReturn && !!formData.supplier_id,
  });

  // Selected original invoice details
  const selectedOriginalInvoice = useMemo(() => {
    return originalInvoices.find(inv => inv.id === formData.linked_invoice_id);
  }, [originalInvoices, formData.linked_invoice_id]);

  // State for original invoice lines and available quantities
  const [originalInvoiceLines, setOriginalInvoiceLines] = useState<{
    itemId: string;
    itemCode: string;
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    returnedQty: number;
    availableQty: number;
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    glAccountId: string | null;
    warehouseAccountId: string | null;
    itemType: string;
  }[]>([]);

  // Calculate total previously returned for the original invoice
  const previousReturnsTotal = useMemo(() => {
    return originalInvoiceLines.reduce((sum, line) => {
      const returnedValue = line.returnedQty * line.unitPrice * (1 + line.taxRate / 100);
      return sum + returnedValue;
    }, 0);
  }, [originalInvoiceLines]);

  // Calculate available for return
  const availableForReturnTotal = useMemo(() => {
    if (!selectedOriginalInvoice) return 0;
    return selectedOriginalInvoice.total_amount - previousReturnsTotal;
  }, [selectedOriginalInvoice, previousReturnsTotal]);

  // Fetch original invoice lines when linked invoice changes
  useEffect(() => {
    const fetchOriginalInvoiceLines = async () => {
      if (!isReturn || !formData.linked_invoice_id) {
        setOriginalInvoiceLines([]);
        return;
      }

      try {
        // Get original invoice lines
        const { data: invoiceLines, error } = await dataGateway.queryTable('purchase_invoice_lines', {
          select: '*',
          filters: [{ type: 'eq', column: 'invoice_id', value: formData.linked_invoice_id }],
          order: { column: 'line_number', ascending: true }
        });

        if (error) throw error;

        // Get already returned quantities for this invoice
        // Use composite key: product_code + line_number for accurate tracking
        const returnedQtyMap: Record<string, number> = {};
        
        const returnInvoicesResult = await dataGateway.queryTable('invoices', {
          select: 'id',
          filters: [
            { type: 'eq', column: 'invoice_type', value: 'purchase_return' },
            { type: 'eq', column: 'linked_invoice_id', value: formData.linked_invoice_id }
          ]
        });
        
        const returnInvoices = returnInvoicesResult.data as { id: string }[] | null;

        if (returnInvoices && returnInvoices.length > 0) {
          // Exclude current return if editing
          const returnIds = returnInvoices
            .filter(r => r.id !== id)
            .map(r => r.id);
          
          if (returnIds.length > 0) {
            const { data: returnLines } = await dataGateway.queryTable('purchase_invoice_lines', {
              select: 'product_id, product_code, line_number, quantity',
              filters: [{ type: 'in', column: 'invoice_id', value: returnIds }]
            });
            
            if (returnLines) {
              returnLines.forEach((line) => {
                // Use composite key: product_code (or product_id as fallback)
                const lineKey = line.product_code || line.product_id || `line_${line.line_number}`;
                if (lineKey) {
                  returnedQtyMap[lineKey] = (returnedQtyMap[lineKey] || 0) + (line.quantity || 0);
                }
              });
            }
          }
        }

        // Build available quantities using composite key for matching
        const linesWithAvailable = (invoiceLines || []).map((line, index) => {
          // Use same composite key strategy
          const lineKey = line.product_code || line.product_id || `line_${line.line_number || index + 1}`;
          const returnedQty = returnedQtyMap[lineKey] || 0;
          
          return {
            itemId: line.product_id || `line_${line.line_number || index + 1}`,
            itemCode: line.product_code || '',
            description: line.description || '',
            quantity: line.quantity || 0,
            unitPrice: line.unit_price || 0,
            taxRate: line.tax_rate || 15,
            returnedQty: returnedQty,
            availableQty: Math.max(0, (line.quantity || 0) - returnedQty),
            subtotal: line.subtotal || 0,
            taxAmount: line.tax_amount || 0,
            totalAmount: line.total_amount || 0,
            glAccountId: line.gl_account_id,
            warehouseAccountId: line.warehouse_account_id,
            itemType: line.item_type || 'jewelry',
            lineNumber: line.line_number || index + 1,
          };
        });

        setOriginalInvoiceLines(linesWithAvailable);

        // Auto-populate lines from original invoice if creating new return
        if (!isEditing && linesWithAvailable.length > 0) {
          const newLines: ReturnLine[] = linesWithAvailable
            .filter(l => l.availableQty > 0)
            .map((origLine, idx) => {
              const calculatedLine = calculateUnifiedLine({
                id: `temp-${Date.now()}-${idx}`,
                line_number: idx + 1,
                item_id: origLine.itemId,
                item_type: origLine.itemType as ItemType || 'jewelry',
                item_code: origLine.itemCode,
                description: origLine.description,
                quantity: 0, // Start with 0, user must enter return quantity
                unit_price: origLine.unitPrice,
                is_inclusive: false,
                discount_amount: 0,
                subtotal: 0,
                tax_rate: origLine.taxRate,
                tax_amount: 0,
                total_amount: 0,
                gl_account_id: origLine.glAccountId,
                warehouse_account_id: origLine.warehouseAccountId,
              });
              return {
                ...calculatedLine,
                original_quantity: origLine.quantity,
                returned_quantity: origLine.returnedQty,
                available_quantity: origLine.availableQty,
                return_reason: formData.return_reason || '',
                return_type: formData.return_type || 'inventory_return',
                line_notes: '',
                warehouse_id: formData.branch_id,
              };
            });

          if (newLines.length > 0) {
            setLines(newLines);
            // Auto-set branch from original invoice
            if (selectedOriginalInvoice?.branch_id && !formData.branch_id) {
              setFormData(prev => ({ ...prev, branch_id: selectedOriginalInvoice.branch_id }));
            }
          }
        }
      } catch (error) {
        console.error('Error fetching original invoice lines:', error);
      }
    };

    fetchOriginalInvoiceLines();
  }, [formData.linked_invoice_id, isReturn, isEditing, id, formData.return_reason, formData.return_type, formData.branch_id, selectedOriginalInvoice?.branch_id]);

  // Validate quantity against available - supports both itemId and itemCode matching
  const validateReturnQuantity = useCallback((itemId: string, quantity: number, itemCode?: string): { valid: boolean; maxQty: number } => {
    if (!formData.linked_invoice_id) {
      return { valid: true, maxQty: 999 };
    }
    
    // Find original line by itemCode first (more reliable), then by itemId
    const originalLine = originalInvoiceLines.find(l => 
      (itemCode && l.itemCode === itemCode) || l.itemId === itemId
    );
    
    if (!originalLine) {
      // If no original line found, allow the quantity (might be a manual entry)
      return { valid: true, maxQty: 999 };
    }
    
    return {
      valid: quantity <= originalLine.availableQty,
      maxQty: originalLine.availableQty,
    };
  }, [formData.linked_invoice_id, originalInvoiceLines]);

  // Handle new jewelry item created
  const handleJewelryCreated = (item: { id: string; item_code: string; description: string | null }) => {
    refetchJewelry();
    setShowJewelryDialog(false);
  };

  // Generate auto reference for new documents
  const generateReference = async (branchCode?: string) => {
    try {
      if (isReturn) {
        // For returns, include branch code in the reference
        const { data, error } = await dataGateway.rpc('generate_purchase_return_number', {
          p_branch_code: branchCode || null
        });
        if (error) throw error;
        if (data) {
          setFormData(prev => ({ ...prev, reference: data }));
        }
      } else {
        // For purchase invoices
        const { data, error } = await dataGateway.rpc('generate_purchase_invoice_number', {});
        if (error) throw error;
        if (data) {
          setFormData(prev => ({ ...prev, reference: data }));
        }
      }
    } catch (error) {
      console.error('Error generating reference:', error);
      // Fallback
      const prefix = isReturn ? 'PR' : 'PI';
      const today = format(new Date(), 'yyyyMMdd');
      const randomNum = Math.floor(Math.random() * 9000) + 1000;
      const branchPart = branchCode ? `-${branchCode}` : '';
      setFormData(prev => ({ ...prev, reference: `${prefix}${branchPart}-${today}-${randomNum}` }));
    }
  };

  // Fetch existing document if editing, or generate reference and add empty line for new
  useEffect(() => {
    if (isEditing) {
      loadDocument();
    } else {
      generateReference();
      if (!isInitialized && !isReturn) {
        setLines([createEmptyLine(1)]);
        setIsInitialized(true);
      }
    }
  }, [id, isEditing, isInitialized, createEmptyLine, isReturn]);

  const loadDocument = async () => {
    setIsLoading(true);
    try {
      const { data: invoice, error } = await dataGateway.queryTable('invoices', {
        select: '*',
        filters: [{ type: 'eq', column: 'id', value: id }],
        single: true
      });

      if (error) throw error;

      setFormData({
        reference: invoice.invoice_number,
        description: invoice.notes || '',
        supplier_id: invoice.supplier_id || '',
        issue_date: invoice.invoice_date,
        payment_terms: 'cash',
        due_date: invoice.due_date || invoice.invoice_date,
        delivery_date: invoice.invoice_date,
        branch_id: invoice.branch_id || '',
        linked_invoice_id: invoice.linked_invoice_id || '',
        return_reason: '',
        return_type: 'inventory_return',
        notes: invoice.notes || '',
      });

      // Load lines
      const { data: lineData, error: lineError } = await dataGateway.queryTable('purchase_invoice_lines', {
        select: '*',
        filters: [{ type: 'eq', column: 'invoice_id', value: id }],
        order: { column: 'line_number', ascending: true }
      });

      if (lineError) throw lineError;

      if (lineData) {
        setLines(lineData.map(line => ({
          id: line.id,
          line_number: line.line_number,
          item_id: line.product_id,
          item_type: (line.item_type as ItemType) || 'jewelry',
          item_code: line.product_code || '',
          description: line.description || '',
          quantity: line.quantity,
          unit_price: line.unit_price,
          is_inclusive: line.is_inclusive,
          discount_amount: line.discount_amount,
          subtotal: line.subtotal,
          tax_rate: line.tax_rate,
          tax_amount: line.tax_amount,
          total_amount: line.total_amount,
          gl_account_id: line.gl_account_id || null,
          warehouse_account_id: line.warehouse_account_id || null,
          original_quantity: 0,
          returned_quantity: 0,
          available_quantity: 0,
          return_reason: '',
          return_type: 'inventory_return',
          line_notes: '',
          warehouse_id: '',
        })));
      }

      // Set supplier
      if (invoice.supplier_id) {
        const supplier = suppliers.find(s => s.id === invoice.supplier_id);
        if (supplier) setSelectedSupplier(supplier);
      }
    } catch (error) {
      console.error('Error loading document:', error);
      toast.error(t.common.error);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate due date based on payment terms
  const calculateDueDate = useCallback((issueDate: string, paymentTerms: string) => {
    const baseDate = new Date(issueDate);
    switch (paymentTerms) {
      case 'net30':
        return format(addDays(baseDate, 30), 'yyyy-MM-dd');
      case 'net60':
        return format(addDays(baseDate, 60), 'yyyy-MM-dd');
      case 'net90':
        return format(addDays(baseDate, 90), 'yyyy-MM-dd');
      case 'cash':
      default:
        return format(baseDate, 'yyyy-MM-dd');
    }
  }, []);

  // Handle payment terms change
  const handlePaymentTermsChange = (value: string) => {
    const newDueDate = calculateDueDate(formData.issue_date, value);
    setFormData(prev => ({ 
      ...prev, 
      payment_terms: value,
      due_date: newDueDate 
    }));
  };

  // Handle issue date change
  const handleIssueDateChange = (newDate: string) => {
    const newDueDate = calculateDueDate(newDate, formData.payment_terms);
    setFormData(prev => ({ 
      ...prev, 
      issue_date: newDate,
      due_date: newDueDate 
    }));
  };

  // Handle supplier change
  const handleSupplierChange = (supplierId: string) => {
    setFormData(prev => ({ ...prev, supplier_id: supplierId, linked_invoice_id: '' }));
    const supplier = suppliers.find(s => s.id === supplierId);
    setSelectedSupplier(supplier || null);
    // Clear lines when supplier changes for returns
    if (isReturn) {
      setLines([]);
    }
  };

  // Handle supplier created
  const handleSupplierCreated = (supplierId: string) => {
    refetchSuppliers().then(() => {
      handleSupplierChange(supplierId);
    });
  };

  // Add new line (only for purchase invoices, not returns)
  const addLine = useCallback(() => {
    if (isReturn) return; // Don't allow manual add for returns
    setLines(prev => [...prev, createEmptyLine(prev.length + 1)]);
  }, [createEmptyLine, isReturn]);

  // Update line
  const updateLine = (index: number, updatedLine: ReturnLine) => {
    setLines(prev => prev.map((line, i) => i === index ? updatedLine : line));
  };

  // Update line field for return-specific fields
  const updateLineField = (index: number, field: keyof ReturnLine, value: any) => {
    setLines(prev => prev.map((line, i) => {
      if (i === index) {
        if (field === 'quantity') {
          // Recalculate when quantity changes
          const updatedLine = calculateUnifiedLine({
            ...line,
            quantity: value,
          });
          return { ...line, ...updatedLine, quantity: value };
        }
        return { ...line, [field]: value };
      }
      return line;
    }));
  };

  // Delete line - ensure at least one line remains for invoices
  const deleteLine = useCallback((index: number) => {
    setLines(prev => {
      const newLines = prev.filter((_, i) => i !== index);
      if (!isReturn && newLines.length === 0) {
        return [createEmptyLine(1)];
      }
      return newLines.map((line, i) => ({ ...line, line_number: i + 1 }));
    });
  }, [createEmptyLine, isReturn]);

  // Calculate totals (only from lines with quantity > 0)
  const totals = useMemo(() => {
    const activeLines = lines.filter(l => l.quantity > 0);
    return {
      subtotal: activeLines.reduce((sum, l) => sum + (l.subtotal || 0), 0),
      taxAmount: activeLines.reduce((sum, l) => sum + (l.tax_amount || 0), 0),
      total: activeLines.reduce((sum, l) => sum + (l.total_amount || 0), 0),
      itemCount: activeLines.length,
    };
  }, [lines]);

  // Save document using purchasingWriteService
  const handleSave = async (closeAfterSave: boolean = false) => {
    if (viewMode) return;
    
    if (!formData.reference.trim()) {
      toast.error(t.purchaseInvoices.referenceRequired);
      return;
    }
    if (!formData.supplier_id) {
      toast.error(t.purchaseInvoices.supplierRequired);
      return;
    }
    if (!formData.branch_id) {
      toast.error(t.purchaseInvoices.locationRequired);
      return;
    }

    // For returns, original invoice is required
    if (isReturn && !formData.linked_invoice_id) {
      toast.error(language === 'ar' ? 'يجب اختيار فاتورة المشتريات الأصلية' : 'Original purchase invoice is required');
      return;
    }

    // Filter lines with quantity > 0
    const activeLines = lines.filter(l => l.quantity > 0);
    
    if (activeLines.length === 0) {
      toast.error(isReturn 
        ? (language === 'ar' ? 'يجب إدخال كمية مرتجعة لبند واحد على الأقل' : 'At least one item must have a return quantity')
        : t.purchaseInvoices.linesRequired);
      return;
    }

    // For non-returns, validate item selection
    if (!isReturn) {
      const linesWithoutItem = activeLines.filter(line => !line.item_id);
      if (linesWithoutItem.length > 0) {
        toast.error(language === 'ar' ? 'يجب اختيار صنف لجميع السطور' : 'All lines must have an item selected');
        return;
      }
    }

    // Validate return quantities and reasons against original invoice
    if (isReturn && formData.linked_invoice_id) {
      for (const line of activeLines) {
        // Validate quantity using both item_id and item_code for accurate matching
        const validation = validateReturnQuantity(line.item_id || '', line.quantity, line.item_code);
        if (!validation.valid) {
          toast.error(
            language === 'ar' 
              ? `الكمية المرتجعة (${line.quantity}) أكبر من المتاح للإرجاع (${validation.maxQty}) للصنف: ${line.item_code}`
              : `Return quantity (${line.quantity}) exceeds available (${validation.maxQty}) for item: ${line.item_code}`
          );
          return;
        }
        
        // Validate return reason is selected for each line
        if (!line.return_reason) {
          toast.error(
            language === 'ar'
              ? `يجب تحديد سبب المرتجع للصنف: ${line.item_code}`
              : `Return reason is required for item: ${line.item_code}`
          );
          return;
        }
      }
    }

    setIsSaving(true);
    try {
      // Check for duplicate reference (across all suppliers for this type) - READ only
      const { data: existingDocs, error: checkError } = await dataGateway.queryTable('invoices', {
        select: 'id',
        filters: [
          { type: 'eq', column: 'invoice_number', value: formData.reference },
          { type: 'eq', column: 'invoice_type', value: config.invoiceType },
          { type: 'neq', column: 'id', value: id || '00000000-0000-0000-0000-000000000000' }
        ]
      });

      if (checkError) throw checkError;

      // If duplicate found, auto-regenerate and retry
      if (existingDocs && existingDocs.length > 0) {
        console.log('Duplicate reference found, regenerating...');
        
        // Get branch code for the selected branch
        const selectedBranch = branches.find(b => b.id === formData.branch_id);
        const branchCode = selectedBranch?.branch_code || null;
        
        let newRef: string | null = null;
        let rpcError = null;
        
        if (isReturn) {
          const result = await dataGateway.rpc('generate_purchase_return_number', { p_branch_code: branchCode });
          newRef = result.data;
          rpcError = result.error;
        } else {
          const result = await dataGateway.rpc('generate_purchase_invoice_number', {});
          newRef = result.data;
          rpcError = result.error;
        }
        
        if (!rpcError && newRef && newRef !== formData.reference) {
          setFormData(prev => ({ ...prev, reference: newRef! }));
          toast.info(language === 'ar' 
            ? `تم توليد رقم جديد تلقائياً: ${newRef}` 
            : `New reference generated: ${newRef}`);
          // Retry save with new reference after state update
          setIsSaving(false);
          setTimeout(() => handleSave(closeAfterSave), 100);
          return;
        } else {
          toast.error(t.purchaseInvoices.duplicateReference);
          setIsSaving(false);
          return;
        }
      }

      let documentId: string | undefined = id;
      let documentNumber: string = formData.reference;

      // Route writes through purchasingWriteService based on document type and mode
      if (isReturn) {
        // Determine return type: unique (jewelry) vs general (product/cost)
        const hasJewelryItems = activeLines.some(l => l.item_type === 'jewelry' && l.item_id);
        const hasNonJewelryItems = activeLines.some(l => l.item_type !== 'jewelry');

        // PR-2: Generate idempotency key per submission
        if (!clientRequestIdRef.current) {
          clientRequestIdRef.current = crypto.randomUUID();
        }

        if (hasJewelryItems && !hasNonJewelryItems) {
          // Unique return (jewelry items only) - ATOMIC
          const atomicCmd: AtomicCreatePurchaseReturnUniqueCommand = {
            client_request_id: clientRequestIdRef.current,
            created_by: user?.email || '',
            return: {
              branch_id: formData.branch_id,
              purchase_invoice_id: formData.linked_invoice_id || '',
              return_date: formData.issue_date,
              reason: formData.return_reason,
              notes: formData.notes,
            },
            items: activeLines
              .filter(l => l.item_type === 'jewelry' && l.item_id)
              .map(l => ({
                item_id: l.item_id!,
                item_code: l.item_code || '',
                description: l.description || '',
                unit_price: l.unit_price,
                tax_rate: l.tax_rate || 0, // PERCENT (15) - NO division, RPC handles conversion
                gold_weight: 0,
                reason: l.return_reason,
              })),
          };

          const result = await createPurchaseReturnUniqueAtomic(atomicCmd);
          if (!result.success) {
            throw new Error(result.error || 'Failed to create unique return');
          }
          documentId = result.returnId;
          documentNumber = result.returnNumber || formData.reference;
          // Reset idempotency key on success
          clientRequestIdRef.current = null;
        } else {
          // General return (product/cost lines) - ATOMIC
          const atomicCmd: AtomicCreatePurchaseReturnGeneralCommand = {
            client_request_id: clientRequestIdRef.current,
            created_by: user?.email || '',
            return: {
              branch_id: formData.branch_id,
              purchase_invoice_id: formData.linked_invoice_id || '',
              return_date: formData.issue_date,
              reason: formData.return_reason,
              notes: formData.notes,
            },
            items: activeLines.map(l => ({
              invoice_line_id: l.id || '',
              item_id: l.item_id || undefined,
              item_code: l.item_code || '',
              description: l.description || '',
              item_type: (l.item_type === 'jewelry' ? 'product' : l.item_type || 'product') as 'product' | 'cost' | 'service',
              qty: l.quantity,
              unit_price: l.unit_price,
              tax_rate: l.tax_rate || 0, // PERCENT (15) - NO division, RPC handles conversion
              reason: l.return_reason,
            })),
          };

          const result = await createPurchaseReturnGeneralAtomic(atomicCmd);
          if (!result.success) {
            throw new Error(result.error || 'Failed to create general return');
          }
          documentId = result.returnId;
          documentNumber = result.returnNumber || formData.reference;
          // Reset idempotency key on success
          clientRequestIdRef.current = null;
        }
      } else {
        // Purchase Invoice - create or block update
        if (isEditing && id) {
          // PI-1: Update is disabled - show message and redirect user to void + recreate flow
          toast.error(
            language === 'ar' 
              ? 'تم إغلاق تعديل فاتورة المشتريات مؤقتًا حتى إطلاق تحديث Atomic (PI-2). استخدم إلغاء + إعادة إنشاء.'
              : 'Purchase invoice editing is temporarily disabled pending Atomic PI-2 update. Use cancel + recreate workflow.'
          );
          setIsSaving(false);
          return;
        } else {
          // Create new invoice via atomic RPC
          // Generate stable request ID for idempotency
          const clientRequestId = crypto.randomUUID();
          
          const cmd: AtomicCreatePurchaseInvoiceCommand = {
            client_request_id: clientRequestId,
            created_by: user?.email || 'system',
            invoice: {
              supplier_id: formData.supplier_id,
              branch_id: formData.branch_id || undefined,
              invoice_date: formData.issue_date,
              due_date: formData.due_date,
              notes: formData.notes || undefined,
              invoice_type: 'general',
            },
            items: activeLines.map((l) => ({
              item_id: l.item_id || undefined,
              item_code: l.item_code || undefined,
              description: l.description || '',
              qty: l.quantity,
              unit_cost: l.unit_price,
              tax_rate: l.tax_rate / 100, // Convert percentage to decimal
              discount_amount: l.discount_amount || 0,
              item_type: (l.item_type || 'jewelry') as 'jewelry' | 'product' | 'cost' | 'service' | 'imported_piece',
              gl_account_id: l.gl_account_id || undefined,
              cost_entry_id: undefined,
              warehouse_id: formData.branch_id || undefined,
            })),
          };

          const result = await createPurchaseInvoiceAtomic(cmd);
          if (!result.success) {
            if (result.error_code === 'IDEMPOTENCY_CONFLICT') {
              throw new Error(language === 'ar' ? 'طلب متعارض - حاول مرة أخرى' : 'Conflicting request - please try again');
            }
            throw new Error(result.error || 'Failed to create invoice');
          }
          documentId = result.invoiceId;
          documentNumber = result.invoiceNumber || formData.reference;
        }
      }

      toast.success(t.common.success);
      
      const listPath = isReturn ? '/purchasing/returns-hub' : '/purchasing/invoices';
      if (closeAfterSave) {
        navigate(listPath);
      } else if (!isEditing && documentId) {
        const editPath = isReturn ? `/purchasing/returns-hub/r/${documentId}` : `/purchasing/invoices/${documentId}`;
        navigate(editPath, { replace: true });
      }
    } catch (error: unknown) {
      console.error('Error saving document:', error);
      const errorMessage = error instanceof Error ? error.message : '';
      toast.error(
        language === 'ar'
          ? `حدث خطأ أثناء الحفظ: ${errorMessage}`
          : `Error while saving: ${errorMessage}`
      );
    } finally {
      setIsSaving(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2
    });
  };

  // Get page title based on document type
  const getPageTitle = () => {
    if (isReturn) {
      return isEditing 
        ? (language === 'ar' ? 'تعديل مرتجع مشتريات' : 'Edit Purchase Return')
        : (language === 'ar' ? 'مرتجع مشتريات جديد' : 'New Purchase Return');
    }
    return isEditing ? t.purchaseInvoices.edit : t.purchaseInvoices.createNew;
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="page-header-rtl">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(isReturn ? '/purchasing/returns' : '/purchasing/invoices')}>
              <ArrowLeft className="w-5 h-5 icon-flip-rtl" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                {isReturn && <RotateCcw className="w-6 h-6 text-orange-500" />}
                {getPageTitle()}
              </h1>
              <p className="text-muted-foreground">
                {t.nav.purchases} / {isReturn 
                  ? (language === 'ar' ? 'مرتجعات المشتريات' : 'Purchase Returns')
                  : t.purchaseInvoices.title}
              </p>
            </div>
          </div>
        </div>

        {/* Return Workflow Info */}
        {isReturn && !formData.linked_invoice_id && (
          <Alert>
            <FileText className="h-4 w-4" />
            <AlertTitle>{language === 'ar' ? 'خطوات إنشاء المرتجع' : 'Return Creation Steps'}</AlertTitle>
            <AlertDescription>
              {language === 'ar' 
                ? '1. اختر المورد أولاً - 2. اختر فاتورة المشتريات الأصلية - 3. حدد الكميات المراد إرجاعها'
                : '1. Select supplier first - 2. Choose original purchase invoice - 3. Enter return quantities'}
            </AlertDescription>
          </Alert>
        )}

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Supplier Details Card (Left) */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                {t.purchaseInvoices.supplierDetails}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedSupplier ? (
                <>
                  <div>
                    <Label className="text-muted-foreground text-xs">{t.common.name}</Label>
                    <p className="font-medium">{selectedSupplier.supplier_name}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">{t.common.phone}</Label>
                    <p dir="ltr" className="text-start">{selectedSupplier.phone || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">{t.common.email}</Label>
                    <p dir="ltr" className="text-start">{selectedSupplier.email || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">{t.purchaseInvoices.vatNumber}</Label>
                    <p dir="ltr" className="text-start">{selectedSupplier.vat_number || '-'}</p>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {t.purchaseInvoices.selectSupplierFirst}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Document Header Fields (Right) */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">
                {isReturn 
                  ? (language === 'ar' ? 'تفاصيل المرتجع' : 'Return Details')
                  : t.purchaseInvoices.invoiceDetails}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t.purchaseInvoices.reference} *</Label>
                  <Input
                    value={formData.reference}
                    onChange={(e) => setFormData(prev => ({ ...prev, reference: e.target.value }))}
                    placeholder={isReturn ? "PR-RET-YYYYMMDD-0001" : "PI-YYYYMMDD-0001"}
                    readOnly={viewMode || !isEditing}
                    className={(viewMode || !isEditing) ? 'bg-muted' : ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t.purchaseInvoices.supplier} *</Label>
                  <div className="flex gap-2">
                    <Select value={formData.supplier_id} onValueChange={handleSupplierChange} disabled={viewMode}>
                      <SelectTrigger className={`flex-1 ${viewMode ? 'bg-muted' : ''}`}>
                        <SelectValue placeholder={t.purchaseInvoices.selectSupplier} />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map(supplier => (
                          <SelectItem key={supplier.id} value={supplier.id}>
                            {supplier.supplier_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!viewMode && (
                      <Button variant="outline" size="icon" onClick={() => setShowSupplierDialog(true)}>
                        <Plus className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
                
                {/* Linked Invoice (for returns - REQUIRED) */}
                {isReturn && (
                  <div className="space-y-2 md:col-span-2">
                    <Label className="flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      {language === 'ar' ? 'فاتورة المشتريات الأصلية' : 'Original Purchase Invoice'} *
                    </Label>
                    <Select 
                      value={formData.linked_invoice_id} 
                      onValueChange={(value) => setFormData(prev => ({ ...prev, linked_invoice_id: value }))}
                      disabled={viewMode || !formData.supplier_id}
                    >
                      <SelectTrigger className={viewMode ? 'bg-muted' : ''}>
                        <SelectValue placeholder={
                          !formData.supplier_id 
                            ? (language === 'ar' ? 'اختر المورد أولاً' : 'Select supplier first')
                            : (language === 'ar' ? 'اختر الفاتورة الأصلية' : 'Select original invoice')
                        } />
                      </SelectTrigger>
                      <SelectContent>
                        {originalInvoices.map(inv => (
                          <SelectItem key={inv.id} value={inv.id}>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{inv.invoice_number}</span>
                              <span className="text-muted-foreground">-</span>
                              <span>{format(new Date(inv.invoice_date), 'yyyy/MM/dd')}</span>
                              <span className="text-muted-foreground">-</span>
                              <span className="font-medium text-primary">{formatCurrency(inv.total_amount)}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formData.supplier_id && originalInvoices.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        {language === 'ar' ? 'لا توجد فواتير مشتريات لهذا المورد' : 'No purchase invoices found for this supplier'}
                      </p>
                    )}
                  </div>
                )}

                {/* Original Invoice Summary - Enhanced */}
                {isReturn && selectedOriginalInvoice && (
                  <div className="md:col-span-2 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <Package className="w-4 h-4 text-blue-600" />
                      {language === 'ar' ? 'ملخص الفاتورة الأصلية' : 'Original Invoice Summary'}
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">{language === 'ar' ? 'رقم الفاتورة:' : 'Invoice #:'}</span>
                        <p className="font-bold text-primary">{selectedOriginalInvoice.invoice_number}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{language === 'ar' ? 'التاريخ:' : 'Date:'}</span>
                        <p className="font-medium">{format(new Date(selectedOriginalInvoice.invoice_date), 'yyyy/MM/dd')}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{language === 'ar' ? 'إجمالي الفاتورة:' : 'Invoice Total:'}</span>
                        <p className="font-bold">{formatCurrency(selectedOriginalInvoice.total_amount)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{language === 'ar' ? 'الضريبة:' : 'VAT:'}</span>
                        <p className="font-medium">{formatCurrency(selectedOriginalInvoice.tax_amount)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{language === 'ar' ? 'المرتجع سابقاً:' : 'Previously Returned:'}</span>
                        <p className="font-bold text-orange-600">{formatCurrency(previousReturnsTotal)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{language === 'ar' ? 'المتاح للإرجاع:' : 'Available for Return:'}</span>
                        <p className="font-bold text-green-600">{formatCurrency(availableForReturnTotal)}</p>
                      </div>
                    </div>
                    {availableForReturnTotal <= 0 && (
                      <Alert variant="destructive" className="mt-3">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          {language === 'ar' 
                            ? 'تم إرجاع جميع بنود هذه الفاتورة - لا يمكن إنشاء مرتجع جديد'
                            : 'All items from this invoice have been returned - cannot create new return'}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>{isReturn ? (language === 'ar' ? 'تاريخ المرتجع' : 'Return Date') : t.purchaseInvoices.issueDate} *</Label>
                  <Input
                    type="date"
                    value={formData.issue_date}
                    onChange={(e) => handleIssueDateChange(e.target.value)}
                    readOnly={viewMode}
                    className={viewMode ? 'bg-muted' : ''}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>{t.purchaseInvoices.location} *</Label>
                  <Select 
                    value={formData.branch_id} 
                    onValueChange={(value) => {
                      setFormData(prev => ({ ...prev, branch_id: value }));
                      // Regenerate reference with branch code for returns
                      if (isReturn && !isEditing) {
                        const selectedBranch = branches.find(b => b.id === value);
                        if (selectedBranch) {
                          generateReference(selectedBranch.branch_code);
                        }
                      }
                    }}
                    disabled={viewMode}
                  >
                    <SelectTrigger className={viewMode ? 'bg-muted' : ''}>
                      <SelectValue placeholder={t.purchaseInvoices.selectLocation} />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map(branch => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.branch_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Return Reason - for returns only */}
                {isReturn && (
                  <>
                    <div className="space-y-2">
                      <Label>{language === 'ar' ? 'سبب المرتجع' : 'Return Reason'}</Label>
                      <Select 
                        value={formData.return_reason} 
                        onValueChange={(value) => setFormData(prev => ({ ...prev, return_reason: value }))}
                        disabled={viewMode}
                      >
                        <SelectTrigger className={viewMode ? 'bg-muted' : ''}>
                          <SelectValue placeholder={language === 'ar' ? 'اختر السبب' : 'Select reason'} />
                        </SelectTrigger>
                        <SelectContent>
                          {RETURN_REASONS.map(reason => (
                            <SelectItem key={reason.value} value={reason.value}>
                              {language === 'ar' ? reason.labelAr : reason.labelEn}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{language === 'ar' ? 'نوع المرتجع' : 'Return Type'}</Label>
                      <Select 
                        value={formData.return_type} 
                        onValueChange={(value) => setFormData(prev => ({ ...prev, return_type: value }))}
                        disabled={viewMode}
                      >
                        <SelectTrigger className={viewMode ? 'bg-muted' : ''}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RETURN_TYPES.map(type => (
                            <SelectItem key={type.value} value={type.value}>
                              {language === 'ar' ? type.labelAr : type.labelEn}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                {!isReturn && (
                  <>
                    <div className="space-y-2">
                      <Label>{t.purchaseInvoices.paymentTerms}</Label>
                      <Select 
                        value={formData.payment_terms} 
                        onValueChange={handlePaymentTermsChange}
                        disabled={viewMode}
                      >
                        <SelectTrigger className={viewMode ? 'bg-muted' : ''}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">{t.purchaseInvoices.cash}</SelectItem>
                          <SelectItem value="net30">{t.purchaseInvoices.net30}</SelectItem>
                          <SelectItem value="net60">{t.purchaseInvoices.net60}</SelectItem>
                          <SelectItem value="net90">{t.purchaseInvoices.net90}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t.purchaseInvoices.dueDate}</Label>
                      <Input
                        type="date"
                        value={formData.due_date}
                        onChange={(e) => setFormData(prev => ({ ...prev, due_date: e.target.value }))}
                        readOnly={viewMode}
                        className={viewMode ? 'bg-muted' : ''}
                      />
                    </div>
                  </>
                )}

                {/* Notes */}
                <div className="space-y-2 md:col-span-2">
                  <Label>{language === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder={isReturn 
                      ? (language === 'ar' ? 'ملاحظات على المرتجع...' : 'Return notes...')
                      : (language === 'ar' ? 'ملاحظات على الفاتورة...' : 'Invoice notes...')}
                    readOnly={viewMode}
                    rows={2}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Lines Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">
              {isReturn 
                ? (language === 'ar' ? 'بنود المرتجع' : 'Return Items')
                : t.purchaseInvoices.invoiceLines}
            </CardTitle>
            {!viewMode && !isReturn && (
              <Button onClick={addLine} size="sm" className="gap-2">
                <Plus className="w-4 h-4" />
                {t.purchaseInvoices.addLine}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {/* Return Lines Table - Enhanced for returns */}
            {isReturn && formData.linked_invoice_id && lines.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-center">#</TableHead>
                      <TableHead>{language === 'ar' ? 'كود الصنف' : 'Item Code'}</TableHead>
                      <TableHead>{language === 'ar' ? 'الوصف' : 'Description'}</TableHead>
                      <TableHead className="text-center">{language === 'ar' ? 'الكمية الأصلية' : 'Original Qty'}</TableHead>
                      <TableHead className="text-center text-orange-600">{language === 'ar' ? 'تم إرجاعه' : 'Returned'}</TableHead>
                      <TableHead className="text-center text-green-600">{language === 'ar' ? 'المتاح' : 'Available'}</TableHead>
                      <TableHead className="text-center w-24">{language === 'ar' ? 'كمية المرتجع' : 'Return Qty'}</TableHead>
                      <TableHead className="text-center">{language === 'ar' ? 'سعر الوحدة' : 'Unit Price'}</TableHead>
                      <TableHead className="text-center">{language === 'ar' ? 'الضريبة %' : 'Tax %'}</TableHead>
                      <TableHead className="text-center">{language === 'ar' ? 'قيمة الضريبة' : 'Tax Amount'}</TableHead>
                      <TableHead className="text-center">{language === 'ar' ? 'الإجمالي' : 'Total'}</TableHead>
                      <TableHead className="w-32">{language === 'ar' ? 'سبب المرتجع' : 'Reason'} *</TableHead>
                      <TableHead className="w-36">{language === 'ar' ? 'ملاحظات' : 'Notes'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line, index) => {
                      const isOverLimit = line.quantity > line.available_quantity;
                      return (
                        <TableRow key={line.id} className={isOverLimit ? 'bg-destructive/10' : ''}>
                          <TableCell className="text-center font-medium">{line.line_number}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{line.item_code}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">{line.description}</TableCell>
                          <TableCell className="text-center">{line.original_quantity}</TableCell>
                          <TableCell className="text-center text-orange-600 font-medium">{line.returned_quantity}</TableCell>
                          <TableCell className="text-center text-green-600 font-medium">{line.available_quantity}</TableCell>
                          <TableCell className="text-center">
                            {viewMode ? (
                              <span className="font-medium">{line.quantity}</span>
                            ) : (
                              <Input
                                type="number"
                                min="0"
                                max={line.available_quantity}
                                value={line.quantity}
                                onChange={(e) => updateLineField(index, 'quantity', parseFloat(e.target.value) || 0)}
                                className={`w-20 text-center ${isOverLimit ? 'border-destructive bg-destructive/10' : ''}`}
                              />
                            )}
                            {isOverLimit && (
                              <div className="flex items-center gap-1 text-xs text-destructive mt-1">
                                <AlertTriangle className="w-3 h-3" />
                                {language === 'ar' ? 'تجاوز الحد' : 'Over limit'}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-center" dir="ltr">{formatCurrency(line.unit_price)}</TableCell>
                          <TableCell className="text-center">{line.tax_rate}%</TableCell>
                          <TableCell className="text-center" dir="ltr">{formatCurrency(line.tax_amount)}</TableCell>
                          <TableCell className="text-center font-medium" dir="ltr">{formatCurrency(line.total_amount)}</TableCell>
                          <TableCell>
                            {viewMode ? (
                              <span className="text-sm">{
                                RETURN_REASONS.find(r => r.value === line.return_reason)?.[language === 'ar' ? 'labelAr' : 'labelEn'] || '-'
                              }</span>
                            ) : (
                              <Select 
                                value={line.return_reason || ''} 
                                onValueChange={(value) => updateLineField(index, 'return_reason', value)}
                              >
                                <SelectTrigger className="w-28">
                                  <SelectValue placeholder="-" />
                                </SelectTrigger>
                                <SelectContent>
                                  {RETURN_REASONS.map(reason => (
                                    <SelectItem key={reason.value} value={reason.value}>
                                      {language === 'ar' ? reason.labelAr : reason.labelEn}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell>
                            {viewMode ? (
                              <span className="text-sm text-muted-foreground">{line.line_notes || '-'}</span>
                            ) : (
                              <Input
                                value={line.line_notes || ''}
                                onChange={(e) => updateLineField(index, 'line_notes', e.target.value)}
                                placeholder={language === 'ar' ? 'ملاحظات...' : 'Notes...'}
                                className="w-32 text-sm"
                              />
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Return placeholder when no invoice selected */}
            {isReturn && !formData.linked_invoice_id && (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">
                  {language === 'ar' ? 'اختر فاتورة المشتريات الأصلية لعرض البنود' : 'Select original purchase invoice to view items'}
                </p>
                <p className="text-sm mt-2">
                  {language === 'ar' ? 'سيتم عرض جميع بنود الفاتورة مع الكميات المتاحة للإرجاع' : 'All invoice items will be displayed with available return quantities'}
                </p>
              </div>
            )}

            {/* Standard Invoice Lines Table */}
            {!isReturn && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px]">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-2 text-center w-12">#</th>
                      <th className="p-2 text-start">{t.purchaseInvoices.product}</th>
                      <th className="p-2 text-start">{t.common.description}</th>
                      <th className="p-2 text-center">{t.common.quantity}</th>
                      <th className="p-2 text-center">{t.purchaseInvoices.unitPrice}</th>
                      <th className="p-2 text-center">{t.purchaseInvoices.inclusive}</th>
                      <th className="p-2 text-center">{t.purchaseInvoices.discount}</th>
                      <th className="p-2 text-center">{t.purchaseInvoices.subtotal}</th>
                      <th className="p-2 text-center">{t.purchaseInvoices.taxRate}</th>
                      <th className="p-2 text-center">{t.purchaseInvoices.taxAmount}</th>
                      <th className="p-2 text-center">{t.purchaseInvoices.lineTotal}</th>
                      {!viewMode && <th className="p-2 w-12"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => (
                      viewMode ? (
                        <tr key={line.id} className="border-b">
                          <td className="p-2 text-center">{line.line_number}</td>
                          <td className="p-2">{line.item_code}</td>
                          <td className="p-2">{line.description}</td>
                          <td className="p-2 text-center">{line.quantity}</td>
                          <td className="p-2 text-center" dir="ltr">{formatCurrency(line.unit_price)}</td>
                          <td className="p-2 text-center">{line.is_inclusive ? '✓' : '-'}</td>
                          <td className="p-2 text-center" dir="ltr">{formatCurrency(line.discount_amount)}</td>
                          <td className="p-2 text-center" dir="ltr">{formatCurrency(line.subtotal)}</td>
                          <td className="p-2 text-center">{line.tax_rate}%</td>
                          <td className="p-2 text-center" dir="ltr">{formatCurrency(line.tax_amount)}</td>
                          <td className="p-2 text-center font-medium" dir="ltr">{formatCurrency(line.total_amount)}</td>
                        </tr>
                      ) : (
                        <UnifiedInvoiceLineRow
                          key={line.id}
                          line={line}
                          jewelryItems={jewelryItems}
                          costEntries={costEntries}
                          products={products}
                          onUpdate={(updatedLine) => updateLine(index, { ...lines[index], ...updatedLine })}
                          onDelete={() => deleteLine(index)}
                          onAddNewJewelry={() => setShowJewelryDialog(true)}
                        />
                      )
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Totals */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-end">
              <div className="w-full max-w-sm space-y-3">
                {isReturn && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{language === 'ar' ? 'عدد البنود المرتجعة:' : 'Items to return:'}</span>
                    <span className="font-medium">{totals.itemCount}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.purchaseInvoices.subtotalBeforeTax}</span>
                  <span className="font-medium" dir="ltr">{formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.purchaseInvoices.totalTax}</span>
                  <span className="font-medium" dir="ltr">{formatCurrency(totals.taxAmount)}</span>
                </div>
                <div className="flex justify-between border-t pt-3">
                  <span className="font-bold text-lg">{t.purchaseInvoices.grandTotal}</span>
                  <span className={`font-bold text-lg ${isReturn ? 'text-orange-500' : 'text-primary'}`} dir="ltr">
                    {isReturn ? '-' : ''}{formatCurrency(totals.total)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => navigate(isReturn ? '/purchasing/returns' : '/purchasing/invoices')}>
            {viewMode ? t.common.back : t.common.cancel}
          </Button>
          {viewMode ? (
            <Button onClick={() => navigate(isReturn ? `/purchasing/returns/${id}` : `/purchasing/invoices/${id}`)} className="gap-2">
              <Save className="w-4 h-4" />
              {t.common.edit}
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => handleSave(false)} disabled={isSaving} className="gap-2">
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                <Save className="w-4 h-4" />
                {t.common.save}
              </Button>
              <Button onClick={() => handleSave(true)} disabled={isSaving} className="gap-2">
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                <SaveAll className="w-4 h-4" />
                {t.purchaseInvoices.saveAndClose}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <QuickSupplierDialog
        open={showSupplierDialog}
        onOpenChange={setShowSupplierDialog}
        onSupplierCreated={handleSupplierCreated}
      />
      <JewelryItemFormDialog
        open={showJewelryDialog}
        onOpenChange={setShowJewelryDialog}
        onSuccess={handleJewelryCreated}
        context="purchase-invoice"
      />
    </MainLayout>
  );
};

export default UnifiedPurchaseDocumentPage;
