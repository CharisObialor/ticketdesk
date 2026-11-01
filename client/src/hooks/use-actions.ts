import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ActionsData } from '@/pages/actions';

// Things staff should act on (sidebar count, dashboard and the Actions page).
export function useActions(enabled = true) {
  return useQuery({ queryKey: ['actions'], queryFn: () => api.get<ActionsData>('/actions'), refetchInterval: 60_000, enabled });
}
