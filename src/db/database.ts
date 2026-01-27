import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';

let db: SqlJsDatabase;

export async function initDb(): Promise<SqlJsDatabase> {
    const SQL = await initSqlJs();

    // Use /tmp for cloud deployments (writable directory)
    const dbPath = process.env.NODE_ENV === 'production'
        ? '/tmp/stealth.db'
        : path.join(process.cwd(), 'stealth.db');

    console.log(`📁 Database path: ${dbPath}`);

    // Load existing database or create new
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    // Create tables
    db.run(`
        -- Users table
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            registration_id INTEGER NOT NULL,
            identity_key TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Pre-keys for Signal Protocol
        CREATE TABLE IF NOT EXISTS pre_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            key_id INTEGER NOT NULL,
            public_key TEXT NOT NULL,
            is_signed INTEGER DEFAULT 0,
            signature TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- Messages metadata (payload stored encrypted on device)
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            payload_hash TEXT NOT NULL,
            type TEXT DEFAULT 'text',
            state TEXT DEFAULT 'sent',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sender_id) REFERENCES users(id),
            FOREIGN KEY (receiver_id) REFERENCES users(id)
        );

        -- Media files metadata
        CREATE TABLE IF NOT EXISTS media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size INTEGER NOT NULL,
            encryption_key_hash TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    `);

    // Save to disk
    saveDb();

    console.log('✅ Database initialized');
    return db;
}

export function saveDb(): void {
    if (!db) return;

    const dbPath = process.env.NODE_ENV === 'production'
        ? '/tmp/stealth.db'
        : path.join(process.cwd(), 'stealth.db');

    const data = db.export();
    fs.writeFileSync(dbPath, data);
}

export function getDb(): SqlJsDatabase {
    if (!db) {
        throw new Error('Database not initialized. Call initDb() first.');
    }
    return db;
}

// Helper functions for easier querying
export function dbRun(sql: string, params: any[] = []): { lastInsertRowid: number; changes: number } {
    db.run(sql, params);
    saveDb();
    const result = db.exec('SELECT last_insert_rowid() as id, changes() as changes')[0];
    return {
        lastInsertRowid: result?.values[0]?.[0] as number || 0,
        changes: result?.values[0]?.[1] as number || 0
    };
}

export function dbGet(sql: string, params: any[] = []): any {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
        const row: any = {};
        const columns = stmt.getColumnNames();
        const values = stmt.get();
        columns.forEach((col: string, i: number) => row[col] = values[i]);
        stmt.free();
        return row;
    }
    stmt.free();
    return null;
}

export function dbAll(sql: string, params: any[] = []): any[] {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results: any[] = [];
    while (stmt.step()) {
        const row: any = {};
        const columns = stmt.getColumnNames();
        const values = stmt.get();
        columns.forEach((col: string, i: number) => row[col] = values[i]);
        results.push(row);
    }
    stmt.free();
    return results;
}

export function closeDb(): void {
    if (db) {
        saveDb();
        db.close();
    }
}
