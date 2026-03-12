import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Eye, 
  ExternalLink, 
  Calendar, 
  User, 
  ArrowRight,
  Package,
  ShoppingCart,
  ArrowLeftRight,
  RotateCcw,
  Upload,
  AlertTriangle,
  Trash2,
  DollarSign,
  Building2,
  BookOpen
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { 
  type MovementEntry, 
  type DocumentSummary,
  movementConfig,
  getDocumentRoute
} from '@/hooks/useItemMovements';

interface MovementTimelineCardProps {
  movement: MovementEntry;
  documentSummary?: DocumentSummary;
  onPreview?: (movement: MovementEntry) => void;
  onJournalPreview?: (journalEntryId: string) => void;
}

const movementIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  IMPORT: Upload,
  PURCHASE: Package,
  purchase_in: Upload,
  transfer: ArrowLeftRight,
  TRANSFER: ArrowLeftRight,
  TRANSFER_IN: ArrowLeftRight,
  TRANSFER_OUT: ArrowLeftRight,
  SALE: ShoppingCart,
  RETURN: RotateCcw,
  RETURN_IN: RotateCcw,
  RETURN_OUT: RotateCcw,
  ADJUSTMENT: AlertTriangle,
  WRITE_OFF: Trash2,
};

export function MovementTimelineCard({ 
  movement, 
  documentSummary,
  onPreview,
  onJournalPreview 
}: MovementTimelineCardProps) {
  const navigate = useNavigate();
  const config = movementConfig[movement.movement_type] || {
    label: movement.movement_type,
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
  };
  
  const IconComponent = movementIcons[movement.movement_type] || Package;
  const hasDocument = !!(movement.reference_id && movement.reference_type);
  const hasJournalEntry = !!movement.journal_entry_id;
  const documentRoute = getDocumentRoute(movement.reference_type, movement.reference_id);

  const handleOpenDocument = () => {
    if (documentRoute) {
      navigate(documentRoute);
    }
  };

  const handleOpenJournalEntry = () => {
    navigate('/accounting/journal-entries');
  };

  return (
    <div className="relative flex gap-4">
      {/* Timeline Dot */}
      <div className={`absolute right-[-8px] w-8 h-8 rounded-full ${config.bgColor} border-2 border-background flex items-center justify-center z-10`}>
        <IconComponent className={`w-4 h-4 ${config.color}`} />
      </div>

      {/* Content Card */}
      <div className="flex-1 mr-6 p-4 bg-card border rounded-lg shadow-sm hover:shadow-md transition-shadow">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`${config.bgColor} ${config.color} border-0`}>
              {config.label}
            </Badge>
            {movement.reference_code && (
              <span className="text-sm font-mono text-muted-foreground">
                {movement.reference_code}
              </span>
            )}
            {documentSummary?.status && (
              <Badge variant="outline" className="text-xs">
                {documentSummary.status}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
            <Calendar className="w-3 h-3" />
            {format(new Date(movement.movement_date), 'yyyy/MM/dd HH:mm', { locale: ar })}
          </div>
        </div>

        {/* Details Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm mb-3">
          {/* From/To Branch */}
          {(movement.from_branch_name || movement.to_branch_name) && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Building2 className="w-3 h-3 shrink-0" />
              <span className="truncate">
                {movement.from_branch_name && movement.to_branch_name ? (
                  <>
                    <span>{movement.from_branch_name}</span>
                    <ArrowRight className="w-3 h-3 inline mx-1" />
                    <span>{movement.to_branch_name}</span>
                  </>
                ) : (
                  movement.to_branch_name || movement.from_branch_name
                )}
              </span>
            </div>
          )}

          {/* Party Name (Customer/Supplier) */}
          {documentSummary?.party_name && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <User className="w-3 h-3 shrink-0" />
              <span className="truncate">{documentSummary.party_name}</span>
            </div>
          )}

          {/* Performed By */}
          {movement.performed_by && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <User className="w-3 h-3 shrink-0" />
              <span className="truncate">{movement.performed_by}</span>
            </div>
          )}

          {/* Cost/Amount */}
          {(movement.cost || documentSummary?.total_amount) && (
            <div className="flex items-center gap-1">
              <DollarSign className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="font-medium text-primary">
                {formatCurrency(movement.cost || documentSummary?.total_amount || 0)}
              </span>
            </div>
          )}
        </div>

        {/* Notes */}
        {movement.notes && (
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
            {movement.notes}
          </p>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2 border-t flex-wrap">
          {/* Document Actions */}
          {hasDocument && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => onPreview?.(movement)}
              >
                <Eye className="w-3 h-3 ml-1" />
                معاينة
              </Button>
              {documentRoute && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={handleOpenDocument}
                >
                  <ExternalLink className="w-3 h-3 ml-1" />
                  فتح المستند
                </Button>
              )}
            </>
          )}
          
          {/* Journal Entry Actions */}
          {hasJournalEntry ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs border-primary/50 text-primary hover:bg-primary/10"
                onClick={() => onJournalPreview?.(movement.journal_entry_id!)}
              >
                <BookOpen className="w-3 h-3 ml-1" />
                معاينة القيد
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={handleOpenJournalEntry}
              >
                <ExternalLink className="w-3 h-3 ml-1" />
                فتح القيد
              </Button>
            </>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-3 text-xs opacity-50 cursor-not-allowed"
                    disabled
                  >
                    <BookOpen className="w-3 h-3 ml-1" />
                    القيد
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>لا يوجد قيد محاسبي مرتبط بهذه الحركة</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    </div>
  );
}

export default MovementTimelineCard;
