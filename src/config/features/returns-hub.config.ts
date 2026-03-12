/**
 * Returns Hub Feature Configuration
 * 
 * This config controls the cutover between Legacy Returns and Returns Hub.
 * 
 * ROLLBACK RUNBOOK (< 5 minutes):
 * ─────────────────────────────────
 * Step 1: Set RETURNS_HUB_ENABLED = false (line 24 below)
 * Step 2: Deploy/restart the application
 * Step 3: Smoke checks:
 *         - /purchasing/returns → loads legacy list
 *         - /purchasing/returns-hub → still accessible (for debugging)
 *         - /purchasing/returns-legacy → loads legacy list
 * 
 * CUTOVER CHECKLIST:
 * - [x] v_returns_hub view uniqueness verified (13/13)
 * - [x] Unique returns detail page working
 * - [x] General returns detail page working
 * - [x] JE links fixed (query param format)
 * - [x] Feature flag wired to routing (App.tsx)
 */

// ════════════════════════════════════════════════════════════════════════════
// FEATURE FLAG: Change this single value to rollback
// ════════════════════════════════════════════════════════════════════════════
export const RETURNS_HUB_ENABLED = true;  // Set to false for rollback
// ════════════════════════════════════════════════════════════════════════════

// Route paths
export const RETURNS_HUB_ROUTES = {
  // Default route - controlled by RETURNS_HUB_ENABLED flag
  default: '/purchasing/returns',
  
  // Always accessible routes (for debugging/comparison)
  hub: '/purchasing/returns-hub',
  legacy: '/purchasing/returns-legacy',
  
  // Detail routes
  hubDetail: '/purchasing/returns-hub/:return_type/:canonical_id',
  legacyDetail: '/purchasing/returns/:id/view',
  
  // Create routes (unchanged)
  create: '/purchasing/returns/new',
} as const;

// Menu labels
export const RETURNS_MENU_LABELS = {
  hub: {
    ar: 'المرتجعات',
    en: 'Returns',
  },
  legacy: {
    ar: 'المرتجعات (قديم)',
    en: 'Returns (Legacy)',
  },
} as const;
