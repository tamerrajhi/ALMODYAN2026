// Shared definitions for journal entry reference types

export const referenceTypeLabels: Record<string, string> = {
  sale: 'مبيعات',
  purchase: 'مشتريات',
  sale_return: 'مرتجع مبيعات',
  purchase_return: 'مرتجع مشتريات',
  payment: 'صرف',
  receipt: 'قبض',
  manual: 'يدوي',
  inventory_shortage: 'عجز مخزون',
  inventory_overage: 'زيادة مخزون',
  reversal: 'قيد عكسي',
  inventory_transfer: 'نقل مخزون',
};

export const referenceTypeColors: Record<string, string> = {
  sale: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700',
  purchase: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700',
  sale_return: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-700',
  purchase_return: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-700',
  payment: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700',
  receipt: 'bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/30 dark:text-teal-400 dark:border-teal-700',
  manual: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-900/30 dark:text-slate-400 dark:border-slate-700',
  inventory_shortage: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-700',
  inventory_overage: 'bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-900/30 dark:text-cyan-400 dark:border-cyan-700',
  reversal: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700',
  inventory_transfer: 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-700',
};

export type ReferenceType = keyof typeof referenceTypeLabels;

export const getReferenceTypeLabel = (type: string | null): string => {
  return referenceTypeLabels[type || 'manual'] || 'يدوي';
};

export const getReferenceTypeColor = (type: string | null): string => {
  return referenceTypeColors[type || 'manual'] || referenceTypeColors.manual;
};
