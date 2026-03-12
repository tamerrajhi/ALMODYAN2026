import React, { memo, useMemo, useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SidebarNavItem } from './SidebarNavItem';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Gem,
  ChevronDown,
  LogOut,
  Loader2,
} from 'lucide-react';
import { LucideIcon } from 'lucide-react';

// Section color configurations
const sectionColors: Record<string, { bg: string; icon: string; border: string }> = {
  dashboard: { bg: 'from-blue-500/10 to-indigo-500/10', icon: 'text-blue-500', border: 'border-l-blue-500' },
  purchases: { bg: 'from-purple-500/10 to-violet-500/10', icon: 'text-purple-500', border: 'border-l-purple-500' },
  sales: { bg: 'from-emerald-500/10 to-green-500/10', icon: 'text-emerald-500', border: 'border-l-emerald-500' },
  products: { bg: 'from-indigo-500/10 to-purple-500/10', icon: 'text-indigo-500', border: 'border-l-indigo-500' },
  inventory: { bg: 'from-orange-500/10 to-amber-500/10', icon: 'text-orange-500', border: 'border-l-orange-500' },
  production: { bg: 'from-cyan-500/10 to-teal-500/10', icon: 'text-cyan-500', border: 'border-l-cyan-500' },
  accounting: { bg: 'from-rose-500/10 to-pink-500/10', icon: 'text-rose-500', border: 'border-l-rose-500' },
  vaults: { bg: 'from-yellow-500/10 to-amber-500/10', icon: 'text-yellow-500', border: 'border-l-yellow-500' },
  hr: { bg: 'from-sky-500/10 to-blue-500/10', icon: 'text-sky-500', border: 'border-l-sky-500' },
  reports: { bg: 'from-lime-500/10 to-green-500/10', icon: 'text-lime-600', border: 'border-l-lime-500' },
  settings: { bg: 'from-slate-500/10 to-gray-500/10', icon: 'text-slate-500', border: 'border-l-slate-500' },
  'system-management': { bg: 'from-red-500/10 to-rose-500/10', icon: 'text-red-500', border: 'border-l-red-500' },
};

// Module ID mapping for sections
const sectionModuleMap: Record<string, string> = {
  dashboard: 'dashboard',
  purchases: 'purchases',
  sales: 'sales',
  products: 'products',
  inventory: 'inventory',
  production: 'production',
  accounting: 'accounting',
  vaults: 'vaults',
  hr: 'hr',
  reports: 'reports',
  settings: 'settings',
  'system-management': 'settings',
};

interface MenuItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

interface MenuSection {
  id: string;
  label: string;
  icon: LucideIcon;
  items?: MenuItem[];
  isStandalone?: boolean;
  href?: string;
}

interface SidebarProps {
  menuSections: MenuSection[];
  isGoldBranchContext: boolean;
  isAdmin: boolean;
  viewableScreenPaths: Set<string>;
  userHasModuleAccess: (moduleId: string) => boolean;
  onItemClick: () => void;
  user: any;
  onSignOut: () => void;
  isRTL: boolean;
  t: any;
  isOpen: boolean;
  isLoading: boolean;
}

// Memoized Sidebar - only re-renders when essential props change
export const Sidebar = memo(function Sidebar({
  menuSections,
  isGoldBranchContext,
  isAdmin,
  viewableScreenPaths,
  userHasModuleAccess,
  onItemClick,
  user,
  onSignOut,
  isRTL,
  t,
  isOpen,
  isLoading,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  // Helper function to check if a menu item matches current location
  const isItemActive = (itemHref: string) => {
    const currentFullPath = location.pathname + location.search;
    if (itemHref.includes('?')) {
      return currentFullPath === itemHref || currentFullPath.startsWith(itemHref);
    }
    return location.pathname === itemHref;
  };

  // Track which sections are open
  const [openSections, setOpenSections] = useState<string[]>(() => {
    const currentSection = menuSections.find(section => 
      'items' in section && section.items?.some(item => isItemActive(item.href))
    );
    return currentSection ? [currentSection.id] : ['purchases'];
  });

  // Track previous pathname to detect actual route changes
  const prevPathnameRef = useRef(location.pathname);

  // Update open sections only when route actually changes (navigation)
  // Not when user manually toggles a section
  useEffect(() => {
    if (prevPathnameRef.current !== location.pathname) {
      const currentSection = menuSections.find(section => 
        'items' in section && section.items?.some(item => isItemActive(item.href))
      );
      if (currentSection && !openSections.includes(currentSection.id)) {
        setOpenSections(prev => [...prev, currentSection.id]);
      }
      prevPathnameRef.current = location.pathname;
    }
  }, [location.pathname, location.search, menuSections]);

  const toggleSection = (sectionId: string) => {
    setOpenSections(prev => 
      prev.includes(sectionId) 
        ? prev.filter(id => id !== sectionId)
        : [...prev, sectionId]
    );
  };

  // Filter menu sections inside Sidebar using Set.has() for O(1) lookup
  const filteredSections = useMemo(() => {
    if (isLoading) return [];
    
    return menuSections.map(section => {
      const moduleId = sectionModuleMap[section.id];
      
      // Check if the module is enabled AND user has access
      if (moduleId && !userHasModuleAccess(moduleId)) {
        return null;
      }

      // Handle standalone items
      if ('isStandalone' in section && section.isStandalone) {
        if (isAdmin || ('href' in section && viewableScreenPaths.has(section.href as string))) {
          return section;
        }
        return null;
      }

      // Handle sections with items
      if ('items' in section && section.items) {
        const filteredItems = section.items.filter(item => {
          if ((item as any).adminOnly && !isAdmin) return false;
          if (isAdmin) return true;
          return viewableScreenPaths.has(item.href);
        });
        if (filteredItems.length === 0) return null;
        return { ...section, items: filteredItems };
      }
      return null;
    }).filter(Boolean) as MenuSection[];
  }, [menuSections, isAdmin, viewableScreenPaths, userHasModuleAccess, isLoading]);

  const renderSection = (section: MenuSection) => {
    // Handle standalone items
    if ('isStandalone' in section && section.isStandalone && 'href' in section) {
      const isActive = location.pathname === section.href;
      return (
        <Link
          key={section.id}
          to={section.href as string}
          onClick={onItemClick}
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium w-full transition-all duration-200 mb-1',
            'min-h-[44px] md:min-h-0',
            isActive
              ? isGoldBranchContext
                ? 'bg-[hsl(var(--sidebar-gold-accent))] text-sidebar-primary'
                : 'bg-sidebar-accent text-sidebar-primary'
              : isGoldBranchContext
                ? 'text-[hsl(var(--sidebar-gold-foreground))]/80 hover:bg-[hsl(var(--sidebar-gold-accent))]/20'
                : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/20'
          )}
        >
          <section.icon className={cn('w-5 h-5 flex-shrink-0', isActive && 'text-gold')} />
          <span className="truncate flex-1 text-right">{section.label}</span>
        </Link>
      );
    }

    // Handle sections with items
    if (!('items' in section) || !section.items) return null;
    
    const isOpen = openSections.includes(section.id);
    const hasActiveItem = section.items.some(item => isItemActive(item.href));
    const colors = sectionColors[section.id] || sectionColors.dashboard;
    
    return (
      <Collapsible
        key={section.id}
        open={isOpen}
        onOpenChange={() => toggleSection(section.id)}
        className="mb-1"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium w-full transition-all duration-200',
              'min-h-[44px] md:min-h-0 border-l-2 border-transparent cursor-pointer',
              hasActiveItem || isOpen
                ? cn(
                    'bg-gradient-to-r',
                    colors.bg,
                    colors.border,
                    isGoldBranchContext
                      ? 'text-[hsl(var(--sidebar-gold-foreground))]'
                      : 'text-sidebar-foreground'
                  )
                : isGoldBranchContext
                  ? 'text-[hsl(var(--sidebar-gold-foreground))]/80 hover:bg-[hsl(var(--sidebar-gold-accent))]/20'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/20'
            )}
          >
            <section.icon className={cn(
              'w-5 h-5 flex-shrink-0 transition-colors',
              (hasActiveItem || isOpen) ? colors.icon : ''
            )} />
            <span className="truncate flex-1 text-right">{section.label}</span>
            <ChevronDown className={cn(
              'w-4 h-4 flex-shrink-0 transition-transform duration-200',
              isOpen && 'rotate-180'
            )} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="animate-accordion-down">
          <div className="mt-1 space-y-0.5">
            {section.items.map(item => (
              <SidebarNavItem
                key={item.href}
                item={item}
                isGoldBranchContext={isGoldBranchContext}
                onItemClick={onItemClick}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <aside
      className={cn(
        'fixed right-0 top-0 h-screen flex flex-col transition-all duration-300 z-[60]',
        'w-72 md:w-64',
        isOpen ? 'translate-x-0' : 'translate-x-full',
        isGoldBranchContext 
          ? 'bg-[hsl(var(--sidebar-gold-background))] border-l border-[hsl(var(--sidebar-gold-border))]' 
          : 'bg-sidebar border-l border-sidebar-border'
      )}
    >
      {/* Logo */}
      <div className={cn(
        "p-4 md:p-6 border-b",
        isGoldBranchContext ? "border-[hsl(var(--sidebar-gold-border))]" : "border-sidebar-border"
      )}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 md:w-10 md:h-10 rounded-xl bg-gradient-gold flex items-center justify-center shadow-gold flex-shrink-0">
            <Gem className="w-5 h-5 text-navy" />
          </div>
          <div className="min-w-0">
            <h1 className={cn(
              "font-bold text-base md:text-base",
              isGoldBranchContext ? "text-[hsl(var(--sidebar-gold-foreground))]" : "text-sidebar-foreground"
            )}>Almodyan</h1>
            <p className={cn(
              "text-xs truncate",
              isGoldBranchContext ? "text-[hsl(var(--sidebar-gold-foreground))]/60" : "text-sidebar-foreground/60"
            )}>{isGoldBranchContext ? 'نظام إدارة الذهب' : 'نظام إدارة المجوهرات'}</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 md:p-4 space-y-1 overflow-y-auto overscroll-contain">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          filteredSections.map(renderSection)
        )}
      </nav>

      {/* User section */}
      <div className={cn(
        "p-3 md:p-4 border-t",
        isGoldBranchContext ? "border-[hsl(var(--sidebar-gold-border))]" : "border-sidebar-border"
      )}>
        <div className="flex items-center gap-3 px-3 py-2 mb-2">
          <div className={cn(
            "w-9 h-9 md:w-8 md:h-8 rounded-full flex items-center justify-center flex-shrink-0",
            isGoldBranchContext ? "bg-[hsl(var(--sidebar-gold-accent))]" : "bg-sidebar-accent"
          )}>
            <span className={cn(
              "text-sm font-medium",
              isGoldBranchContext ? "text-[hsl(var(--sidebar-gold-foreground))]" : "text-sidebar-foreground"
            )}>
              {user?.email?.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn(
              "text-sm font-medium truncate",
              isGoldBranchContext ? "text-[hsl(var(--sidebar-gold-foreground))]" : "text-sidebar-foreground"
            )}>
              {user?.user_metadata?.full_name || 'مستخدم'}
            </p>
            <p className={cn(
              "text-xs truncate",
              isGoldBranchContext ? "text-[hsl(var(--sidebar-gold-foreground))]/50" : "text-sidebar-foreground/50"
            )}>{user?.email}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start hover:text-destructive hover:bg-destructive/10 min-h-[44px] md:min-h-0",
            isGoldBranchContext ? "text-[hsl(var(--sidebar-gold-foreground))]/70" : "text-sidebar-foreground/70"
          )}
          onClick={onSignOut}
        >
          <LogOut className={cn("w-4 h-4 flex-shrink-0", isRTL ? "ml-2" : "mr-2")} />
          {t.header.signOut}
        </Button>
      </div>
    </aside>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  return (
    prevProps.isOpen === nextProps.isOpen &&
    prevProps.isGoldBranchContext === nextProps.isGoldBranchContext &&
    prevProps.isAdmin === nextProps.isAdmin &&
    prevProps.viewableScreenPaths === nextProps.viewableScreenPaths &&
    prevProps.menuSections === nextProps.menuSections &&
    prevProps.isRTL === nextProps.isRTL &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.user?.id === nextProps.user?.id
  );
});

export default Sidebar;
