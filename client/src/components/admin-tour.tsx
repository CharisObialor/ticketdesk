import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Check, Lightbulb, ListOrdered, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useSession } from '@/hooks/use-session';
import { api } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/utils';
import type { AppMeta, User } from '@/lib/types';

import { TOUR_START_EVENT as START_EVENT } from '@/lib/tour';

interface Step {
  title: string;
  route?: string;
  // Matches a data-tour="..." attribute on the element to highlight.
  target?: string;
  body: ReactNode;
}

const P = ({ children }: { children: ReactNode }) => <p>{children}</p>;
const List = ({ items }: { items: ReactNode[] }) => (
  <ul className="list-disc space-y-1.5 pl-5 marker:text-muted-foreground">
    {items.map((item, i) => (
      <li key={i}>{item}</li>
    ))}
  </ul>
);
const Tip = ({ children }: { children: ReactNode }) => (
  <div className="flex gap-2.5 rounded-lg border bg-muted/50 p-3 text-sm">
    <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />
    <div>{children}</div>
  </div>
);
const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-foreground">{children}</strong>;

function duration(minutes: number) {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (minutes < 1440) return `${+(minutes / 60).toFixed(1)} hour${minutes === 60 ? '' : 's'}`;
  return `${+(minutes / 1440).toFixed(1)} day${minutes === 1440 ? '' : 's'}`;
}

function buildSteps(user: User, app: AppMeta | null): Step[] {
  const first = user.name.split(' ')[0];
  const sla = app?.sla.defaults.response ?? { urgent: 60, high: 240, normal: 1440, low: 2880 };
  const upload = app?.upload ?? { maxMb: 10, maxFiles: 5 };
  const messageTotal = app?.messageUpload?.maxTotalMb ?? 200;
  const chat = app?.chat ?? { editMinutes: 15, deleteMinutes: 60 };
  const idle = app?.sessionIdleMinutes ?? 30;
  const owner = user.is_owner;

  const steps: Step[] = [
    {
      title: `Welcome aboard, ${first}`,
      body: (
        <>
          <P>
            You've just been made an <B>admin</B> on the {BRAND.company} support portal. Nice. This is where our clients raise
            issues, where we sort them out, and where we keep an eye on how well we're doing it.
          </P>
          <P>
            This walkthrough covers everything: every page, what each button is for, and a few things that aren't obvious until
            someone tells you. Give it about 10 minutes. I'll open each page as we go so you can see it for real.
          </P>
          <List
            items={[
              <>Use <B>Next</B> and <B>Back</B> (or your arrow keys) to move along.</>,
              <>The <B>Contents</B> button jumps straight to any topic.</>,
              <>Busy? Hit <B>Skip</B>. You can replay all of this later from your name at the bottom of the sidebar, then <B>Platform tour</B>.</>,
            ]}
          />
        </>
      ),
    },
    {
      title: 'Finding your way around',
      target: 'sidebar',
      body: (
        <>
          <P>Everything lives in the sidebar on the left. Top to bottom:</P>
          <List
            items={[
              <><B>New ticket</B>: log an issue on a client's behalf.</>,
              <><B>Actions</B>: your smart to-do list (admins only, more on this soon).</>,
              <><B>Mail</B>: your own Microsoft 365 mailbox, inside the portal.</>,
              <><B>Messages</B>: every chat you're part of, tickets and groups.</>,
              <><B>Dashboard</B>: the numbers.</>,
              <><B>Tickets</B>: quick views of the ticket queue, with live counts.</>,
              <><B>Field and team</B>: site visits, saved replies and the technicians contact list.</>,
              <><B>Administration</B>: companies (with their sites and SLAs), reports, users, transcripts and system health.</>,
            ]}
          />
          <P>
            Up top you'll see a small dot. Green means you're connected live, and it shows how many people are online right now.
            Next to it is the notification bell.
          </P>
          <Tip>
            Press <B>Ctrl + B</B> (or Cmd + B on a Mac) to collapse the sidebar to icons and get more room. On a phone, it hides
            behind the menu button at the top left.
          </Tip>
        </>
      ),
    },
    {
      title: 'Who can do what',
      body: (
        <>
          <P>There are four kinds of account, and it helps to know who sees what:</P>
          <List
            items={[
              <><B>Admin</B> (you): everything. Tickets, all the admin pages, Actions, your Mail and the System page.</>,
              <><B>Agent</B>: our support staff. Same ticket tools as you, plus the dashboard, but no Mail, Actions or System.</>,
              <><B>Technician</B>: our field engineers. For now they don't use the portal: they're kept on the <B>Technicians</B> contact list, and jobs reach them by WhatsApp or text.</>,
              <><B>Client</B>: people at our client companies. They only ever see their own company's tickets and chats, and never see internal notes. They get a <B>Home</B> page (open tickets, visits, what's waiting on them), their <B>Sites</B>, and a <B>Performance</B> page with their SLA results. They confirm when an engineer arrives and sign the job completion certificate (JCC) on screen.</>,
            ]}
          />
          <P>
            Clients never see our engineers' names or phone numbers. Whoever handles a ticket shows to them as <B>DateHeight Support</B>, and
            work updates as <B>DateHeight engineer</B>.
          </P>
          <Tip>
            Admin accounts are special: only the portal owner can create admins or edit them. If you need someone promoted to
            admin, ask them.
          </Tip>
        </>
      ),
    },
    {
      title: 'The ticket queue',
      route: '/tickets?view=open',
      target: 'nav-tickets',
      body: (
        <>
          <P>This is the heart of the place. Every client issue is a ticket. The views in the sidebar slice the queue for you:</P>
          <List
            items={[
              <><B>All open</B>: everything that still needs work.</>,
              <><B>Assigned to me</B>: your personal pile.</>,
              <><B>Unassigned</B>: nobody's picked these up yet. Keep this at zero if you can.</>,
              <><B>Escalated</B>: tickets flagged as needing extra attention.</>,
              <><B>Resolved</B>: done and dusted.</>,
            ]}
          />
          <P>
            The little numbers next to each view update on their own. On the list itself you can search and filter by company,
            status and priority, and click any row to open it.
          </P>
          <P>
            Keep an eye on the two SLA columns. <B>Response SLA</B> counts down to the time we promised to reply by, and
            <B> Resolution SLA</B> to the time we promised to fix it by. Both turn red when we're late.
          </P>
        </>
      ),
    },
    {
      title: 'Statuses, priorities and our promises',
      body: (
        <>
          <P>Every ticket moves through these statuses:</P>
          <List
            items={[
              <><B>Open</B>: just arrived.</>,
              <><B>In progress</B>: someone's working on it.</>,
              <><B>Awaiting client</B>: ball's in their court (we asked them something).</>,
              <><B>Resolved</B>: fixed and <B>signed off</B>. When anyone marks a ticket resolved, it stays as it is while the other admins are asked to check it. Once two of them approve, it becomes Resolved, the resolution time is recorded, and the client gets an email asking them to rate us. Anyone can send it back with a reason instead.</>,
              <><B>Closed</B>: finished. Resolved tickets close by themselves after a few quiet days, or an admin can close them.</>,
            ]}
          />
          <P>Priority decides how fast we've promised to respond (our default SLA):</P>
          <List
            items={[
              <><B>Urgent</B>: within {duration(sla.urgent)}</>,
              <><B>High</B>: within {duration(sla.high)}</>,
              <><B>Normal</B>: within {duration(sla.normal)}</>,
              <><B>Low</B>: within {duration(sla.low)}</>,
            ]}
          />
          <P>
            Both clocks start when the ticket is <B>assigned</B>, so assign new tickets promptly. Clients can request escalation
            only once the time to resolve has passed without a fix, and only our team can mark a ticket resolved.
          </P>
          <P>
            There's also a <B>time to resolve</B> for each priority. Admins set the defaults on the System page, and a company with
            its own contract can have its own times and <B>fault categories</B> (Pan African Towers does: each fault, like ATS or
            Metering, has its own priority and time to resolve).
          </P>
          <Tip>
            If a client replies to a resolved ticket, it springs back to life, so nothing gets lost. Sign-offs waiting on you show up in
            your Actions list, and you can't sign off a ticket you resolved yourself.
          </Tip>
        </>
      ),
    },
    {
      title: 'Working a ticket',
      body: (
        <>
          <P>Open any ticket and you'll get the full conversation on the left and the details panel on the right. Here's what you can do in there:</P>
          <List
            items={[
              <><B>Reply</B> to the client. They get an email too, sent from your own address and signed with your signature.</>,
              <><B>Internal note</B>: flip the reply box to a note to talk to the team. Clients never see these, ever.</>,
              <><B>Attach files</B>: as many as you need, up to {upload.maxMb} MB each and {messageTotal} MB per reply. Big photos get optimised automatically. Pictures, PDFs, video and audio open in a preview right on the page.</>,
              <><B>CC and BCC</B>: loop other people into the email of a reply (admins only).</>,
              <><B>Saved replies</B>: drop in a ready-made answer instead of typing it out again.</>,
              <><B>Edit</B> your own messages if you made a typo. Everyone will see it was edited.</>,
              <>Little <B>Seen</B> markers show when the other side has read your message.</>,
              <>In the details panel, change the <B>status</B>, <B>priority</B>, <B>category</B> and <B>assignee</B>. It also shows the site, the client's OM and FSE, and both SLA clocks.</>,
              <><B>Message engineer</B>: drafts a job message from the ticket (site, fault, OM and FSE, resolve-by time). Pick a technician and send it by WhatsApp or text, or copy it. The ticket records who it went to.</>,
              <><B>Work update</B>: record what was done, the time spent, and up to 40 before and after photos. The client sees it from "DateHeight engineer". Tick <B>mark resolved</B> to finish in one go.</>,
              <><B>Escalate</B> with a reason when something needs more attention, and de-escalate when it's under control.</>,
              <><B>Schedule a site visit</B> when someone needs to go on site.</>,
              <><B>Download the conversation</B> (HTML, text or JSON, with or without internal notes), or save a transcript to the archive.</>,
              ...(owner ? [<><B>Delete</B> (you, as the portal owner): removes a ticket for good, with its messages and files. You type a word to confirm, and it cannot be undone.</>] : []),
            ]}
          />
          {app?.ai && <Tip>There's a built-in assistant on tickets too. It can draft a reply for you. It always lands in the reply box for you to check, and it never sends anything on its own.</Tip>}
        </>
      ),
    },
    {
      title: 'Raising a ticket for a client',
      route: '/tickets/new',
      target: 'nav-new',
      body: (
        <>
          <P>
            Clients usually raise their own tickets, but when someone calls or messages you directly, log it here so it's
            tracked properly.
          </P>
          <List
            items={[
              <>Pick the <B>company</B> and then the <B>requester</B> (the person at that company it's for).</>,
              <>Choose the <B>Site ID</B> from the company's site list. Type to search; companies can have hundreds of sites.</>,
              <>For Pan African Towers, the <B>OM</B> and <B>FSE</B> (name and phone) are required, and the <B>fault category</B> sets the priority and the time to resolve.</>,
              <>Give it a short, clear <B>subject</B>, and the full story in the details: what happened, what they expected, steps to reproduce.</>,
              <>Otherwise set the <B>category</B> and <B>priority</B>. Priority starts the SLA clock, so be honest with it.</>,
              <>Attach screenshots or documents if you have them.</>,
            ]}
          />
          <P>The client gets an email confirming the ticket, and they can follow it from their own login.</P>
        </>
      ),
    },
    {
      title: 'Email in, email out',
      body: (
        <>
          <P>Clients don't have to log in to stay in the loop. Here's the email side of things:</P>
          <List
            items={[
              <>Clients get tidy emails when a ticket is created, updated, resolved or closed, with a progress tracker showing where it's at.</>,
              app?.replyByEmail ? (
                <><B>Reply by email is on</B>: when a client replies to one of those emails, the reply lands on the ticket automatically.</>
              ) : (
                <><B>Reply by email is off</B> right now, so clients need to reply from the portal. Its status is on the System page.</>
              ),
              <>When a ticket is resolved, the client gets a quick star rating request, and can also rate each admin who handled the job. You're told when you're rated, and every admin hears about a low score.</>,
              <>New accounts get a welcome email with a link to set their password.</>,
              <>Unread chat messages get rounded up into a summary email after a short while, so nobody misses anything.</>,
              <>Emails you trigger (replies, assignments) go out from your own address. Automatic ones nobody sent by hand (reminders, SLA alerts, chat summaries, statements, account emails) come from the <B>systems@</B> mailbox when it's set up, and from the support mailbox otherwise. The System page shows which.</>,
            ]}
          />
          <Tip>Your email signature goes on everything you send. Set it up on your Profile page (we'll get there at the end).</Tip>
        </>
      ),
    },
    {
      title: 'Messages',
      route: '/messages',
      target: 'nav-messages',
      body: (
        <>
          <P>Messages is your chat inbox. It pulls together two kinds of conversation:</P>
          <List
            items={[
              <><B>Ticket conversations</B>: the same thread you see on the ticket, in chat form. You can post internal notes from here too.</>,
              <><B>Group chats</B>: ongoing conversations with a company. Clients can start groups with their colleagues, and every group must include at least one admin, so we're always in the room.</>,
            ]}
          />
          <List
            items={[
              <>Start a group with <B>New group</B>, then add people, rename it, or leave it from the members list.</>,
              <>Use the search box to find any conversation, or any message inside one.</>,
              <>Unread chats show a count in the sidebar, and messages appear live.</>,
              <><B>Admin chat</B>: message other admins privately, one to one or in a group. Only admins see these. Direct chats show the other admin's picture; groups show our logo, and client conversations show the company's logo.</>,
              <>Your messages sit on the right, everyone else's on the left, files included. Scrolled up to read? A button takes you back to the latest.</>,
            ]}
          />
        </>
      ),
    },
    {
      title: 'Chatting: tags, replies and reactions',
      route: '/messages',
      body: (
        <>
          <P>Group chats and admin chats have the tools you'd expect from a messaging app:</P>
          <List
            items={[
              <><B>Tag someone</B>: type <B>@</B> and pick a name from the list. Their name turns blue in the message box, and they get a bell notification (and an email, by their settings). Clients can tag us too.</>,
              <><B>Files</B>: attach as many as you like, up to {upload.maxMb} MB each and {messageTotal} MB per message. Pictures, video, audio and PDFs preview right in the chat.</>,
              <>Hover over any message and click the small arrow beside it for the message menu (on a phone, it's always there):</>,
            ]}
          />
          <List
            items={[
              <><B>React</B> with one of the quick six, or <B>+</B> for the full list. Your most used ones come first. Click a reaction under a message to add yours or take it back.</>,
              <><B>Reply</B> to a specific message. Your reply shows a preview of it, and clicking the preview jumps back to the original.</>,
              <><B>Copy</B> the text, or <B>Forward</B> the message (files and all) to up to 10 other chats.</>,
              <><B>Pin</B> up to 3 important messages. They sit in a bar at the top of the chat, and clicking it jumps to each one.</>,
              <><B>Edit</B> your own message within {duration(chat.editMinutes)} of sending it.</>,
              <><B>Delete for me</B> hides a message from your view only. <B>Delete for everyone</B> works on your own messages within {duration(chat.deleteMinutes)}, and leaves "This message was deleted" in its place.</>,
            ]}
          />
          <Tip>Esc cancels a reply you've started, and Shift + Enter adds a new line instead of sending.</Tip>
        </>
      ),
    },
    {
      title: 'The notification bell',
      target: 'bell',
      body: (
        <>
          <P>
            The bell at the top right collects anything that needs your attention: new tickets, replies, assignments,
            escalations, visit updates and reminders.
          </P>
          <P>Click one to jump straight to it (that marks it read), or hit <B>Mark all read</B> to clear the lot.</P>
        </>
      ),
    },
    {
      title: 'Actions: your smart to-do list',
      route: '/actions',
      target: 'nav-actions',
      body: (
        <>
          <P>
            This is one of the most useful pages you've got. The portal watches everything and tells you what needs doing,
            ranked from urgent to low. Things like:
          </P>
          <List
            items={[
              <>Tickets about to miss (or already past) their response time.</>,
              <>Tickets nobody's picked up, and escalations nobody's touched.</>,
              <>Clients waiting on us for a reply, or tickets where the client has gone quiet.</>,
              <>Site visits with no report written up.</>,
              <>Low star ratings that deserve a follow-up call.</>,
              <>New users who haven't activated their accounts yet.</>,
              <>Team members with too many open tickets.</>,
              <>System trouble: failed emails, a missed backup, reply by email not working.</>,
            ]}
          />
          <P>
            Many have a one-click fix right there (like assigning a ticket to whoever's least busy, or resending an invite).
            Not ready to deal with one? Use <B>Remind me</B> (tomorrow morning or next week), or <B>Dismiss</B> it with a reason.
          </P>
          <Tip>
            You'll be reminded in three ways: an email straight away for urgent items, the red and orange badge on Actions in the
            sidebar, and a daily summary email each morning. You choose how often the bell reminds you about each kind of SLA
            breach (due soon or overdue, for response and for resolution) under <B>SLA reminders</B> on your Profile.
          </Tip>
        </>
      ),
    },
  ];

  if (app?.mailbox) {
    steps.push({
      title: 'Your mailbox',
      route: '/mail',
      target: 'nav-mail',
      body: (
        <>
          <P>
            This is your own work mailbox (<B>{app.mailbox}</B>), right inside the portal. Only you can see it. Other admins see
            their own mailboxes, never yours. Shared mailboxes you've been given access to in Microsoft 365 (like info@ or
            systems@) show up underneath, and you can send from them too.
          </P>
          <List
            items={[
              <>Read your inbox, plus sent items and other folders.</>,
              <><B>Reply</B>, <B>Reply all</B>, <B>Forward</B>, or write a brand new email.</>,
              <>Add <B>CC</B> and <B>BCC</B>, and attach files up to {app.mailUpload.maxTotalMb} MB per email.</>,
              <>Format like you would in Word: fonts, sizes, colours, highlights, lists, alignment, links and pictures. Ctrl+Enter sends.</>,
              <>Archive, flag, move to junk, print, or download any email. Hover over an email in the list for quick actions.</>,
              <>Keyboard fans: <B>c</B> new, <B>r</B> reply, <B>a</B> reply all, <B>f</B> forward, <B>e</B> archive, <B>#</B> delete, <B>j</B>/<B>k</B> to move up and down.</>,
              <>Deleting moves the email to Deleted Items, just like in Outlook.</>,
              <>Your signature is added for you.</>,
            ]}
          />
          <Tip>It's the same mailbox as Outlook, so anything you do here shows up there too, and the other way round.</Tip>
        </>
      ),
    });
  }

  steps.push(
    {
      title: 'The dashboard',
      route: '/dashboard',
      target: 'nav-dashboard',
      body: (
        <>
          <P>This is how we know if we're doing a good job. At the top:</P>
          <List
            items={[
              <><B>Tickets raised</B> and <B>resolved</B>, what's <B>open now</B>, <B>unassigned</B> and <B>escalated</B>.</>,
              <><B>Average first response</B> and <B>average resolution time</B>.</>,
            ]}
          />
          <P>Further down:</P>
          <List
            items={[
              <><B>Raised vs resolved</B> over time. If the raised line keeps beating resolved, the queue is growing.</>,
              <>Breakdowns by priority and category, plus the <B>top companies</B> by ticket count.</>,
              <><B>SLA compliance</B>: how often we responded on time.</>,
              <><B>Customer satisfaction</B> from star ratings, with the latest feedback, and how clients rated each admin's handling of their jobs.</>,
              <><B>Team workload</B>: who's carrying what.</>,
              <>Recent activity and the most recently updated tickets.</>,
            ]}
          />
          <Tip>
            Use the period picker at the top right to look at the last 7, 30 or 90 days or 12 months, or pick
            <B> Custom range</B> to choose exact dates on the calendar.
          </Tip>
        </>
      ),
    },
    {
      title: 'Site visits',
      route: '/visits',
      target: 'nav-site-visits',
      body: (
        <>
          <P>When something needs fixing in person, we book a site visit. Here's how they work:</P>
          <List
            items={[
              <>Schedule a visit from the ticket's page. Pick a technician, the date on the calendar and the time, and a location. The client is notified.</>,
              <>On the day, the technician hits <B>Start visit</B>, and <B>Complete visit</B> when they're done.</>,
              <>The visit report covers what they found and did, parts used, any follow-up, photos, and the client's name and signature to sign off.</>,
              <>Cancelling a visit lets the client know too.</>,
            ]}
          />
          <P>This page lists upcoming visits, your own visits, and completed or cancelled ones.</P>
          <Tip>A visit marked done without a report shows up in Actions, so nothing slips.</Tip>
        </>
      ),
    },
    {
      title: 'Saved replies',
      route: '/saved-replies',
      target: 'nav-saved-replies',
      body: (
        <>
          <P>Typing the same answer for the hundredth time? Save it once, use it forever.</P>
          <List
            items={[
              <>Create replies for the things we get asked a lot: password resets, how-tos, standard updates.</>,
              <>Use placeholders like <code className="rounded bg-muted px-1">{'{{client_first_name}}'}</code> and they're filled in automatically.</>,
              <>Keep a reply to yourself, or tick <B>Share with the team</B> so everyone can use it.</>,
              <>Insert them from the <B>Saved replies</B> button on any ticket's reply box.</>,
            ]}
          />
        </>
      ),
    },
    {
      title: 'Technicians',
      route: '/technicians',
      target: 'nav-technicians',
      body: (
        <>
          <P>Our field technicians' names and numbers. They don't sign in to the portal; this is the list we send jobs to.</P>
          <List
            items={[
              <>Add technicians one at a time, or <B>Paste list</B> straight from a spreadsheet (name, phone, area, notes).</>,
              <>Tap a number to call, or the WhatsApp icon to chat.</>,
              <>Mark someone <B>inactive</B> to stop offering them for jobs without losing their details.</>,
              <>Agents can see the list; only admins can change it. Clients never see it.</>,
            ]}
          />
          <Tip>Use <B>Message engineer</B> on a ticket to send a technician the job.</Tip>
        </>
      ),
    },
    {
      title: 'Companies',
      route: '/companies',
      target: 'nav-companies',
      body: (
        <>
          <P>Every client organisation we support lives here.</P>
          <List
            items={[
              <>Add a company, with its <B>email domain</B> (like example.com) so emails from their people are recognised.</>,
              <>Upload the company's <B>logo</B> and record its <B>RC number</B> (its CAC registration). The logo shows up next to the company across the portal.</>,
              <>Click a company to open its details: everyone registered there, their positions, and clickable email and phone links, plus <B>Email everyone</B> to write to the whole company at once.</>,
              <>Keep <B>internal notes</B> on a company: contract details, quirks, who to call. Clients never see these.</>,
              <>See each company's open and total tickets and how many users they have.</>,
              <>Disable a company to cut off access for everyone there at once, and re-enable it any time.</>,
              <><B>Edit SLA</B> sets a company's own response and resolution times, and its fault categories.</>,
              <><B>Sites</B>: each company's site IDs, locations and details. Add them one by one or paste a whole list straight from a spreadsheet; pasting again updates the addresses of Site IDs already there. Clients pick the site when they log a ticket.</>,
              <>Turn on <B>Ask for OM and FSE</B> (in Edit company) to make every ticket for that company carry the site's Operations Manager and Field Service Engineer.</>,
              <><B>Monthly statement</B>: choose which of the company's people get last month's figures by email on the 1st, or send it now.</>,
              <>In <B>Edit SLA</B>, each fault category can carry a <B>template</B> (what the client should describe) and a number of <B>required photos</B>.</>,
              ...(owner ? [<><B>Delete company</B> (owner only): shows what would go with it (people, tickets, sites) before anything is removed. Disabling is usually enough.</>] : []),
            ]}
          />
        </>
      ),
    },
    {
      title: 'Company reports',
      route: '/reports',
      target: 'nav-reports',
      body: (
        <>
          <P>
            Got a client review coming up, or just want to know how an account is really going? Pick a company and a period
            (any preset, or exact dates on the calendar) and you get the full story in one page:
          </P>
          <List
            items={[
              <>Tickets raised, resolved and still open, with the trend over time.</>,
              <>How fast we responded and resolved, and how often we hit our response and resolution promises.</>,
              <>Satisfaction scores and what the client actually said.</>,
              <>Breakdowns by priority, category, who raised what, and who on our team handled it.</>,
              <>Site visits, their people (with positions), and every ticket in the period.</>,
            ]}
          />
          <Tip>
            <B>Print or save PDF</B> gives you a clean document to send, and <B>Export CSV</B> opens in Excel. You can also jump
            here from a company's details with <B>Generate report</B>.
          </Tip>
        </>
      ),
    },
    {
      title: 'Users',
      route: '/users',
      target: 'nav-users',
      body: (
        <>
          <P>Everyone who can sign in: our team and client contacts.</P>
          <List
            items={[
              <>Add a client contact (attached to their company), an agent or a technician.</>,
              <>Give everyone a <B>position</B> (IT Manager, Head of Operations and so on) so you know who you're dealing with at each company. People can update their own on their Profile.</>,
              <>New people get a welcome email with a link to set their own password. If they lose it, you can resend the invite.</>,
              <>Turn someone's <B>email notifications</B> on or off, or <B>disable</B> an account when they leave. Their history stays.</>,
              <>Filter by company, role or status, or search by name or email.</>,
              <>A green dot on someone's picture means they're <B>online</B> right now. Otherwise you'll see when they were last seen.</>,
              ...(owner ? [<><B>Delete permanently</B> (owner only): removes someone's account completely. Usually <B>disable</B> is the better choice, since it keeps their history.</>] : []),
            ]}
          />
          <Tip>Remember: only the portal owner can create or edit admin accounts. You'll see their account marked Owner.</Tip>
        </>
      ),
    },
    {
      title: 'Transcripts',
      route: '/transcripts',
      target: 'nav-transcripts',
      body: (
        <>
          <P>
            The archive. When a ticket conversation is saved as a transcript, a permanent copy lands here. Handy for records,
            disputes or handovers.
          </P>
          <List items={[<>Search by subject, company or ticket number.</>, <>Download any transcript to keep or share.</>]} />
        </>
      ),
    },
    {
      title: 'System',
      route: '/system',
      target: 'nav-system',
      body: (
        <>
          <P>The engine room. You won't need it every day, but it's good to know what's here:</P>
          <List
            items={[
              <><B>Email outbox</B>: every email the portal sends goes through here. If one fails (say the internet blips), it's retried automatically for hours. You can also requeue failed ones by hand.</>,
              <><B>Default SLA times</B>: the response and resolution times for each priority, used by every company without its own.</>,
              <><B>Escalation rules</B>: when tickets escalate on their own (no first reply in time, past the time to resolve, or gone quiet), to which level, who is alerted, and whether to raise the priority or assign it.</>,
              <><B>Backups</B>: the whole portal is backed up every night. You can see recent backups and run one now.</>,
              <><B>Automatic housekeeping</B>: auto-close for resolved tickets, the unread message summary emails, and the inactivity sign-out.</>,
              <><B>Reply by email</B> and <B>outgoing email</B> status, so you can see straight away whether mail is flowing, and whether automatic emails are going out from systems@.</>,
              ...(owner ? [<><B>Clear all tickets</B> (owner only): wipes every ticket and its figures and starts numbering again at #1. A backup is taken first, and you have to type a phrase to confirm.</>] : []),
            ]}
          />
          <Tip>If something goes wrong here, Actions will tell you anyway, so you don't need to check this page daily.</Tip>
        </>
      ),
    },
    {
      title: 'Make it yours',
      route: '/profile',
      target: 'user-menu',
      body: (
        <>
          <P>Last stop, your Profile page (also under your name at the bottom of the sidebar). Worth doing now:</P>
          <List
            items={[
              <>Pick an <B>avatar</B>. There are 60 to choose from, or stick with your initials.</>,
              <>Set your <B>email signature</B>. It goes on ticket replies and emails from your mailbox.</>,
              <>Choose your <B>SLA reminders</B>: how often you're reminded about tickets at risk, and whether by email too.</>,
              <>Turn on <B>notifications on this device</B> for pop-ups on your computer or phone (on iPhone, add the portal to your Home Screen first). While you have the portal open, updates come to the bell instead of your email; email only follows if you've been away for half an hour.</>,
              <>Pick a <B>text size</B> that suits you: smaller fits more on screen, larger is easier on the eyes. It's saved per device, so your phone and laptop can each have their own.</>,
              <>Add your <B>phone number</B>, and decide whether you want <B>email notifications</B>.</>,
              <>Change your <B>password</B>: we email you a one-time code to confirm it's you. It needs to be a strong one, and the checklist tells you what's missing.</>,
            ]}
          />
          <P>Light or dark mode lives in the same menu as your name, under <B>Theme</B>.</P>
        </>
      ),
    },
    {
      title: 'A few last things',
      body: (
        <>
          <List
            items={[
              <><B>Security</B>: you're signed out after {idle} minutes of doing nothing. You'll get a warning first, and one click keeps you in. Never share your login, and sign out on shared computers.</>,
              <><B>On your phone</B>: the portal works great on mobile, and you can install it like an app. Look for <B>Install app</B> in your menu, or "Add to Home screen" in your browser.</>,
              <><B>Everything's live</B>: new messages, ticket changes and counts update without refreshing.</>,
              <><B>Lost?</B> Replay this tour any time from your name at the bottom of the sidebar, then <B>Platform tour</B>.</>,
            ]}
          />
          <P>
            That's the lot. Start with your Actions list, pick an avatar, set your signature, and you're off. Welcome to the
            team, {first}.
          </P>
        </>
      ),
    }
  );
  return steps;
}

function useTargetRect(target: string | undefined) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useEffect(() => {
    setRect(null);
    if (!target) return;
    // Polled briefly so the highlight follows pages that are still loading and the sidebar as it scrolls.
    const measure = () => {
      const el = document.querySelector(`[data-tour="${target}"]`);
      const r = el?.getBoundingClientRect();
      const next = r && r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      setRect((prev) =>
        prev && next && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height ? prev : next
      );
    };
    const el = document.querySelector(`[data-tour="${target}"]`);
    el?.scrollIntoView({ block: 'nearest' });
    measure();
    const id = window.setInterval(measure, 250);
    return () => window.clearInterval(id);
  }, [target]);
  return rect;
}

// A guided walkthrough of the whole portal. Opens on its own the first time a new admin signs in.
export function AdminTour() {
  const { user, app, isAdmin, setUser } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const steps = useMemo(() => (user ? buildSteps(user, app) : []), [user, app]);
  const step = steps[index];
  const rect = useTargetRect(open ? step?.target : undefined);

  useEffect(() => {
    if (isAdmin && user && !user.tour_done) setOpen(true);
  }, [isAdmin, user]);

  useEffect(() => {
    const start = () => {
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(START_EVENT, start);
    return () => window.removeEventListener(START_EVENT, start);
  }, []);

  useEffect(() => {
    if (!open || !step?.route) return;
    if (location.pathname + location.search !== step.route) navigate(step.route);
    // Only follow the tour's own step changes, not the reader clicking around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  const close = useCallback(
    async (finished: boolean) => {
      setOpen(false);
      if (!finished) toast('Tour closed', { description: 'Replay it any time from your name at the bottom of the sidebar.' });
      if (user && !user.tour_done) {
        try {
          const res = await api.post<{ user: User }>('/auth/tour', {});
          setUser(res.user);
        } catch {
          // Not critical: the tour simply offers itself again next time.
        }
      }
    },
    [user, setUser]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return;
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, steps.length - 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, steps.length]);

  if (!open || !step) return null;
  const last = index === steps.length - 1;

  return (
    <>
      {rect && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[60] rounded-lg ring-2 ring-primary transition-all duration-300"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.35)',
          }}
        />
      )}
      <section
        role="dialog"
        aria-labelledby="tour-title"
        className="fixed inset-x-3 bottom-3 z-[70] flex max-h-[65svh] flex-col rounded-xl border bg-popover text-popover-foreground shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-h-[calc(100svh-6rem)] sm:w-[30rem]"
      >
        <header className="space-y-3 border-b p-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Platform tour · {index + 1} of {steps.length}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7">
                    <ListOrdered />
                    Contents
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="z-[80] max-h-80 overflow-y-auto">
                  {steps.map((s, i) => (
                    <DropdownMenuItem key={s.title} onSelect={() => setIndex(i)} className={cn(i === index && 'bg-accent')}>
                      <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                      {s.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon" className="size-7" aria-label="Close tour" onClick={() => close(false)}>
                <X />
              </Button>
            </div>
          </div>
          <Progress value={((index + 1) / steps.length) * 100} className="h-1" />
          <h2 id="tour-title" className="type-h4">
            {step.title}
          </h2>
        </header>
        <div key={index} className="flex-1 space-y-3 overflow-y-auto p-4 text-sm leading-relaxed text-muted-foreground">
          {step.body}
        </div>
        <footer className="flex items-center gap-2 border-t p-3">
          {!last && (
            <Button variant="ghost" size="sm" onClick={() => close(false)}>
              Skip
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {index > 0 && (
              <Button variant="outline" size="sm" onClick={() => setIndex(index - 1)}>
                <ArrowLeft />
                Back
              </Button>
            )}
            {last ? (
              <Button size="sm" onClick={() => close(true)}>
                <Check />
                Finish
              </Button>
            ) : (
              <Button size="sm" onClick={() => setIndex(index + 1)}>
                {index === 0 ? "Let's go" : 'Next'}
                <ArrowRight />
              </Button>
            )}
          </div>
        </footer>
      </section>
    </>
  );
}
