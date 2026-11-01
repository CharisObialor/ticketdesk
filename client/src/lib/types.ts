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
  // Which notifications they want, by email and in the bell. Missing categories are on.
  notify_prefs?: Partial<Record<string, { email: boolean; inapp: boolean }>>;
  // Admins only: how often they are reminded about SLA deadlines.
  sla_reminders?: SlaReminders;
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
  workUpload: { maxFiles: number; maxMb: number; maxTotalMb: number };
  // Clients only: their company asks for the site's OM and FSE on each new ticket.
  siteContacts?: boolean;
  sla: { defaults: SlaTargets; companies: Record<string, CompanySla> };
  autoCloseDays: number;
  replyByEmail: boolean;
  sessionIdleMinutes: number;
  mailbox: string | null;
  ai: boolean;
}

// SLA targets in minutes per priority: first response and time to resolve.
export interface SlaTargets {
  response: Record<Priority, number>;
  resolution: Record<Priority, number>;
}

// A fault category from a company's SLA contract, with its priority and (optional) time to resolve.
export interface FaultCategory {
  name: string;
  description: string | null;
  priority: Priority;
  resolution: number | null;
  // Prefilled description for the client, and photos they must attach for this fault.
  template?: string | null;
  photos_min?: number;
}

// A company's own targets; anything left out follows the defaults.
export interface CompanySla {
  response?: Partial<Record<Priority, number>>;
  resolution?: Partial<Record<Priority, number>>;
  categories?: FaultCategory[];
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
  // When the ticket was first assigned: the SLA clocks start here (null while unassigned).
  assigned_at?: string | null;
  // The client's site and site contacts: Operations Manager (OM) and Field Service Engineer (FSE).
  site_id?: number | null;
  site_code?: string | null;
  site_location?: string | null;
  om_name?: string | null;
  om_phone?: string | null;
  fse_name?: string | null;
  fse_phone?: string | null;
}

export interface Attachment {
  id: number;
  message_id: number;
  original_name: string;
  mime: string;
  size: number;
  // Work update photos: taken before or after the work.
  label?: 'before' | 'after' | null;
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
  kind: 'message' | 'system' | 'work_update';
  // Work updates: minutes the engineer spent on the work.
  time_spent_min?: number | null;
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
  // The client confirming the engineer arrived, and signing the job completion certificate (JCC).
  client_confirmed_at?: string | null;
  client_signed_at?: string | null;
  client_signed_name?: string | null;
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

// Minutes between SLA reminders for each kind of breach (0 = no reminders).
export interface SlaReminders {
  response_due: number;
  response_overdue: number;
  resolution_due: number;
  resolution_overdue: number;
  email: boolean;
}

// A field technician on the contact list (not a portal account).
export interface Technician {
  id: number;
  name: string;
  phone: string | null;
  area: string | null;
  notes: string | null;
  is_active: boolean;
}

export interface Site {
  id: number;
  company_id: number;
  code: string;
  location: string | null;
  details: string | null;
  is_active: boolean;
  ticket_count: number;
}

export interface Company {
  id: number;
  name: string;
  // Client contacts who receive the monthly statement.
  statement_recipients?: number[];
  // Asks for the site's OM and FSE on each new ticket.
  site_contacts?: number | boolean;
  email_domain: string | null;
  notes: string | null;
  rc_number: string | null;
  logo_url: string | null;
  sla: CompanySla | null;
  contacts: CompanyContact[];
  is_active: number | boolean;
  created_at: string;
  user_count: number;
  open_tickets: number;
  total_tickets: number;
}

export interface ChatItem {
  // 'team': admin-only chats.
  type: 'group' | 'ticket' | 'team';
  id: number;
  title: string;
  subtitle: string;
  company_name: string | null;
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
  phone?: string | null;
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
  // How clients rated each admin's handling of jobs in the period.
  adminRatings?: { id: number; name: string; ratings: number; avgRating: number; low: number }[];
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
