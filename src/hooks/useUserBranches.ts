import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useModules } from '@/core/contexts/ModuleContext';
import * as dataGateway from '@/lib/dataGateway';

interface UserBranch {
  id: string;
  branch_id: string;
  branch_name: string;
  branch_code: string;
  branch_type: 'gold' | 'jewelry';
  is_primary: boolean;
}

export function useUserBranches() {
  const { user } = useAuth();
  const { isAdmin } = useModules();

  const { data: userBranches = [], isLoading } = useQuery({
    queryKey: ['user-branches', user?.id, isAdmin],
    enabled: !!user?.id && isAdmin !== undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    queryFn: async () => {
      if (isAdmin) {
        const { data, error } = await dataGateway.fetchBranches();
        
        if (error) throw new Error(error.message);
        
        return (data || [])
          .filter((b: any) => b.is_active)
          .map((b: any) => ({
            id: b.id,
            branch_id: b.id,
            branch_name: b.branch_name || b.name,
            branch_code: b.branch_code || b.code,
            branch_type: (b.branch_type || 'jewelry') as 'gold' | 'jewelry',
            is_primary: false,
          })) as UserBranch[];
      }

      const { data: branchData, error } = await dataGateway.getUserBranches(user!.id);
      
      if (error) throw new Error(error.message);

      return (branchData || []).map((ub: any) => ({
        id: ub.id || ub.branch_id,
        branch_id: ub.branch_id,
        branch_name: ub.branch_name || '',
        branch_code: ub.branch_code || '',
        branch_type: (ub.branch_type || 'jewelry') as 'gold' | 'jewelry',
        is_primary: ub.is_primary || false,
      })) as UserBranch[];
    },
  });

  const primaryBranch = userBranches.find(b => b.is_primary) || userBranches[0] || null;

  return {
    userBranches,
    primaryBranch,
    isLoading,
    isAdmin,
  };
}
