import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { useSession } from '@/hooks/use-session';
import type { ChatGroup, ChatMember, ChatMessage, Message, Presence, ReadReceipt, Role, Ticket } from '@/lib/types';

interface TicketData {
  ticket: Ticket;
  messages: Message[];
  transcripts: unknown[];
  reads?: ReadReceipt[];
}

export interface GroupData {
  group: ChatGroup;
  members: ChatMember[];
  messages: ChatMessage[];
}

interface Realtime {
  connected: boolean;
  presence: Presence | null;
  typingFor: (ticketId: number) => string[];
  sendTyping: (ticketId: number, typing: boolean) => void;
  groupTypingFor: (groupId: number) => string[];
  sendGroupTyping: (groupId: number, typing: boolean) => void;
}

const RealtimeContext = createContext<Realtime>({
  connected: false,
  presence: null,
  typingFor: () => [],
  sendTyping: () => {},
  groupTypingFor: () => [],
  sendGroupTyping: () => {},
});

type TypingMap = Record<number, Record<number, string>>;
const setTypingEntry = (map: TypingMap, key: number, userId: number, name: string | null) => {
  const cur = { ...(map[key] || {}) };
  if (name) cur[userId] = name;
  else delete cur[userId];
  return { ...map, [key]: cur };
};

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user, isStaff } = useSession();
  const qc = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState<Presence | null>(null);
  // ticketId -> userId -> name
  const [typing, setTyping] = useState<TypingMap>({});
  const [groupTyping, setGroupTyping] = useState<TypingMap>({});

  useEffect(() => {
    if (!user) return;
    const socket = io({ withCredentials: true });
    socketRef.current = socket;

    const refreshLists = () => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['counts'] });
      qc.invalidateQueries({ queryKey: ['metrics'] });
      qc.invalidateQueries({ queryKey: ['chats'] });
    };
    const putTicket = (ticket: Ticket) => {
      qc.setQueryData<TicketData>(['ticket', ticket.id], (prev) => (prev ? { ...prev, ticket } : prev));
    };

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', (reason) => {
      setConnected(false);
      // The server closed the connection because the account changed: re-check the session, then reconnect.
      if (reason === 'io server disconnect') {
        qc.invalidateQueries({ queryKey: ['me'] }).then(() => {
          if (qc.getQueryData(['me'])) socket.connect();
        });
      }
    });
    socket.on('presence', (p: Presence) => setPresence(p));
    socket.on('message:new', ({ ticketId, message }: { ticketId: number; message: Message }) => {
      qc.setQueryData<TicketData>(['ticket', ticketId], (prev) =>
        prev && !prev.messages.some((m) => m.id === message.id) ? { ...prev, messages: [...prev.messages, message] } : prev
      );
      if (message.user_id) setTyping((t) => setTypingEntry(t, ticketId, message.user_id!, null));
      // The assistant's analysis depends on the conversation.
      qc.invalidateQueries({ queryKey: ['ai', ticketId] });
      refreshLists();
    });
    socket.on('ticket:update', ({ ticket }: { ticket: Ticket }) => {
      putTicket(ticket);
      qc.invalidateQueries({ queryKey: ['ai', ticket.id] });
      refreshLists();
    });
    socket.on('ticket:new', ({ ticket }: { ticket: Ticket }) => {
      refreshLists();
      if (isStaff && ticket.created_by !== user.id) {
        toast.info(`New ticket #${ticket.id}`, { description: `${ticket.company_name}: ${ticket.subject}` });
      }
    });
    socket.on('ticket:escalated', ({ ticket }: { ticket: Ticket }) => {
      putTicket(ticket);
      refreshLists();
      toast.warning(`Ticket #${ticket.id} escalated`, { description: ticket.subject });
    });
    socket.on('typing', ({ ticketId, userId, name, typing: on }: { ticketId: number; userId: number; name: string; typing: boolean }) => {
      setTyping((t) => setTypingEntry(t, ticketId, userId, on ? name : null));
    });
    socket.on('chat:message', ({ groupId, message }: { groupId: number; message: ChatMessage }) => {
      qc.setQueryData<GroupData>(['group', groupId], (prev) =>
        prev && !prev.messages.some((m) => m.id === message.id) ? { ...prev, messages: [...prev.messages, message] } : prev
      );
      if (message.user_id) setGroupTyping((t) => setTypingEntry(t, groupId, message.user_id!, null));
      qc.invalidateQueries({ queryKey: ['chats'] });
    });
    socket.on('chat:group', ({ groupId }: { groupId: number }) => {
      qc.invalidateQueries({ queryKey: ['chats'] });
      qc.invalidateQueries({ queryKey: ['group', groupId] });
    });
    socket.on('chat:typing', ({ groupId, userId, name, typing: on }: { groupId: number; userId: number; name: string; typing: boolean }) => {
      setGroupTyping((t) => setTypingEntry(t, groupId, userId, on ? name : null));
    });
    // Edited messages replace the old copy in place.
    socket.on('message:updated', ({ ticketId, message }: { ticketId: number; message: Message }) => {
      qc.setQueryData<TicketData>(['ticket', ticketId], (prev) =>
        prev ? { ...prev, messages: prev.messages.map((m) => (m.id === message.id ? message : m)) } : prev
      );
    });
    socket.on('chat:updated', ({ groupId, message }: { groupId: number; message: ChatMessage }) => {
      qc.setQueryData<GroupData>(['group', groupId], (prev) =>
        prev ? { ...prev, messages: prev.messages.map((m) => (m.id === message.id ? message : m)) } : prev
      );
    });
    // "Seen" indicators.
    socket.on('ticket:read', ({ ticketId, userId, name, role, lastReadId }: { ticketId: number; userId: number; name: string; role: Role; lastReadId: number }) => {
      qc.setQueryData<TicketData>(['ticket', ticketId], (prev) => {
        if (!prev) return prev;
        const reads = (prev.reads ?? []).filter((r) => r.user_id !== userId);
        return { ...prev, reads: [...reads, { user_id: userId, name, role, last_read_id: lastReadId }] };
      });
    });
    socket.on('chat:read', ({ groupId, userId, lastReadId }: { groupId: number; userId: number; lastReadId: number }) => {
      qc.setQueryData<GroupData>(['group', groupId], (prev) =>
        prev ? { ...prev, members: prev.members.map((m) => (m.id === userId ? { ...m, last_read_id: lastReadId } : m)) } : prev
      );
    });
    socket.on('notification:new', () => qc.invalidateQueries({ queryKey: ['notifications'] }));
    socket.on('notification:read', () => qc.invalidateQueries({ queryKey: ['notifications'] }));

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [user?.id, isStaff, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  const typingFor = useCallback((ticketId: number) => Object.values(typing[ticketId] || {}), [typing]);
  const sendTyping = useCallback((ticketId: number, on: boolean) => {
    socketRef.current?.emit('typing', { ticketId, typing: on });
  }, []);
  const groupTypingFor = useCallback((groupId: number) => Object.values(groupTyping[groupId] || {}), [groupTyping]);
  const sendGroupTyping = useCallback((groupId: number, on: boolean) => {
    socketRef.current?.emit('chat:typing', { groupId, typing: on });
  }, []);

  return (
    <RealtimeContext.Provider value={{ connected, presence, typingFor, sendTyping, groupTypingFor, sendGroupTyping }}>{children}</RealtimeContext.Provider>
  );
}

export const useRealtime = () => useContext(RealtimeContext);
