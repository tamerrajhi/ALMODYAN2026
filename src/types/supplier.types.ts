// Supplier Types
export interface Supplier {
  id: string;
  supplier_code: string;
  supplier_name: string;
  supplier_ref?: string;
  supplier_type: 'company' | 'individual' | 'government';
  business_type: 'products' | 'services' | 'mixed';
  business_activity?: string;
  country: string;
  city?: string;
  address?: string;
  detailed_address?: string;
  location_lat?: number;
  location_lng?: number;
  phone?: string;
  mobile_phone?: string;
  office_phone?: string;
  email?: string;
  website?: string;
  contact_person?: string;
  contact_position?: string;
  vat_number?: string;
  commercial_register?: string;
  national_id?: string;
  license_expiry_date?: string;
  default_currency: string;
  payment_terms: 'immediate' | 'net_7' | 'net_15' | 'net_30' | 'net_60' | 'net_90';
  credit_limit: number;
  opening_balance: number;
  current_balance: number;
  default_payment_method: 'cash' | 'bank_transfer' | 'check' | 'credit';
  status: 'active' | 'suspended' | 'archived';
  internal_notes?: string;
  tags?: string[];
  account_id?: string;
  created_at: string;
  updated_at: string;
}

export interface SupplierDocument {
  id: string;
  supplier_id: string;
  document_type: 'commercial_register' | 'tax_certificate' | 'identity' | 'contract' | 'other';
  document_name: string;
  file_path: string;
  file_size?: number;
  mime_type?: string;
  expiry_date?: string;
  notes?: string;
  uploaded_by?: string;
  created_at: string;
  updated_at: string;
}

export interface SupplierFormData {
  supplier_name: string;
  supplier_type: 'company' | 'individual' | 'government';
  business_type: 'products' | 'services' | 'mixed';
  business_activity: string;
  country: string;
  city: string;
  address: string;
  detailed_address: string;
  mobile_phone: string;
  office_phone: string;
  email: string;
  website: string;
  contact_person: string;
  contact_position: string;
  vat_number: string;
  commercial_register: string;
  national_id: string;
  license_expiry_date: string;
  default_currency: string;
  payment_terms: 'immediate' | 'net_7' | 'net_15' | 'net_30' | 'net_60' | 'net_90';
  credit_limit: number;
  opening_balance: number;
  default_payment_method: 'cash' | 'bank_transfer' | 'check' | 'credit';
  status: 'active' | 'suspended' | 'archived';
  internal_notes: string;
  tags: string[];
}

export const defaultSupplierFormData: SupplierFormData = {
  supplier_name: '',
  supplier_type: 'company',
  business_type: 'products',
  business_activity: '',
  country: 'السعودية',
  city: '',
  address: '',
  detailed_address: '',
  mobile_phone: '',
  office_phone: '',
  email: '',
  website: '',
  contact_person: '',
  contact_position: '',
  vat_number: '',
  commercial_register: '',
  national_id: '',
  license_expiry_date: '',
  default_currency: 'SAR',
  payment_terms: 'net_30',
  credit_limit: 0,
  opening_balance: 0,
  default_payment_method: 'cash',
  status: 'active',
  internal_notes: '',
  tags: [],
};

export const supplierTypeLabels: Record<string, string> = {
  company: 'شركة',
  individual: 'فرد',
  government: 'جهة حكومية',
};

export const businessTypeLabels: Record<string, string> = {
  products: 'منتجات',
  services: 'خدمات',
  mixed: 'مختلط',
};

export const paymentTermsLabels: Record<string, string> = {
  immediate: 'فوري',
  net_7: '7 أيام',
  net_15: '15 يوم',
  net_30: '30 يوم',
  net_60: '60 يوم',
  net_90: '90 يوم',
};

export const paymentMethodLabels: Record<string, string> = {
  cash: 'نقدي',
  bank_transfer: 'تحويل بنكي',
  check: 'شيك',
  credit: 'آجل',
};

export const statusLabels: Record<string, string> = {
  active: 'نشط',
  suspended: 'موقوف',
  archived: 'مؤرشف',
};

export const documentTypeLabels: Record<string, string> = {
  commercial_register: 'سجل تجاري',
  tax_certificate: 'شهادة ضريبية',
  identity: 'هوية',
  contract: 'عقد',
  other: 'أخرى',
};
