const mysql = `
CREATE TABLE IF NOT EXISTS companies (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  email_domain VARCHAR(190) NULL,
  notes TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NULL,
  name VARCHAR(190) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(100) NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'client',
  phone VARCHAR(40) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  notify_email TINYINT(1) NOT NULL DEFAULT 1,
  token_hash CHAR(64) NULL,
  token_expires DATETIME NULL,
  last_login_at DATETIME NULL,
  last_seen_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_company (company_id),
  CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tickets (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  created_by INT UNSIGNED NULL,
  assigned_to INT UNSIGNED NULL,
  subject VARCHAR(255) NOT NULL,
  category VARCHAR(60) NOT NULL DEFAULT 'General',
  priority VARCHAR(16) NOT NULL DEFAULT 'normal',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  escalated TINYINT(1) NOT NULL DEFAULT 0,
  escalation_level INT NOT NULL DEFAULT 0,
  escalated_at DATETIME NULL,
  first_response_at DATETIME NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  last_activity_at DATETIME NOT NULL,
  KEY idx_t_company (company_id),
  KEY idx_t_status (status),
  KEY idx_t_assigned (assigned_to),
  KEY idx_t_created (created_at),
  KEY idx_t_resolved (resolved_at),
  KEY idx_t_activity (last_activity_at),
  CONSTRAINT fk_t_company FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_t_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_t_assignee FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  body MEDIUMTEXT NOT NULL,
  is_internal TINYINT(1) NOT NULL DEFAULT 0,
  kind VARCHAR(16) NOT NULL DEFAULT 'message',
  created_at DATETIME NOT NULL,
  KEY idx_m_ticket (ticket_id),
  KEY idx_m_created (created_at),
  CONSTRAINT fk_m_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_m_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attachments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT UNSIGNED NOT NULL,
  message_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(100) NOT NULL,
  mime VARCHAR(150) NOT NULL,
  size INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  KEY idx_a_ticket (ticket_id),
  KEY idx_a_message (message_id),
  CONSTRAINT fk_a_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_a_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transcripts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT UNSIGNED NOT NULL,
  filename VARCHAR(150) NOT NULL,
  size INT UNSIGNED NOT NULL,
  message_count INT NOT NULL,
  reason VARCHAR(40) NOT NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  KEY idx_tr_ticket (ticket_id),
  CONSTRAINT fk_tr_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_groups (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  last_message_at DATETIME NOT NULL,
  KEY idx_cg_company (company_id),
  KEY idx_cg_last (last_message_at),
  CONSTRAINT fk_cg_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_members (
  group_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  added_by INT UNSIGNED NULL,
  joined_at DATETIME NOT NULL,
  last_read_id INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id),
  KEY idx_cm_user (user_id),
  CONSTRAINT fk_cm_group FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_cm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  body MEDIUMTEXT NOT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'message',
  created_at DATETIME NOT NULL,
  KEY idx_chm_group (group_id),
  CONSTRAINT fk_chm_group FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_chm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_attachments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id INT UNSIGNED NOT NULL,
  message_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(100) NOT NULL,
  mime VARCHAR(150) NOT NULL,
  size INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  KEY idx_ca_group (group_id),
  CONSTRAINT fk_ca_group FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_ca_message FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_reads (
  ticket_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  last_read_id INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (ticket_id, user_id),
  CONSTRAINT fk_tr2_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_tr2_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saved_replies (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  is_shared TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  CONSTRAINT fk_sr_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_ratings (
  ticket_id INT UNSIGNED NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  rating TINYINT NOT NULL,
  comment TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_rt_created (created_at),
  CONSTRAINT fk_rt_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_signoffs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT UNSIGNED NOT NULL,
  round INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  decision VARCHAR(20) NOT NULL,
  comment TEXT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_signoff (ticket_id, round, user_id),
  CONSTRAINT fk_so_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_so_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_visits (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT UNSIGNED NOT NULL,
  technician_id INT UNSIGNED NULL,
  scheduled_at DATETIME NOT NULL,
  duration_min INT NOT NULL DEFAULT 60,
  location VARCHAR(255) NULL,
  notes TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'scheduled',
  report MEDIUMTEXT NULL,
  signed_by VARCHAR(190) NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_sv_ticket (ticket_id),
  KEY idx_sv_tech (technician_id),
  KEY idx_sv_sched (scheduled_at),
  CONSTRAINT fk_sv_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_sv_tech FOREIGN KEY (technician_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  kind VARCHAR(30) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NULL,
  link VARCHAR(255) NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  KEY idx_n_user (user_id, id),
  CONSTRAINT fk_n_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_insights (
  ticket_id INT UNSIGNED NOT NULL PRIMARY KEY,
  last_message_id INT UNSIGNED NOT NULL DEFAULT 0,
  data MEDIUMTEXT NOT NULL,
  model VARCHAR(60) NULL,
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_ai_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS action_states (
  user_id INT UNSIGNED NOT NULL,
  action_key VARCHAR(120) NOT NULL,
  status VARCHAR(16) NULL,
  snooze_until DATETIME NULL,
  reason VARCHAR(255) NULL,
  first_seen_at DATETIME NOT NULL,
  reminded_at DATETIME NULL,
  urgent_emailed_at DATETIME NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (user_id, action_key),
  CONSTRAINT fk_as_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mail_outbox (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  recipient VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NULL,
  payload MEDIUMTEXT NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL,
  last_error VARCHAR(500) NULL,
  created_at DATETIME NOT NULL,
  sent_at DATETIME NULL,
  KEY idx_mo_due (status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS settings (
  name VARCHAR(64) NOT NULL PRIMARY KEY,
  value TEXT NULL,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sites (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  code VARCHAR(60) NOT NULL,
  location VARCHAR(255) NULL,
  details TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_site_code (company_id, code),
  CONSTRAINT fk_sites_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_chats (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NULL,
  is_direct TINYINT(1) NOT NULL DEFAULT 0,
  direct_key VARCHAR(40) NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  last_message_at DATETIME NOT NULL,
  UNIQUE KEY uq_tc_direct (direct_key),
  KEY idx_tc_last (last_message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_chat_members (
  chat_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  last_read_id INT UNSIGNED NOT NULL DEFAULT 0,
  joined_at DATETIME NOT NULL,
  PRIMARY KEY (chat_id, user_id),
  KEY idx_tcm_user (user_id),
  CONSTRAINT fk_tcm_chat FOREIGN KEY (chat_id) REFERENCES team_chats(id) ON DELETE CASCADE,
  CONSTRAINT fk_tcm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_messages (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  chat_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  body TEXT NOT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'message',
  created_at DATETIME NOT NULL,
  edited_at DATETIME NULL,
  KEY idx_tm_chat (chat_id, id),
  CONSTRAINT fk_tm_chat FOREIGN KEY (chat_id) REFERENCES team_chats(id) ON DELETE CASCADE,
  CONSTRAINT fk_tm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_attachments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  chat_id INT UNSIGNED NOT NULL,
  message_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(100) NOT NULL,
  mime VARCHAR(150) NOT NULL,
  size INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  KEY idx_ta_chat (chat_id),
  KEY idx_ta_message (message_id),
  CONSTRAINT fk_ta_chat FOREIGN KEY (chat_id) REFERENCES team_chats(id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_message FOREIGN KEY (message_id) REFERENCES team_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  endpoint VARCHAR(1000) NOT NULL,
  p256dh VARCHAR(200) NOT NULL,
  auth VARCHAR(100) NOT NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL,
  last_used_at DATETIME NULL,
  KEY idx_ps_user (user_id),
  KEY idx_ps_endpoint (endpoint(191)),
  CONSTRAINT fk_ps_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_ratings (
  ticket_id INT UNSIGNED NOT NULL,
  admin_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  rating TINYINT NOT NULL,
  comment TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (ticket_id, admin_id),
  KEY idx_ar_admin (admin_id, updated_at),
  KEY idx_ar_updated (updated_at),
  CONSTRAINT fk_ar_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_ar_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS technicians (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(40) NULL,
  area VARCHAR(190) NULL,
  notes TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const sqlite = `
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email_domain TEXT, notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT, role TEXT NOT NULL DEFAULT 'client',
  phone TEXT, is_active INTEGER NOT NULL DEFAULT 1, notify_email INTEGER NOT NULL DEFAULT 1,
  token_hash TEXT, token_expires TEXT, last_login_at TEXT, last_seen_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'General', priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open', escalated INTEGER NOT NULL DEFAULT 0, escalation_level INTEGER NOT NULL DEFAULT 0,
  escalated_at TEXT, first_response_at TEXT, resolved_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_activity_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_t_company ON tickets(company_id);
CREATE INDEX IF NOT EXISTS idx_t_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_t_assigned ON tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_t_created ON tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_t_resolved ON tickets(resolved_at);
CREATE INDEX IF NOT EXISTS idx_t_activity ON tickets(last_activity_at);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, body TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'message', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_m_ticket ON messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_m_created ON messages(created_at);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE, user_id INTEGER,
  original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_a_ticket ON attachments(ticket_id);
CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  filename TEXT NOT NULL, size INTEGER NOT NULL, message_count INTEGER NOT NULL, reason TEXT NOT NULL,
  created_by INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tr_ticket ON transcripts(ticket_id);
CREATE TABLE IF NOT EXISTS chat_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL, last_message_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cg_company ON chat_groups(company_id);
CREATE TABLE IF NOT EXISTS chat_members (
  group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by INTEGER, joined_at TEXT NOT NULL, last_read_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_user ON chat_members(user_id);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'message',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chm_group ON chat_messages(group_id);
CREATE TABLE IF NOT EXISTS chat_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE, user_id INTEGER,
  original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ca_group ON chat_attachments(group_id);
CREATE TABLE IF NOT EXISTS ticket_reads (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ticket_id, user_id)
);
CREATE TABLE IF NOT EXISTS saved_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, is_shared INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ticket_ratings (
  ticket_id INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL, comment TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rt_created ON ticket_ratings(created_at);
CREATE TABLE IF NOT EXISTS ticket_signoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  round INTEGER NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, decision TEXT NOT NULL, comment TEXT,
  created_at TEXT NOT NULL, UNIQUE (ticket_id, round, user_id)
);
CREATE TABLE IF NOT EXISTS site_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  technician_id INTEGER REFERENCES users(id) ON DELETE SET NULL, scheduled_at TEXT NOT NULL, duration_min INTEGER NOT NULL DEFAULT 60,
  location TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'scheduled', report TEXT, signed_by TEXT,
  started_at TEXT, completed_at TEXT, created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sv_ticket ON site_visits(ticket_id);
CREATE INDEX IF NOT EXISTS idx_sv_tech ON site_visits(technician_id);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_n_user ON notifications(user_id, id);
CREATE TABLE IF NOT EXISTS ai_insights (
  ticket_id INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE, last_message_id INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS action_states (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, action_key TEXT NOT NULL, status TEXT, snooze_until TEXT,
  reason TEXT, first_seen_at TEXT NOT NULL, reminded_at TEXT, urgent_emailed_at TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, action_key)
);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL, subject TEXT, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
  last_error TEXT, created_at TEXT NOT NULL, sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mo_due ON mail_outbox(status, next_attempt_at);
CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL, location TEXT, details TEXT, is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (company_id, code)
);
CREATE TABLE IF NOT EXISTS team_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, is_direct INTEGER NOT NULL DEFAULT 0, direct_key TEXT UNIQUE,
  created_by INTEGER, created_at TEXT NOT NULL, last_message_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tc_last ON team_chats(last_message_at);
CREATE TABLE IF NOT EXISTS team_chat_members (
  chat_id INTEGER NOT NULL REFERENCES team_chats(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0, joined_at TEXT NOT NULL, PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tcm_user ON team_chat_members(user_id);
CREATE TABLE IF NOT EXISTS team_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL REFERENCES team_chats(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'message',
  created_at TEXT NOT NULL, edited_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tm_chat ON team_messages(chat_id, id);
CREATE TABLE IF NOT EXISTS team_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL REFERENCES team_chats(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE, user_id INTEGER,
  original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ta_chat ON team_attachments(chat_id);
CREATE INDEX IF NOT EXISTS idx_ta_message ON team_attachments(message_id);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, user_agent TEXT, created_at TEXT NOT NULL, last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ps_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_ps_endpoint ON push_subscriptions(endpoint);
CREATE TABLE IF NOT EXISTS admin_ratings (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE, admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, rating INTEGER NOT NULL, comment TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (ticket_id, admin_id)
);
CREATE INDEX IF NOT EXISTS idx_ar_admin ON admin_ratings(admin_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_ar_updated ON admin_ratings(updated_at);
CREATE TABLE IF NOT EXISTS technicians (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, area TEXT, notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
`;

// Columns added after the first release. Each is added once, on startup, if missing:
// [table, column, mysql type, sqlite type, optional SQL run once right after adding it].
const columns = [
  ['messages', 'edited_at', 'DATETIME NULL', 'TEXT'],
  ['chat_messages', 'edited_at', 'DATETIME NULL', 'TEXT'],
  ['chat_members', 'last_emailed_id', 'INT UNSIGNED NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0'],
  // CC/BCC on staff replies (JSON arrays of addresses), and the sender of replies from people outside the portal.
  ['users', 'signature', 'TEXT NULL', 'TEXT'],
  ['users', 'avatar', 'VARCHAR(80) NULL', 'TEXT'],
  // When the user finished (or skipped) the first-login tour. People who existed before the tour count as done.
  ['companies', 'logo', 'VARCHAR(80) NULL', 'TEXT'],
  ['companies', 'rc_number', 'VARCHAR(40) NULL', 'TEXT'],
  // Company-specific SLA targets (JSON); anything not set uses the defaults on the System page.
  ['companies', 'sla', 'TEXT NULL', 'TEXT'],
  // The person's position at their company, e.g. IT Manager (separate from their portal role).
  ['users', 'job_title', 'VARCHAR(120) NULL', 'TEXT'],
  // Sign-off before closing: the current round, how many approvals it needs, and who asked.
  ['tickets', 'signoff_round', 'INT UNSIGNED NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0'],
  ['tickets', 'signoff_required', 'TINYINT UNSIGNED NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0'],
  ['tickets', 'signoff_requested_by', 'INT UNSIGNED NULL', 'INTEGER'],
  ['tickets', 'signoff_requested_at', 'DATETIME NULL', 'TEXT'],
  ['users', 'tour_done_at', 'DATETIME NULL', 'TEXT', 'UPDATE users SET tour_done_at = created_at'],
  ['messages', 'cc', 'TEXT NULL', 'TEXT'],
  // Work updates from the engineer: time spent on the work, and photos marked as before or after.
  ['messages', 'time_spent_min', 'INT UNSIGNED NULL', 'INTEGER'],
  ['attachments', 'label', 'VARCHAR(16) NULL', 'TEXT'],
  ['messages', 'bcc', 'TEXT NULL', 'TEXT'],
  ['messages', 'sender_name', 'VARCHAR(190) NULL', 'TEXT'],
  ['messages', 'sender_email', 'VARCHAR(190) NULL', 'TEXT'],
  // The client's site contacts for a ticket: Operations Manager (OM) and Field Service Engineer (FSE).
  // Companies that ask clients for the OM and FSE on every new ticket (Pan African Towers).
  ['companies', 'site_contacts', 'TINYINT(1) NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0'],
  ['tickets', 'om_name', 'VARCHAR(120) NULL', 'TEXT'],
  ['tickets', 'om_phone', 'VARCHAR(40) NULL', 'TEXT'],
  ['tickets', 'fse_name', 'VARCHAR(120) NULL', 'TEXT'],
  ['tickets', 'fse_phone', 'VARCHAR(40) NULL', 'TEXT'],
  // When the ticket was first assigned: the SLA clocks start here. Older assigned tickets count from when they were raised.
  ['tickets', 'assigned_at', 'DATETIME NULL', 'TEXT', 'UPDATE tickets SET assigned_at = created_at WHERE assigned_to IS NOT NULL'],
  // The client site the ticket is about (from the company's site list).
  ['tickets', 'site_id', 'INT UNSIGNED NULL', 'INTEGER'],
  // One-time code emailed to confirm a password change (hash only), when it expires, wrong tries, and when it was sent.
  ['users', 'otp_hash', 'VARCHAR(64) NULL', 'TEXT'],
  ['users', 'otp_expires', 'DATETIME NULL', 'TEXT'],
  ['users', 'otp_attempts', 'INT UNSIGNED NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'otp_sent_at', 'DATETIME NULL', 'TEXT'],
  // The client confirming the engineer arrived, and signing the job completion certificate (JCC) on screen.
  ['site_visits', 'client_confirmed_at', 'DATETIME NULL', 'TEXT'],
  ['site_visits', 'client_confirmed_by', 'INT UNSIGNED NULL', 'INTEGER'],
  ['site_visits', 'client_signed_at', 'DATETIME NULL', 'TEXT'],
  ['site_visits', 'client_signed_by', 'INT UNSIGNED NULL', 'INTEGER'],
  ['site_visits', 'client_signed_name', 'VARCHAR(190) NULL', 'TEXT'],
  ['site_visits', 'client_satisfied', 'TINYINT NULL', 'INTEGER'],
  ['site_visits', 'client_comment', 'TEXT NULL', 'TEXT'],
  // Which notifications a person wants, by email and in the bell (JSON, see notify.js PREF_CATEGORIES).
  ['users', 'notify_prefs', 'TEXT NULL', 'TEXT'],
  // Client contacts who get the monthly statement (JSON list of user ids), and the last month sent ("YYYY-MM").
  ['companies', 'statement_recipients', 'TEXT NULL', 'TEXT'],
  ['companies', 'statement_sent_for', 'VARCHAR(7) NULL', 'TEXT'],
  // How often an admin wants SLA reminders (JSON, see sla.reminderPrefs).
  ['users', 'sla_reminders', 'TEXT NULL', 'TEXT'],
];

// Indexes added after the first release, created once on startup if missing: [table, index name, columns].
// The "cover" indexes hold every column the dashboard and reports read, so long periods are answered from the index alone.
const indexes = [
  ['tickets', 'idx_t_created_cover', 'created_at, company_id, priority, category, first_response_at'],
  ['tickets', 'idx_t_resolved_cover', 'resolved_at, created_at, assigned_to'],
  ['tickets', 'idx_t_escalated_at', 'escalated_at'],
  ['messages', 'idx_m_created_kind', 'created_at, kind'],
  ['users', 'idx_u_company', 'company_id'],
  ['tickets', 'idx_t_company_status', 'company_id, status'],
  // Latest message and unread counts per conversation, for the Messages inbox.
  ['messages', 'idx_m_ticket_id', 'ticket_id, id'],
  ['chat_messages', 'idx_chm_group_id', 'group_id, id'],
  ['tickets', 'idx_t_company_activity', 'company_id, last_activity_at'],
  ['chat_groups', 'idx_cg_last', 'last_message_at'],
  // Sidebar counts and team workload, answered from the index alone.
  ['tickets', 'idx_t_status_assigned', 'status, assigned_to, escalated'],
  // Clearing out sent mail older than a week without reading every stored email.
  ['mail_outbox', 'idx_mo_sent', 'status, sent_at'],
  // Tickets per site, for the company site list.
  ['tickets', 'idx_t_site', 'site_id'],
];

module.exports = { mysql, sqlite, columns, indexes };
