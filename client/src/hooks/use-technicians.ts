import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Technician } from '@/lib/types';

// The field technicians contact list (staff only).
export const useTechnicians = (enabled = true) =>
  useQuery({ queryKey: ['technicians'], queryFn: () => api.get<{ technicians: Technician[] }>('/technicians'), enabled, staleTime: 60_000 });
