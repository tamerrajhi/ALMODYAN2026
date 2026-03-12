import * as React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  MoreHorizontal,
  Eye,
  Pencil,
  Printer,
  Download,
  Trash2,
  Receipt,
  Copy,
  Mail,
  Truck,
  CheckCircle,
  XCircle,
  Loader2,
  Send,
  UserCheck,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RowActionsMenuProps {
  // Core actions
  onPreview?: () => void;
  onEdit?: () => void;
  onPrint?: () => void;
  onDownloadPdf?: () => void;
  onDelete?: () => void;

  // Invoice-specific actions
  onPaymentVoucher?: () => void;
  onDuplicate?: () => void;
  onSendEmail?: () => void;

  // Purchase-specific actions
  onReceive?: () => void;
  onApprove?: () => void;
  onCancel?: () => void;

  // Purchase Requisition actions
  onSubmit?: () => void;
  onReview?: () => void;
  onConvert?: () => void;

  // Loading state for specific action
  isLoading?: string | null;

  // Labels override (for i18n)
  labels?: {
    preview?: string;
    edit?: string;
    print?: string;
    downloadPdf?: string;
    delete?: string;
    paymentVoucher?: string;
    duplicate?: string;
    sendEmail?: string;
    receive?: string;
    approve?: string;
    cancel?: string;
    submit?: string;
    review?: string;
    convert?: string;
  };
}

export function RowActionsMenu({
  onPreview,
  onEdit,
  onPrint,
  onDownloadPdf,
  onDelete,
  onPaymentVoucher,
  onDuplicate,
  onSendEmail,
  onReceive,
  onApprove,
  onCancel,
  onSubmit,
  onReview,
  onConvert,
  isLoading,
  labels = {},
}: RowActionsMenuProps) {
  const defaultLabels = {
    preview: 'معاينة',
    edit: 'تعديل',
    print: 'طباعة',
    downloadPdf: 'تحميل PDF',
    delete: 'حذف',
    paymentVoucher: 'سند صرف',
    duplicate: 'نسخ',
    sendEmail: 'إرسال بريد',
    receive: 'استلام',
    approve: 'اعتماد',
    cancel: 'إلغاء',
    submit: 'إرسال للموافقة',
    review: 'مراجعة',
    convert: 'تحويل لأمر شراء',
  };

  const l = { ...defaultLabels, ...labels };

  // Group 1: View actions
  const viewActions = [
    { key: 'preview', icon: Eye, label: l.preview, onClick: onPreview },
    { key: 'print', icon: Printer, label: l.print, onClick: onPrint },
    { key: 'downloadPdf', icon: Download, label: l.downloadPdf, onClick: onDownloadPdf },
  ].filter((a) => a.onClick);

  // Group 2: Document actions
  const documentActions = [
    { key: 'paymentVoucher', icon: Receipt, label: l.paymentVoucher, onClick: onPaymentVoucher },
    { key: 'duplicate', icon: Copy, label: l.duplicate, onClick: onDuplicate },
    { key: 'sendEmail', icon: Mail, label: l.sendEmail, onClick: onSendEmail },
    { key: 'receive', icon: Truck, label: l.receive, onClick: onReceive },
    { key: 'approve', icon: CheckCircle, label: l.approve, onClick: onApprove, className: 'text-green-600' },
    { key: 'submit', icon: Send, label: l.submit, onClick: onSubmit },
    { key: 'review', icon: UserCheck, label: l.review, onClick: onReview, className: 'text-blue-600' },
    { key: 'convert', icon: ArrowRight, label: l.convert, onClick: onConvert, className: 'text-primary' },
  ].filter((a) => a.onClick);

  // Group 3: Modify actions
  const modifyActions = [
    { key: 'edit', icon: Pencil, label: l.edit, onClick: onEdit },
  ].filter((a) => a.onClick);

  // Group 4: Destructive actions
  const destructiveActions = [
    { key: 'cancel', icon: XCircle, label: l.cancel, onClick: onCancel, className: 'text-destructive' },
    { key: 'delete', icon: Trash2, label: l.delete, onClick: onDelete, className: 'text-destructive' },
  ].filter((a) => a.onClick);

  const hasViewActions = viewActions.length > 0;
  const hasDocumentActions = documentActions.length > 0;
  const hasModifyActions = modifyActions.length > 0;
  const hasDestructiveActions = destructiveActions.length > 0;

  const totalActions =
    viewActions.length + documentActions.length + modifyActions.length + destructiveActions.length;

  if (totalActions === 0) return null;

  const renderMenuItem = (action: {
    key: string;
    icon: React.ElementType;
    label: string;
    onClick?: () => void;
    className?: string;
  }) => {
    const Icon = action.icon;
    const loading = isLoading === action.key;

    return (
      <DropdownMenuItem
        key={action.key}
        onClick={action.onClick}
        disabled={loading}
        className={cn(
          'flex items-center gap-2 cursor-pointer',
          action.className
        )}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Icon className="w-4 h-4" />
        )}
        <span>{action.label}</span>
      </DropdownMenuItem>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 p-0 hover:bg-muted"
        >
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">فتح القائمة</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 bg-popover">
        {/* View Actions */}
        {viewActions.map(renderMenuItem)}

        {/* Separator after view actions */}
        {hasViewActions && (hasDocumentActions || hasModifyActions || hasDestructiveActions) && (
          <DropdownMenuSeparator />
        )}

        {/* Document Actions */}
        {documentActions.map(renderMenuItem)}

        {/* Separator after document actions */}
        {hasDocumentActions && (hasModifyActions || hasDestructiveActions) && (
          <DropdownMenuSeparator />
        )}

        {/* Modify Actions */}
        {modifyActions.map(renderMenuItem)}

        {/* Separator before destructive actions */}
        {hasModifyActions && hasDestructiveActions && <DropdownMenuSeparator />}

        {/* Destructive Actions */}
        {destructiveActions.map(renderMenuItem)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
