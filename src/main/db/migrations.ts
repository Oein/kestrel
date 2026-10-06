import type Database from 'better-sqlite3'

/** Versioned migration list. Append only — never edit a released migration. */
export const migrations: { version: number; up: string }[] = [
  {
    version: 1,
    up: `
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        preset TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        secret BLOB,
        sync_json TEXT NOT NULL DEFAULT '{}',
        sort INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE mailboxes (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        remote_id TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        role TEXT,
        type TEXT NOT NULL,
        color_bg TEXT,
        color_text TEXT,
        sync_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX mailboxes_account ON mailboxes(account_id);
      CREATE INDEX mailboxes_role ON mailboxes(role);

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        remote_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        from_name TEXT NOT NULL DEFAULT '',
        from_email TEXT NOT NULL DEFAULT '',
        to_json TEXT NOT NULL DEFAULT '[]',
        cc_json TEXT NOT NULL DEFAULT '[]',
        reply_to_json TEXT NOT NULL DEFAULT '[]',
        snippet TEXT NOT NULL DEFAULT '',
        date INTEGER NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0,
        is_starred INTEGER NOT NULL DEFAULT 0,
        has_attachments INTEGER NOT NULL DEFAULT 0,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        message_id_header TEXT,
        in_reply_to TEXT,
        refs TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        UNIQUE(account_id, remote_id)
      );
      CREATE INDEX messages_date ON messages(date DESC);
      CREATE INDEX messages_thread ON messages(account_id, thread_id);
      CREATE INDEX messages_starred ON messages(is_starred) WHERE is_starred = 1;

      CREATE TABLE message_labels (
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        mailbox_id TEXT NOT NULL,
        PRIMARY KEY (message_id, mailbox_id)
      ) WITHOUT ROWID;
      CREATE INDEX message_labels_mailbox ON message_labels(mailbox_id, message_id);

      CREATE TABLE bodies (
        message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        html TEXT,
        text TEXT,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        fetched_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE messages_fts USING fts5(
        subject, sender, recipients, snippet, body,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `
  },
  {
    version: 2,
    up: `
      CREATE TABLE oauth_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        client_id TEXT NOT NULL,
        client_secret BLOB,
        domains TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      ALTER TABLE accounts ADD COLUMN oauth_client_id TEXT REFERENCES oauth_clients(id);
      ALTER TABLE accounts ADD COLUMN needs_reauth INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `
  },
  {
    version: 3,
    up: `
      CREATE TABLE rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        language TEXT NOT NULL,
        code TEXT NOT NULL DEFAULT '',
        account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
        sort INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_error TEXT,
        last_run_at INTEGER,
        hit_count INTEGER NOT NULL DEFAULT 0
      );
    `
  }
]

export function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (const m of migrations) {
    if (m.version <= current) continue
    db.transaction(() => {
      db.exec(m.up)
      db.pragma(`user_version = ${m.version}`)
    })()
  }
}
