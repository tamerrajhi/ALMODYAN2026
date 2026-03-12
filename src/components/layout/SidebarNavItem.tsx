import React, { memo, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface NavItemProps {
  item: { href: string; label: string; icon: LucideIcon };
  isGoldBranchContext: boolean;
  onItemClick: () => void;
}

// Each item calculates its own active status independently
export const SidebarNavItem = memo(function SidebarNavItem({
  item,
  isGoldBranchContext,
  onItemClick,
}: NavItemProps) {
  const location = useLocation();
  const navigate = useNavigate();

  // Calculate active status inside the item itself for independent re-renders
  const isActive = useMemo(() => {
    const currentFullPath = location.pathname + location.search;
    // For items with query params, check full path
    if (item.href.includes('?')) {
      return currentFullPath === item.href || currentFullPath.startsWith(item.href);
    }
    // For regular items, check pathname only
    return location.pathname === item.href;
  }, [location.pathname, location.search, item.href]);

  const Icon = item.icon;

  const handleClick = (e: React.MouseEvent) => {
    // Debug log to track sidebar clicks during heavy UI operations
    console.log('[Sidebar] Clicked:', item.href, 'at', new Date().toISOString());
    onItemClick();
  };

  return (
    <Link
      to={item.href}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 pointer-events-auto',
        'min-h-[40px] md:min-h-0 mr-3',
        isActive
          ? isGoldBranchContext
            ? 'bg-[hsl(var(--sidebar-gold-accent))] text-sidebar-primary font-medium'
            : 'bg-sidebar-accent text-sidebar-primary font-medium'
          : isGoldBranchContext
            ? 'text-[hsl(var(--sidebar-gold-foreground))]/70 hover:bg-[hsl(var(--sidebar-gold-accent))]/50 hover:text-[hsl(var(--sidebar-gold-foreground))]'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
      )}
      onClick={handleClick}
    >
      <Icon className={cn('w-4 h-4 flex-shrink-0 pointer-events-none', isActive && 'text-gold')} />
      <span className="truncate pointer-events-none">{item.label}</span>
    </Link>
  );
});

export default SidebarNavItem;

