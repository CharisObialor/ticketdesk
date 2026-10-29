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
`;

// Columns added after the first release. Each is added once, on startup, if missing: [table, column, mysql type, sqlite type].
const columns = [
  ['messages', 'edited_at', 'DATETIME NULL', 'TEXT'],
  ['chat_messages', 'edited_at', 'DATETIME NULL', 'TEXT'],
  ['chat_members', 'last_emailed_id', 'INT UNSIGNED NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0'],
];

module.exports = { mysql, sqlite, columns };
