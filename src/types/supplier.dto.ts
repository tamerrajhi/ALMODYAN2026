/**
 * SupplierDisplayDTO - مصدر عرض واحد للموردين
 * يُستخدم لعرض بيانات المورد في جميع الـ UI components
 */
export interface SupplierDisplayDTO {
  id: string;
  display_name: string;
  subtitle?: string;
}

/**
 * تحويل بيانات المورد من الـ DB إلى DTO للعرض
 */
export function toSupplierDisplayDTO(supplier: {
  id: string;
  supplier_name: string;
  supplier_code?: string | null;
}): SupplierDisplayDTO {
  return {
    id: supplier.id,
    display_name: supplier.supplier_name,
    subtitle: supplier.supplier_code || undefined,
  };
}
