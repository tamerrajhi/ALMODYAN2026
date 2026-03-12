/**
 * Deprecated Purchasing Page - PROMPT 2 REDIRECT
 * 
 * Immediately redirects legacy purchasing routes to the Returns Hub Resolver.
 * No countdown, no UI - just instant redirect.
 */

import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

/**
 * Redirects /purchasing/returns/:id to /purchasing/returns-hub/r/:id
 * This is the ONLY function of this page - no UI shown.
 */
export default function DeprecatedPurchasingPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    // Immediate redirect to Returns Hub Resolver
    if (id) {
      navigate(`/purchasing/returns-hub/r/${id}`, { replace: true });
    } else {
      // No ID provided - go to returns hub list
      navigate('/purchasing/returns-hub', { replace: true });
    }
  }, [navigate, id]);

  // Return null - no UI needed, just redirect
  return null;
}
