export type Role = 'admin' | 'agent' | 'technician' | 'client';
export type Status = 'open' | 'in_progress' | 'awaiting_client' | 'resolved' | 'closed';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  company_id: number | null;
  company_name: string | null;
  company_logo_url: string | null;
  job_title: string | null;
  notify_email: boolean;
  signature: string | null;
  avatar: string | null;
  avatar_url: string | null;
  is_owner: boolean;
  tour_done: boolean;
  is_active: boolean;
  has_password: boolean;
  last_login_at: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export interface AppMeta {
  name: string;
  company: string;
  statuses: { value: Status; label: string }[];
  priorities: Priority[];
  categories: string[];
  upload: { maxMb: number; maxFiles: number };
  mailUpload: { maxTotalMb: number; maxFiles: number };
  slaMinutes: Record<Priority, number>;
  autoCloseDays: number;
  replyByEmail: boolean;
  sessionIdleMinutes: number;
  mailbox: string | null;
  ai: boolean;
}

export interface Ticket {
  id: number;
  company_id: number;
  company_name: string;
  created_by: number | null;
  creator_name: string | null;
  creator_email: string | null;
  assigned_to: number | null;
  assignee_name: string | null;
  subject: string;
  category: string;
  priority: Priority;
  status: Status;
  escalated: number;
  // Sign-off before closing: approvals the current resolution needs (0 when none).
  signoff_required?: number;
  escalation_level: number;
  escalated_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

export interface Attachment {
  id: number;
  message_id: number;
  original_name: string;
  mime: string;
  size: number;
  created_at: string;
}

export interface Message {
  id: number;
  ticket_id: number;
  user_id: number | null;
  user_name: string | null;
  user_role: Role | null;
  body: string;
  is_internal: number;
  kind: 'message' | 'system';
  created_at: string;
  edited_at: string | null;
  attachments: Attachment[];
  cc: string[] | null;
  bcc: string[] | null;
  sender_name: string | null;
  sender_email: string | null;
}

export interface ReadReceipt {
  user_id: number;
  name: string;
  role: Role;
  last_read_id: number;
}

export interface Rating {
  ticket_id: number;
  user_id: number | null;
  user_name: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

export type VisitStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface Visit {
  id: number;
  ticket_id: number;
  technician_id: number | null;
  technician_name: string | null;
  technician_phone?: string | null;
  scheduled_at: string;
  duration_min: number;
  location: string | null;
  notes: string | null;
  status: VisitStatus;
  report: string | null;
  signed_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  ticket_subject?: string;
  company_name?: string;
  company_id?: number;
  requester_name?: string | null;
}

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: number;
  created_at: string;
}

export interface SavedReply {
  id: number;
  title: string;
  body: string;
  is_shared: number | boolean;
  created_by: number | null;
  created_by_name: string | null;
  updated_at: string;
}

export interface Transcript {
  id: number;
  ticket_id: number;
  filename: string;
  size: number;
  message_count: number;
  reason: string;
  created_at: string;
  created_by_name: string | null;
  subject?: string;
  company_name?: string;
}

export interface CompanyContact {
  id: number;
  name: string;
  email: string;
  job_title: string | null;
  phone: string | null;
  is_active: boolean;
}

export interface Company {
  id: number;
  name: string;
  email_domain: string | null;
  notes: string | null;
  rc_number: string | null;
  logo_url: string | null;
  contacts: CompanyContact[];
  is_active: number | boolean;
  created_at: string;
  user_count: number;
  open_tickets: number;
  total_tickets: number;
}

export interface ChatItem {
  type: 'group' | 'ticket';
  id: number;
  title: string;
  subtitle: string;
  company_name: string;
  last_at: string;
  last_body: string | null;
  last_kind: 'message' | 'system' | null;
  last_user: string | null;
  unread: number;
  is_member: boolean;
  status?: Status;
  escalated?: boolean;
}

export interface ChatGroup {
  id: number;
  company_id: number;
  company_name: string;
  name: string;
  created_by: number | null;
  created_at: string;
  last_message_at: string;
  is_member: boolean;
  can_manage: boolean;
}

export interface ChatMember {
  id: number;
  name: string;
  email: string;
  role: Role;
  joined_at: string;
  last_read_id: number;
}

export interface ChatMessage {
  id: number;
  group_id: number;
  user_id: number | null;
  user_name: string | null;
  user_role: Role | null;
  body: string;
  kind: 'message' | 'system';
  created_at: string;
  edited_at: string | null;
  attachments: Attachment[];
}

export interface StaffMember {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface Counts {
  open: number;
  mine: number;
  unassigned: number;
  escalated: number;
}

export interface Presence {
  total: number;
  staff: number;
  clients: number;
  users: { id: number; name: string; role: Role; company_name: string | null }[];
}

export interface Metrics {
  days: number;
  weekly: boolean;
  kpis: {
    raised: number;
    resolved: number;
    open: number;
    escalatedOpen: number;
    escalationsInPeriod: number;
    unassigned: number;
    urgentOpen: number;
    avgFirstResponseMin: number | null;
    medianFirstResponseMin: number | null;
    avgResolutionMin: number | null;
    slaMet: number;
    slaMissed: number;
    messages: number;
    ratings: number;
    csatPct: number | null;
    avgRating: number | null;
  };
  ratingBreakdown: { rating: number; total: number }[];
  recentRatings: { ticket_id: number; rating: number; comment: string | null; updated_at: string; user_name: string | null; company_name: string; subject: string }[];
  status: Partial<Record<Status, number>>;
  series: { key: string; created: number; resolved: number }[];
  byPriority: { name: Priority; total: number }[];
  byCategory: { name: string; total: number }[];
  byCompany: { name: string; total: number }[];
  agents: {
    id: number;
    name: string;
    role: Role;
    online: boolean;
    last_seen_at: string | null;
    open: number;
    escalated: number;
    resolved: number;
    avgRating: number | null;
  }[];
  online: Presence;
  recent: Ticket[];
}

export interface SignoffState {
  active: boolean;
  required?: number;
  approvals?: { user_id: number; name: string; comment: string | null; created_at: string }[];
  requestedBy?: { id: number; name: string } | null;
  requestedAt?: string;
}
