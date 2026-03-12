/**
 * Invoice Action Renderer - Stage P4.3-C
 * 
 * SINGLE RENDERER for all invoice actions.
 * Renders actions from the registry based on policy output.
 * UI components use this instead of duplicating action rendering logic.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { 
  DropdownMenuItem,
  DropdownMenuSeparator 
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2 } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { 
  getActionsForPlacement, 
  type InvoiceActionDescriptor 
} from '@/domain/purchasing/policy/actionRegistry';
import { 
  getBlockReasonMessage,
  type InvoicePolicyResult,
  type InvoiceActionKey
} from '@/domain/purchasing';

// ===========================
// Types
// ===========================

export type ActionHandlers = Partial<Record<InvoiceActionKey, () => void>>;

export interface InvoiceActionRendererProps {
  policy: InvoicePolicyResult;
  placement: 'header' | 'dropdown';
  handlers: ActionHandlers;
  loadingAction?: InvoiceActionKey | null;
  excludeActions?: InvoiceActionKey[];
}

// ===========================
// Icon Mapping
// ===========================

const ICON_MAP: Record<string, React.ElementType> = {
  RotateCcw: LucideIcons.RotateCcw,
  CreditCard: LucideIcons.CreditCard,
  BookOpen: LucideIcons.BookOpen,
  Printer: LucideIcons.Printer,
  Ban: LucideIcons.Ban,
  Eye: LucideIcons.Eye,
  Download: LucideIcons.Download,
  Copy: LucideIcons.Copy,
  Mail: LucideIcons.Mail,
  Circle: LucideIcons.Circle,
};

function getIcon(iconName: string): React.ElementType {
  return ICON_MAP[iconName] || LucideIcons.Circle;
}

// ===========================
// Header Action Button
// ===========================

interface HeaderActionButtonProps {
  descriptor: InvoiceActionDescriptor;
  enabled: boolean;
  visible: boolean;
  blockReason?: string;
  onClick?: () => void;
  isLoading?: boolean;
  language: 'ar' | 'en';
}

function HeaderActionButton({
  descriptor,
  enabled,
  visible,
  blockReason,
  onClick,
  isLoading,
  language,
}: HeaderActionButtonProps) {
  if (!visible) return null;

  const Icon = getIcon(descriptor.icon);
  const label = language === 'ar' ? descriptor.labelAr : descriptor.labelEn;
  
  const buttonVariant = descriptor.danger ? 'outline' : 'outline';
  
  const buttonClassName = descriptor.danger 
    ? 'gap-2 text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground'
    : 'gap-2';

  const button = (
    <Button
      variant={buttonVariant}
      onClick={enabled ? onClick : undefined}
      disabled={!enabled || isLoading}
      className={buttonClassName}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Icon className="w-4 h-4" />
      )}
      {label}
    </Button>
  );

  // Wrap with tooltip if disabled with reason
  if (!enabled && blockReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block">{button}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p>{blockReason}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return button;
}

// ===========================
// Dropdown Action Item
// ===========================

interface DropdownActionItemProps {
  descriptor: InvoiceActionDescriptor;
  enabled: boolean;
  visible: boolean;
  blockReason?: string;
  onClick?: () => void;
  isLoading?: boolean;
  language: 'ar' | 'en';
}

function DropdownActionItem({
  descriptor,
  enabled,
  visible,
  blockReason,
  onClick,
  isLoading,
  language,
}: DropdownActionItemProps) {
  if (!visible) return null;

  const Icon = getIcon(descriptor.icon);
  const label = language === 'ar' ? descriptor.labelAr : descriptor.labelEn;

  const menuItem = (
    <DropdownMenuItem
      onClick={enabled ? onClick : undefined}
      disabled={!enabled || isLoading}
      className={descriptor.danger ? 'text-destructive focus:text-destructive' : ''}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 me-2 animate-spin" />
      ) : (
        <Icon className="h-4 w-4 me-2" />
      )}
      {label}
    </DropdownMenuItem>
  );

  // Wrap with tooltip if disabled with reason
  if (!enabled && blockReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block">{menuItem}</span>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs">
          <p>{blockReason}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return menuItem;
}

// ===========================
// Main Renderer
// ===========================

export function InvoiceActionRenderer({
  policy,
  placement,
  handlers,
  loadingAction,
  excludeActions = [],
}: InvoiceActionRendererProps) {
  const { language } = useLanguage();
  const lang = language as 'ar' | 'en';

  // Get actions for this placement from registry
  const actions = getActionsForPlacement(placement)
    .filter(action => !excludeActions.includes(action.key));

  if (placement === 'header') {
    return (
      <>
        {actions.map((descriptor) => {
          const actionState = policy.actions[descriptor.key];
          const blockReason = getBlockReasonMessage(actionState.blockReason, lang);
          
          return (
            <HeaderActionButton
              key={descriptor.key}
              descriptor={descriptor}
              enabled={actionState.enabled}
              visible={actionState.visible}
              blockReason={blockReason}
              onClick={handlers[descriptor.key]}
              isLoading={loadingAction === descriptor.key}
              language={lang}
            />
          );
        })}
      </>
    );
  }

  // Dropdown placement
  // Group actions with separators between functional groups
  const groupedActions: (InvoiceActionDescriptor | 'separator')[] = [];
  let lastOrder = -1;
  
  actions.forEach((action, index) => {
    // Add separator between major groups (order gaps > 3)
    if (lastOrder >= 0 && action.order - lastOrder > 3 && index > 0) {
      groupedActions.push('separator');
    }
    groupedActions.push(action);
    lastOrder = action.order;
  });

  return (
    <>
      {groupedActions.map((item, index) => {
        if (item === 'separator') {
          return <DropdownMenuSeparator key={`sep-${index}`} />;
        }
        
        const descriptor = item;
        const actionState = policy.actions[descriptor.key];
        const blockReason = getBlockReasonMessage(actionState.blockReason, lang);
        
        return (
          <DropdownActionItem
            key={descriptor.key}
            descriptor={descriptor}
            enabled={actionState.enabled}
            visible={actionState.visible}
            blockReason={blockReason}
            onClick={handlers[descriptor.key]}
            isLoading={loadingAction === descriptor.key}
            language={lang}
          />
        );
      })}
    </>
  );
}

export default InvoiceActionRenderer;
