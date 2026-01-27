"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDb = initDb;
exports.saveDb = saveDb;
exports.getDb = getDb;
exports.dbRun = dbRun;
exports.dbGet = dbGet;
exports.dbAll = dbAll;
exports.closeDb = closeDb;
const sql_js_1 = __importDefault(require("sql.js"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
let db;
async function initDb() {
    const SQL = await (0, sql_js_1.default)();
    // Use /tmp for cloud deployments (writable directory)
    const dbPath = process.env.NODE_ENV === 'production'
        ? '/tmp/stealth.db'
        : path_1.default.join(process.cwd(), 'stealth.db');
    console.log(`📁 Database path: ${dbPath}`);
    // Load existing database or create new
    if (fs_1.default.existsSync(dbPath)) {
        const buffer = fs_1.default.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    }
    else {
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
function saveDb() {
    if (!db)
        return;
    const dbPath = process.env.NODE_ENV === 'production'
        ? '/tmp/stealth.db'
        : path_1.default.join(process.cwd(), 'stealth.db');
    const data = db.export();
    fs_1.default.writeFileSync(dbPath, data);
}
function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDb() first.');
    }
    return db;
}
// Helper functions for easier querying
function dbRun(sql, params = []) {
    db.run(sql, params);
    saveDb();
    const result = db.exec('SELECT last_insert_rowid() as id, changes() as changes')[0];
    return {
        lastInsertRowid: result?.values[0]?.[0] || 0,
        changes: result?.values[0]?.[1] || 0
    };
}
function dbGet(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
        const row = {};
        const columns = stmt.getColumnNames();
        const values = stmt.get();
        columns.forEach((col, i) => row[col] = values[i]);
        stmt.free();
        return row;
    }
    stmt.free();
    return null;
}
function dbAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        const row = {};
        const columns = stmt.getColumnNames();
        const values = stmt.get();
        columns.forEach((col, i) => row[col] = values[i]);
        results.push(row);
    }
    stmt.free();
    return results;
}
function closeDb() {
    if (db) {
        saveDb();
        db.close();
    }
}
//# sourceMappingURL=database.js.map