# TicketDesk: client support portal

A support ticketing portal for a contract-services company. Client companies sign in and raise tickets. Your staff get an email right away and handle each ticket in a live chat thread inside the portal.

**Features**
- **Client portal:** clients raise tickets (subject, category, priority, description, attachments), chat with your team, mark tickets solved, reopen or escalate them, and export the conversation.
- **Staff workspace:** queues for All open, Assigned to me, Unassigned and Escalated. Staff can assign tickets, change status and priority, write internal notes that clients never see, and create tickets on a client's behalf.
- **Messages:** one inbox for group chats and ticket conversations, with unread counts. Clients can start a group with colleagues from their company; every group includes at least one admin, and technicians can be added when needed. Admins can view every group.
- **Actions for admins:** the portal watches tickets, site visits, the team and system health, and lists what needs doing (responses about to miss their SLA, unassigned or waiting tickets, untouched escalations, missing visit reports, low ratings, pending invitations, overloaded staff, failed backups), with one-click fixes, snooze and dismiss. Urgent items are emailed at once, items left waiting are reminded in the bell, and a summary email goes out each weekday morning.
- **Ticket assistant (admins):** a summary, the suggested next step, client mood, risk flags and a drafted reply for any ticket. The built-in engine is free and runs on the server with no outside service; a self-hosted Ollama model or Claude can be plugged in (see `.env.example`).
- **Realtime (WebSockets via Socket.IO):** new messages, ticket changes, typing indicators, escalation alerts and a live count of who's online. Optional desktop notifications. If a host blocks WebSockets, it falls back to long-polling automatically.
- **Email notifications (SMTP):**
  - All staff are emailed when a new ticket arrives.
  - The assigned staff member is emailed when the client replies (all staff if nobody is assigned).
  - The client is emailed when staff reply or change the status.
  - Admins are emailed on escalations.
  - Invite and password-reset emails are sent from the portal.
- **File uploads:** drag & drop, paste screenshots, up to 10 files of 25 MB each (configurable). Images show inline. Files are stored outside the web root, and each download checks permissions.
- **Chat export & archive:**
  - Any conversation can be exported as HTML (print to PDF), TXT or JSON.
  - A full transcript, including internal notes, is saved to the **Transcripts archive** automatically when a ticket is resolved or closed. Staff can also save one manually.
- **SLA auto-escalation:** a ticket with no staff reply within its priority's time limit is escalated, and admins are emailed. Defaults: urgent 1h, high 4h, normal 24h, low 48h.
- **Dashboard:**
  - Ticket counts: raised and solved, open, escalated, unassigned.
  - Response times: average and median first response, average time to resolve, SLA hit rate.
  - Breakdowns by priority, category and company, plus a raised-vs-solved chart.
  - Team workload, who's online, and recent activity.

**Roles**
- **Admin:** everything, including managing companies and users.
- **Agent:** handles tickets and sees the dashboard.
- **Technician:** same access as an agent, shown separately so admins can bring in technical staff when needed.
- **Client:** sees only their own company's tickets.

**Stack:** Node.js (Express, Socket.IO) with MySQL on the server. The browser app in `client/` is React with shadcn/ui components and Lucide icons, built with Vite into `public/`.

**Building the UI:** run `cd client && npm install && npm run build` before uploading. This writes the production files to `public/`, which the Node server serves. For local development run `npm run dev` in the project root (API on `PORT`) and `npm run dev` in `client/` (UI with live reload).

---

## Deploying on cPanel

You need a cPanel host with **Setup Node.js App** (CloudLinux/Passenger). Most cPanel hosts have it. Node 20 or newer is required; 22 is recommended.

### 1. Create the database
cPanel → **MySQL® Databases**
1. Create a database, e.g. `cpuser_ticketdesk`.
2. Create a user with a strong password.
3. Add the user to the database with **ALL PRIVILEGES**.

The app creates its own tables on first start.

### 2. Set up the support mailbox

**If your email is on Microsoft 365 (Outlook / Exchange Online)**

The portal sends notifications from, and reads replies sent to, one shared support mailbox through Microsoft Graph. Microsoft no longer allows apps to sign in to mailboxes with a password, so you register the portal as an app once. You need a Microsoft 365 admin account.

1. **Create the mailbox.** In the [Microsoft 365 admin center](https://admin.microsoft.com) → **Teams & groups → Shared mailboxes**, add a shared mailbox such as `support@yourcompany.com`. Shared mailboxes need no licence.
2. **Register the app.** In the [Microsoft Entra admin center](https://entra.microsoft.com) → **Identity → Applications → App registrations → New registration**:
   - Name: `DateHeight Support Portal`
   - Supported account types: *Accounts in this organizational directory only*
   - Leave Redirect URI empty, then **Register**.
   - On the overview page, copy the **Application (client) ID** and the **Directory (tenant) ID**.
3. **Create a client secret.** **Certificates & secrets → Client secrets → New client secret**, choose an expiry (for example 24 months), and copy the secret's **Value** straight away; it is only shown once. Put a reminder in your calendar to renew it before it expires.
4. **Grant mail permissions.** **API permissions → Add a permission → Microsoft Graph → Application permissions**, add **Mail.Send** and **Mail.ReadWrite**, then click **Grant admin consent for <your organisation>**.
5. **Limit which mailboxes the app can use (strongly recommended).** By default these permissions cover every mailbox in your organisation. Staff emails (replies, status changes, site visits) are sent from the staff member's own mailbox, so the app needs the support mailbox plus the mailboxes of staff who use the portal, and nothing else. In Exchange Online PowerShell:
   ```powershell
   Install-Module ExchangeOnlineManagement   # first time only
   Connect-ExchangeOnline
   New-DistributionGroup -Name "Support Portal Mailboxes" -Type Security -Members support@yourcompany.com, agent1@yourcompany.com, agent2@yourcompany.com
   New-ApplicationAccessPolicy -AppId <Application (client) ID> -PolicyScopeGroupId "Support Portal Mailboxes" -AccessRight RestrictAccess -Description "Support portal: support and staff mailboxes only"
   Test-ApplicationAccessPolicy -Identity support@yourcompany.com -AppId <Application (client) ID>
   Test-ApplicationAccessPolicy -Identity someone-not-in-support@yourcompany.com -AppId <Application (client) ID>
   ```
   The first test should report `AccessCheckResult: Granted` and the second `Denied`. It can take up to an hour to apply. When a new staff member joins, add them with `Add-DistributionGroupMember -Identity "Support Portal Mailboxes" -Member newperson@yourcompany.com`. Staff not in the group still work: their emails go out from the support mailbox instead. To send everything from the support mailbox, set `MS_SEND_AS_STAFF=false` and keep only the support mailbox in the group.
6. **Check plus addressing is on** (it is by default for new tenants). Replies are sent to addresses like `support+t42u7-abc123@yourcompany.com`, which Microsoft delivers to `support@`. In Exchange Online PowerShell: `Get-OrganizationConfig | Format-List DisablePlusAddressInRecipients` should show `False`.
7. Add the four values to `.env` in step 6 below: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` and `MS_MAILBOX=support@yourcompany.com`, plus `MAIL_FROM="DateHeight Support <support@yourcompany.com>"`. Reply by email turns on automatically.

8. **Allow large email attachments (optional).** Microsoft 365 refuses emails over 35 MB by default. To send up to the portal's 100 MB, raise the limit for each admin mailbox in Exchange Online PowerShell (150 MB is Microsoft's maximum):
   ```powershell
   Set-Mailbox -Identity admin1@yourcompany.com -MaxSendSize 150MB -MaxReceiveSize 150MB
   ```
   Recipients' providers have their own limits (Gmail and most free providers refuse emails over 25 MB).

9. **Shared mailboxes (info@, systems@ ...).** Each admin's Mail page also lists the shared mailboxes they have **Full Access** to in Exchange, and they can read and send from them. Microsoft Graph cannot tell the portal who has access, so the portal asks Exchange Online. Give the app registration read access to mailbox permissions:
   1. Entra admin center → **App registrations** → the portal app → **API permissions** → **Add a permission** → **APIs my organization uses** → search **Office 365 Exchange Online** → **Application permissions** → tick **Exchange.ManageAsApp** → **Add** → **Grant admin consent**.
   2. Entra admin center → **Roles & admins** → **Exchange Recipient Administrator** (or, for read-only, a custom role with *View-Only Recipients*) → **Add assignments** → choose the portal app.
   3. If you limited the app with an application access policy (step 5), add each shared mailbox to that group too: `Add-DistributionGroupMember -Identity "Support Portal Mailboxes" -Member info@yourcompany.com`.
   4. Delegation is what you already set in Exchange admin center (Mailboxes → the shared mailbox → Delegation → Read and manage). Changes show in the portal within 10 minutes.

   Without step 1-2, you can list them by hand in `.env` instead: `MS_SHARED_MAILBOXES=info@yourcompany.com=admin1@yourcompany.com|admin2@yourcompany.com;systems@yourcompany.com=*` (`*` means every admin with a company mailbox).

After restarting the app, open **System** in the portal (admins) to check that outgoing email and reply by email both show **OK**.

**If your email is on cPanel or another host**

cPanel → **Email Accounts**
1. Create an account such as `support@yourcompany.com`.
2. Open **Connect Devices** and note the outgoing SMTP server and port. This is usually `mail.yourcompany.com`, port 465, SSL.
3. Use the `SMTP_*` settings in `.env`, and the `IMAP_*` settings to turn on reply by email.

### 3. Create a subdomain with SSL
cPanel → **Domains**
1. Add `support.yourcompany.com`.
2. Make sure **SSL/TLS Status** (AutoSSL) has issued a certificate for it.

The portal should run at the root of its own subdomain, not in a subfolder.

### 4. Upload the code
1. Upload `ticketdesk.zip` with **File Manager** to your home directory, e.g. `/home/cpuser/ticketdesk`. Keep it outside `public_html`.
2. Extract it.

### 5. Create the Node.js app
cPanel → **Setup Node.js App** → **Create Application**

| Setting | Value |
| --- | --- |
| Node.js version | 20.x or 22.x |
| Application mode | Production |
| Application root | `ticketdesk` |
| Application URL | `support.yourcompany.com` |
| Application startup file | `app.js` |

### 6. Configure `.env`
1. In File Manager, copy `.env.example` to `.env` inside the app folder. Turn on "Show hidden files" if you can't see it.
2. Fill it in:
   - `APP_URL=https://support.yourcompany.com`
   - `JWT_SECRET`: a long random string. Any 60+ random characters will do.
   - `DB_*`: the values from step 1.
   - `SMTP_*` and `MAIL_FROM`: the values from step 2.
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD`: your first admin login.
   - `TRUST_PROXY`: leave at `1` on cPanel. Set `0` only if the app is exposed directly with no web server in front.

### 7. Install and start
1. Back in **Setup Node.js App**, click **Run NPM Install**.
2. Click **Restart**.
3. Open `https://support.yourcompany.com` and sign in with the admin account.
4. Delete `ADMIN_PASSWORD` from `.env`. It is only used to create the first account.

### 8. Set up your clients
1. Go to **Companies** and add each client company.
2. Go to **Users** and add their people (role *Client*). Leave "Email an invite link" ticked so each person gets an email to set their own password.
3. Add your own staff the same way, with role *Agent* or *Admin*.

### Updating
1. Upload the new files, overwriting the old ones. Keep `.env` and `storage/`.
2. Click **Run NPM Install**, then **Restart**.

### Backups
Back up two things:
- The MySQL database: cPanel → Backup, or phpMyAdmin export.
- The `storage/` folder, which holds uploaded files and archived transcripts.

---

## Running locally
```bash
npm install
cp .env.example .env    # then set NODE_ENV=development, DB_CLIENT=sqlite, APP_URL=http://localhost:3000, ADMIN_EMAIL/PASSWORD
npm start               # http://localhost:3000
```
`DB_CLIENT=sqlite` needs Node 22.5+ and is meant for testing only. Use MySQL in production. If `SMTP_HOST` is empty, emails are printed to the console instead of being sent.

To create or reset an admin from the command line:
```bash
npm run create-admin -- "Full Name" you@company.com "a-strong-password"
```

## Troubleshooting
- **App won't start:** check the log file named in Setup Node.js App, usually `stderr.log` in the app folder. The most common causes are a wrong `DB_*` value or a missing `JWT_SECRET`.
- **Status dot shows "Reconnecting…":** the host may block WebSockets. The app falls back to long-polling, which still works. If it never connects, ask your host to enable WebSockets for Passenger/Node apps.
- **No emails arrive:** check the SMTP settings. Port 465 needs `SMTP_SECURE=true`; port 587 needs `SMTP_SECURE=false`. Failures are written to the app log. To keep emails out of spam, make sure SPF/DKIM are enabled in cPanel → **Email Deliverability**.
- **Uploads fail for large files:** raise `UPLOAD_MAX_MB`. Some hosts also cap request size in Apache/LiteSpeed.
- **Timezones:** times are stored in UTC and shown in each viewer's local time. Dashboard day buckets are UTC days.
