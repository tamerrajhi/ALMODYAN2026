import { useQuery } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';

export interface Branch {
  id: string;
  branch_code: string;
  branch_name: string;
  address: string | null;
  phone: string | null;
  manager_name: string | null;
  is_active: boolean;
}

export function useBranches(onlyActive = false) {
  return useQuery({
    queryKey: ['branches', { onlyActive }],
    queryFn: async () => {
      const { data, error } = await dataGateway.fetchBranches({ onlyActive });
      if (error) throw new Error(error.message);
      return (data || []).map((b: any) => ({
        ...b,
        branch_name: b.branch_name || b.name,
        branch_code: b.branch_code || b.code,
      })) as Branch[];
    },
  });
}
