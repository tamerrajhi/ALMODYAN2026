/**
 * Temporary diagnostic utilities to identify what blocks sidebar clicks.
 * Remove after debugging is complete.
 */

export function runInteractionDiagnostics() {
  console.log('🔍 [Diagnostics] Starting interaction diagnostics...');
  
  // 1. Check body/html/root for interaction locks
  checkInteractionLocks();
  
  // 2. Find all fixed elements that cover significant area
  findBlockingFixedElements();
  
  // 3. Add global click capture to identify blocking elements
  addClickDiagnostics();
  
  console.log('🔍 [Diagnostics] Diagnostics active. Click on sidebar to see blocking element.');
}

function checkInteractionLocks() {
  const html = document.documentElement;
  const body = document.body;
  const root = document.getElementById('root');
  
  console.group('🔒 [Diagnostics] Checking interaction locks:');
  
  // Check HTML element
  console.log('HTML:', {
    pointerEvents: getComputedStyle(html).pointerEvents,
    overflow: getComputedStyle(html).overflow,
    inert: html.hasAttribute('inert'),
    ariaHidden: html.getAttribute('aria-hidden'),
    dataScrollLocked: html.hasAttribute('data-scroll-locked'),
  });
  
  // Check BODY element
  console.log('BODY:', {
    pointerEvents: body.style.pointerEvents || getComputedStyle(body).pointerEvents,
    overflow: body.style.overflow || getComputedStyle(body).overflow,
    inert: body.hasAttribute('inert'),
    ariaHidden: body.getAttribute('aria-hidden'),
    dataScrollLocked: body.hasAttribute('data-scroll-locked'),
  });
  
  // Check ROOT element
  if (root) {
    console.log('ROOT (#root):', {
      pointerEvents: root.style.pointerEvents || getComputedStyle(root).pointerEvents,
      overflow: root.style.overflow || getComputedStyle(root).overflow,
      inert: root.hasAttribute('inert'),
      ariaHidden: root.getAttribute('aria-hidden'),
      dataScrollLocked: root.hasAttribute('data-scroll-locked'),
    });
  }
  
  // Check for any elements with data-radix attributes
  const radixElements = document.querySelectorAll('[data-radix-dialog-overlay], [data-radix-portal], [data-state]');
  console.log('Radix elements found:', radixElements.length);
  radixElements.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    const computed = getComputedStyle(el);
    console.log(`  Radix element ${i}:`, {
      tag: el.tagName,
      classes: el.className,
      dataState: el.getAttribute('data-state'),
      isOverlay: el.hasAttribute('data-radix-dialog-overlay'),
      isPortal: el.hasAttribute('data-radix-portal'),
      zIndex: computed.zIndex,
      pointerEvents: computed.pointerEvents,
      position: computed.position,
      dimensions: `${rect.width}x${rect.height}`,
      coversScreen: rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.5,
    });
  });
  
  console.groupEnd();
}

function findBlockingFixedElements() {
  console.group('📍 [Diagnostics] Fixed/Absolute elements that may block:');
  
  const allElements = document.querySelectorAll('*');
  const blockingElements: Array<{
    tag: string;
    classes: string;
    zIndex: string;
    position: string;
    pointerEvents: string;
    dimensions: string;
    coversSignificantArea: boolean;
  }> = [];
  
  allElements.forEach((el) => {
    const computed = getComputedStyle(el);
    if (computed.position === 'fixed' || computed.position === 'absolute') {
      const rect = el.getBoundingClientRect();
      const coversSignificantArea = rect.width > window.innerWidth * 0.3 && rect.height > window.innerHeight * 0.3;
      
      if (coversSignificantArea || parseInt(computed.zIndex) > 40) {
        blockingElements.push({
          tag: el.tagName,
          classes: el.className.toString().slice(0, 100),
          zIndex: computed.zIndex,
          position: computed.position,
          pointerEvents: computed.pointerEvents,
          dimensions: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          coversSignificantArea,
        });
      }
    }
  });
  
  // Sort by z-index descending
  blockingElements.sort((a, b) => {
    const zA = parseInt(a.zIndex) || 0;
    const zB = parseInt(b.zIndex) || 0;
    return zB - zA;
  });
  
  console.table(blockingElements.slice(0, 15)); // Top 15
  console.groupEnd();
}

function addClickDiagnostics() {
  // Remove any existing listener
  document.removeEventListener('click', clickDiagnosticHandler, true);
  
  // Add capture-phase click listener
  document.addEventListener('click', clickDiagnosticHandler, true);
  
  console.log('👆 [Diagnostics] Click capture listener added. Click anywhere to see what element receives the click.');
}

function clickDiagnosticHandler(e: MouseEvent) {
  const target = e.target as HTMLElement;
  const elementAtPoint = document.elementFromPoint(e.clientX, e.clientY);
  
  console.group('👆 [Diagnostics] Click detected:');
  console.log('Click coordinates:', { x: e.clientX, y: e.clientY });
  console.log('Event target:', {
    tag: target.tagName,
    id: target.id,
    classes: target.className.toString().slice(0, 150),
  });
  
  if (elementAtPoint) {
    const computed = getComputedStyle(elementAtPoint);
    console.log('Element at point (what user clicked on):', {
      tag: elementAtPoint.tagName,
      id: elementAtPoint.id,
      classes: elementAtPoint.className.toString().slice(0, 150),
      zIndex: computed.zIndex,
      position: computed.position,
      pointerEvents: computed.pointerEvents,
    });
    
    // Get DOM path
    const path: string[] = [];
    let current: HTMLElement | null = elementAtPoint as HTMLElement;
    while (current && current !== document.body) {
      const identifier = current.id 
        ? `#${current.id}` 
        : current.className 
          ? `.${current.className.toString().split(' ')[0]}` 
          : current.tagName.toLowerCase();
      path.unshift(identifier);
      current = current.parentElement;
    }
    console.log('DOM path:', path.join(' > '));
    
    // Check if this is a Radix element
    const isRadixElement = elementAtPoint.hasAttribute('data-radix-dialog-overlay') ||
                          elementAtPoint.hasAttribute('data-radix-portal') ||
                          elementAtPoint.closest('[data-radix-dialog-overlay]') ||
                          elementAtPoint.closest('[data-radix-portal]');
    
    if (isRadixElement) {
      console.warn('⚠️ Click is being captured by a Radix element!');
    }
    
    // Check if clicking in sidebar area but element is not sidebar
    const sidebarArea = e.clientX > window.innerWidth - 300; // Assuming RTL, sidebar on right
    const isSidebarElement = elementAtPoint.closest('aside') || 
                             elementAtPoint.closest('[class*="sidebar"]') ||
                             elementAtPoint.closest('nav');
    
    if (sidebarArea && !isSidebarElement) {
      console.error('🚨 PROBLEM: Clicking in sidebar area but element is NOT sidebar!');
      console.error('This element is blocking sidebar clicks:', elementAtPoint);
    }
  }
  
  console.groupEnd();
}

export function stopDiagnostics() {
  document.removeEventListener('click', clickDiagnosticHandler, true);
  console.log('🔍 [Diagnostics] Stopped.');
}

// Utility to release all known interaction locks
export function releaseAllInteractionLocks() {
  console.log('🔓 [Fix] Releasing all interaction locks...');
  
  // Reset HTML
  document.documentElement.style.pointerEvents = '';
  document.documentElement.style.overflow = '';
  document.documentElement.removeAttribute('inert');
  document.documentElement.removeAttribute('aria-hidden');
  document.documentElement.removeAttribute('data-scroll-locked');
  
  // Reset BODY
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  document.body.removeAttribute('inert');
  document.body.removeAttribute('aria-hidden');
  document.body.removeAttribute('data-scroll-locked');
  
  // Reset ROOT
  const root = document.getElementById('root');
  if (root) {
    root.style.pointerEvents = '';
    root.style.overflow = '';
    root.removeAttribute('inert');
    root.removeAttribute('aria-hidden');
    root.removeAttribute('data-scroll-locked');
  }
  
  // Remove any stray Radix overlays
  document.querySelectorAll('[data-radix-dialog-overlay]').forEach((el) => {
    console.log('🔓 [Fix] Removing stray overlay:', el.className);
    el.remove();
  });
  
  console.log('🔓 [Fix] All locks released.');
}
