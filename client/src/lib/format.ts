import type { Priority, Status } from './types';

// The server stores UTC timestamps as 'YYYY-MM-DD HH:MM:SS'.
export function parseTs(s: string | null | undefined): Date | null {
  if (!s) return null;
  return new Date(s.replace(' ', 'T') + 'Z');
}

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export const formatDateTime = (s: string | null | undefined) => {
  const d = parseTs(s);
  return d ? dateTimeFmt.format(d) : '-';
};
export const formatDate = (s: string | null | undefined) => {
  const d = parseTs(s);
  return d ? dateFmt.format(d) : '-';
};
export const formatTime = (s: string | null | undefined) => {
  const d = parseTs(s);
  return d ? timeFmt.format(d) : '';
};

export function timeAgo(s: string | null | undefined) {
  const d = parseTs(s);
  if (!d) return '-';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatDate(s);
}

export function duration(min: number | null | undefined) {
  if (min === null || min === undefined) return '-';
  if (min < 1) return '< 1m';
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 1440) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(min / 1440);
  const h = Math.round((min % 1440) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export const STATUS_LABELS: Record<Status, string> = {
  open: 'Open',
  in_progress: 'In progress',
  awaiting_client: 'Awaiting client',
  resolved: 'Resolved',
  closed: 'Closed',
};
export const PRIORITY_LABELS: Record<Priority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
export const ROLE_LABELS = { admin: 'Admin', agent: 'Agent', technician: 'Technician', client: 'Client' } as const;
export const isStaffRole = (role: string | null | undefined) => role === 'admin' || role === 'agent' || role === 'technician';
export const OPEN_STATUSES: Status[] = ['open', 'in_progress', 'awaiting_client'];

export const initials = (name: string | null | undefined) =>
  String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
