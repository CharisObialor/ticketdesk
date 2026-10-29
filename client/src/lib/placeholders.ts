import type { Ticket, User } from './types';

export const PLACEHOLDERS = [
  { key: 'client_name', label: "Client's full name" },
  { key: 'client_first_name', label: "Client's first name" },
  { key: 'company_name', label: 'Client company' },
  { key: 'ticket_id', label: 'Ticket number' },
  { key: 'ticket_subject', label: 'Ticket subject' },
  { key: 'agent_name', label: 'Your name' },
  { key: 'agent_first_name', label: 'Your first name' },
];

const first = (s: string | null | undefined) => String(s || '').trim().split(/\s+/)[0] || '';

// Replaces {{placeholders}} in a saved reply with details from the ticket and the person sending it.
export function fillPlaceholders(text: string, ticket: Ticket, me: User | null) {
  const values: Record<string, string> = {
    client_name: ticket.creator_name || '',
    client_first_name: first(ticket.creator_name),
    company_name: ticket.company_name || '',
    ticket_id: String(ticket.id),
    ticket_subject: ticket.subject,
    agent_name: me?.name || '',
    agent_first_name: first(me?.name),
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => (key in values ? values[key] : m));
}
