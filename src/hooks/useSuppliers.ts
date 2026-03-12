import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Supplier, SupplierFormData } from '@/types/supplier.types';
import * as dataGateway from '@/lib/dataGateway';

interface SupplierFilters {
  search?: string;
  country?: string;
  status?: string;
  balanceType?: 'debit' | 'credit' | 'zero' | 'all';
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

export function useSuppliers(filters: SupplierFilters = {}) {
  const { 
    search, 
    country, 
    status, 
    page = 1, 
    pageSize = 20,
  } = filters;

  return useQuery({
    queryKey: ['suppliers', filters],
    queryFn: async () => {
      const { data, error } = await dataGateway.fetchSuppliers();

      if (error) throw new Error(error.message);

      let suppliers = (data || []) as any[];

      if (search) {
        const searchLower = search.toLowerCase();
        suppliers = suppliers.filter(s => 
          s.name?.toLowerCase().includes(searchLower) ||
          s.supplier_code?.toLowerCase().includes(searchLower) ||
          s.phone?.toLowerCase().includes(searchLower) ||
          s.tax_number?.toLowerCase().includes(searchLower) ||
          s.email?.toLowerCase().includes(searchLower)
        );
      }

      if (country && country !== 'all') {
        suppliers = suppliers.filter(s => s.address === country);
      }

      if (status && status !== 'all') {
        suppliers = suppliers.filter(s => s.is_active === (status === 'active'));
      }

      const totalCount = suppliers.length;
      const from = (page - 1) * pageSize;
      const paged = suppliers.slice(from, from + pageSize);

      const mappedSuppliers = paged.map((s: any) => ({
        ...s,
        supplier_name: s.name,
        supplier_code: s.supplier_code || '',
        supplier_type: 'company' as const,
        business_type: 'products' as const,
        country: 'السعودية',
        address: s.address || '',
        mobile_phone: s.phone || '',
        phone: s.phone || '',
        vat_number: s.tax_number || '',
        status: s.is_active ? 'active' : 'suspended',
        default_currency: 'SAR',
        payment_terms: 'net_30' as const,
        credit_limit: 0,
        opening_balance: 0,
        current_balance: 0,
        default_payment_method: 'cash' as const,
      })) as Supplier[];

      return {
        suppliers: mappedSuppliers,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      };
    },
  });
}

export function useSupplier(id: string | null) {
  return useQuery({
    queryKey: ['supplier', id],
    queryFn: async () => {
      if (!id) return null;
      
      const { data, error } = await dataGateway.fetchTable('suppliers', {
        filters: { id },
        single: true
      });

      if (error) throw new Error(error.message);
      if (!data) return null;
      
      const s = data as any;
      return {
        ...s,
        supplier_name: s.name,
        supplier_code: s.supplier_code || '',
        supplier_type: 'company' as const,
        business_type: 'products' as const,
        country: 'السعودية',
        address: s.address || '',
        mobile_phone: s.phone || '',
        phone: s.phone || '',
        vat_number: s.tax_number || '',
        status: s.is_active ? 'active' : 'suspended',
        default_currency: 'SAR',
        payment_terms: 'net_30' as const,
        credit_limit: 0,
        opening_balance: 0,
        current_balance: 0,
        default_payment_method: 'cash' as const,
      } as Supplier;
    },
    enabled: !!id,
  });
}

export function useSupplierMutations() {
  const queryClient = useQueryClient();

  const createSupplier = useMutation({
    mutationFn: async (data: SupplierFormData) => {
      const clientRequestId = crypto.randomUUID();

      const { data: result, error } = await dataGateway.rpc('supplier_create_atomic', {
        p_client_request_id: clientRequestId,
        p_name: data.supplier_name,
        p_name_en: data.supplier_name,
        p_phone: data.mobile_phone || data.office_phone || null,
        p_email: data.email || null,
        p_address: data.country || null,
        p_tax_number: data.vat_number || null,
        p_contact_person: data.contact_person || null,
      });

      if (error) {
        console.error('[createSupplier] RPC error:', error);
        throw new Error(error.message);
      }

      const rpcResult = result as { success: boolean; error?: string; supplier_id?: string; supplier_code?: string };
      
      if (!rpcResult.success) {
        throw new Error(rpcResult.error || 'فشل في إنشاء المورد');
      }

      return {
        id: rpcResult.supplier_id,
        supplier_code: rpcResult.supplier_code,
      };
    },
    onSuccess: () => {
      toast.success('تم إضافة المورد بنجاح');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'فشل في إضافة المورد');
    },
  });

  const updateSupplier = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<SupplierFormData>; oldData?: Supplier }) => {
      const clientRequestId = crypto.randomUUID();

      const { data: result, error } = await dataGateway.rpc('supplier_update_atomic', {
        p_client_request_id: clientRequestId,
        p_supplier_id: id,
        p_name: data.supplier_name || null,
        p_name_en: data.supplier_name || null,
        p_phone: data.mobile_phone || data.office_phone || null,
        p_email: data.email || null,
        p_address: data.country || null,
        p_tax_number: data.vat_number || null,
        p_contact_person: data.contact_person || null,
      });

      if (error) {
        console.error('[updateSupplier] RPC error:', error);
        throw new Error(error.message);
      }

      const rpcResult = result as { success: boolean; error?: string; supplier_id?: string };
      
      if (!rpcResult.success) {
        throw new Error(rpcResult.error || 'فشل في تحديث المورد');
      }

      return { id: rpcResult.supplier_id };
    },
    onSuccess: () => {
      toast.success('تم تحديث المورد بنجاح');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['supplier'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'فشل في تحديث المورد');
    },
  });

  const deleteSupplier = useMutation({
    mutationFn: async (supplier: Supplier) => {
      const clientRequestId = crypto.randomUUID();

      const { data: result, error } = await dataGateway.rpc('supplier_archive_atomic', {
        p_client_request_id: clientRequestId,
        p_supplier_id: supplier.id,
        p_reason: 'حذف بواسطة المستخدم',
      });

      if (error) {
        console.error('[deleteSupplier] RPC error:', error);
        throw new Error(error.message);
      }

      const rpcResult = result as { success: boolean; error?: string; supplier_id?: string };
      
      if (!rpcResult.success) {
        throw new Error(rpcResult.error || 'فشل في حذف المورد');
      }

      return { id: rpcResult.supplier_id };
    },
    onSuccess: () => {
      toast.success('تم أرشفة المورد بنجاح');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'فشل في حذف المورد');
    },
  });

  const suspendSupplier = useMutation({
    mutationFn: async ({ supplier, reason }: { supplier: Supplier; reason?: string }) => {
      const clientRequestId = crypto.randomUUID();

      const { data: result, error } = await dataGateway.rpc('supplier_toggle_status_atomic', {
        p_client_request_id: clientRequestId,
        p_supplier_id: supplier.id,
        p_reason: reason || null,
      });

      if (error) {
        console.error('[suspendSupplier] RPC error:', error);
        throw new Error(error.message);
      }

      const rpcResult = result as { success: boolean; error?: string; supplier_id?: string; new_status?: string };
      
      if (!rpcResult.success) {
        throw new Error(rpcResult.error || 'فشل في تغيير حالة المورد');
      }

      return { 
        id: rpcResult.supplier_id,
        status: rpcResult.new_status,
      };
    },
    onSuccess: (data) => {
      toast.success(data.status === 'suspended' ? 'تم إيقاف المورد' : 'تم تفعيل المورد');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'فشل في تغيير حالة المورد');
    },
  });

  return {
    createSupplier,
    updateSupplier,
    deleteSupplier,
    suspendSupplier,
  };
}

export function useSupplierStats() {
  return useQuery({
    queryKey: ['supplier-stats'],
    queryFn: async () => {
      const [itemsRes, suppliersRes] = await Promise.all([
        dataGateway.fetchJewelryItems(),
        dataGateway.fetchSuppliers(),
      ]);

      const itemsCounts: Record<string, number> = {};
      (itemsRes.data || []).forEach((item: any) => {
        if (item.supplier_id) {
          itemsCounts[item.supplier_id] = (itemsCounts[item.supplier_id] || 0) + 1;
        }
      });

      const suppliers = suppliersRes.data || [];
      const totalSuppliers = suppliers.length;
      const activeSuppliers = suppliers.filter((s: any) => s.is_active).length;
      const suspendedSuppliers = suppliers.filter((s: any) => !s.is_active).length;

      return {
        itemsCounts,
        totalSuppliers,
        activeSuppliers,
        suspendedSuppliers,
        totalDebit: 0,
        totalCredit: 0,
      };
    },
  });
}

export function useCountries() {
  return useQuery({
    queryKey: ['supplier-countries'],
    queryFn: async () => {
      const { data } = await dataGateway.fetchSuppliers();

      const countries = [...new Set((data || []).map((d: any) => d.address).filter(Boolean))];
      return countries as string[];
    },
  });
}
