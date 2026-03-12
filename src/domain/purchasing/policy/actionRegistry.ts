/**
 * Invoice Action Registry - Stage P4.3-C
 * 
 * SINGLE SOURCE OF TRUTH for all invoice action descriptors.
 * UI components render actions from this registry - they do NOT decide
 * which actions exist or their configuration.
 */

import type { InvoiceActionKey } from './invoicePolicyTypes';

// ===========================
// Action Types
// ===========================

export type ActionType = 
  | 'nav'       // Navigate to a route
  | 'dialog'    // Open a dialog
  | 'command'   // Execute a command (e.g., cancel, email)
  | 'client';   // Client-side action (e.g., print, pdf)

export type ActionPlacement = 'header' | 'dropdown' | 'both';

// ===========================
// Action Descriptor
// ===========================

export interface InvoiceActionDescriptor {
  key: InvoiceActionKey;
  labelAr: string;
  labelEn: string;
  icon: string;  // Lucide icon name
  placement: ActionPlacement;
  order: number;
  type: ActionType;
  confirm?: {
    required: boolean;
    reasonRequired?: boolean;
    titleAr?: string;
    titleEn?: string;
    messageAr?: string;
    messageEn?: string;
  };
  danger?: boolean;
}

// ===========================
// Action Registry
// ===========================

export const INVOICE_ACTION_REGISTRY: InvoiceActionDescriptor[] = [
  // === HEADER ACTIONS ===
  {
    key: 'createReturn',
    labelAr: 'إنشاء مرتجع',
    labelEn: 'Create Return',
    icon: 'RotateCcw',
    placement: 'both',
    order: 1,
    type: 'nav',
  },
  {
    key: 'pay',
    labelAr: 'سند صرف',
    labelEn: 'Payment',
    icon: 'CreditCard',
    placement: 'both',
    order: 2,
    type: 'dialog',
  },
  {
    key: 'viewJournal',
    labelAr: 'القيد المحاسبي',
    labelEn: 'Journal Entry',
    icon: 'BookOpen',
    placement: 'both',
    order: 3,
    type: 'nav',
  },
  {
    key: 'print',
    labelAr: 'طباعة',
    labelEn: 'Print',
    icon: 'Printer',
    placement: 'both',
    order: 4,
    type: 'client',
  },
  {
    key: 'cancel',
    labelAr: 'إلغاء',
    labelEn: 'Cancel',
    icon: 'Ban',
    placement: 'header',
    order: 5,
    type: 'command',
    confirm: {
      required: true,
      reasonRequired: false,
      titleAr: 'إلغاء الفاتورة',
      titleEn: 'Cancel Invoice',
      messageAr: 'هل أنت متأكد من إلغاء هذه الفاتورة؟',
      messageEn: 'Are you sure you want to cancel this invoice?',
    },
    danger: true,
  },
  // === DROPDOWN-ONLY ACTIONS ===
  {
    key: 'view',
    labelAr: 'معاينة',
    labelEn: 'Preview',
    icon: 'Eye',
    placement: 'dropdown',
    order: 0,
    type: 'nav',
  },
  {
    key: 'pdf',
    labelAr: 'تحميل PDF',
    labelEn: 'Download PDF',
    icon: 'Download',
    placement: 'both',
    order: 7,
    type: 'client',
  },
  {
    key: 'duplicate',
    labelAr: 'نسخ الفاتورة',
    labelEn: 'Duplicate',
    icon: 'Copy',
    placement: 'both',
    order: 8,
    type: 'command',
  },
  {
    key: 'email',
    labelAr: 'إرسال بريد',
    labelEn: 'Send Email',
    icon: 'Mail',
    placement: 'both',
    order: 9,
    type: 'command',
  },
];

// ===========================
// Registry Helpers
// ===========================

/**
 * Get actions for a specific placement, sorted by order.
 */
export function getActionsForPlacement(placement: 'header' | 'dropdown'): InvoiceActionDescriptor[] {
  return INVOICE_ACTION_REGISTRY
    .filter(action => action.placement === placement || action.placement === 'both')
    .sort((a, b) => a.order - b.order);
}

/**
 * Get a single action descriptor by key.
 */
export function getActionDescriptor(key: InvoiceActionKey): InvoiceActionDescriptor | undefined {
  return INVOICE_ACTION_REGISTRY.find(action => action.key === key);
}

/**
 * Get the localized label for an action.
 */
export function getActionLabel(key: InvoiceActionKey, language: 'ar' | 'en'): string {
  const descriptor = getActionDescriptor(key);
  if (!descriptor) return key;
  return language === 'ar' ? descriptor.labelAr : descriptor.labelEn;
}
