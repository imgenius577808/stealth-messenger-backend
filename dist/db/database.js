"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDb = initDb;
exports.getDb = getDb;
const sqlite3_1 = __importDefault(require("sqlite3"));
const sqlite_1 = require("sqlite");
let db;
async function initDb() {
    // Use /tmp for cloud deployments (writable directory)
    const dbPath = process.env.NODE_ENV === 'production'
        ? '/tmp/database.sqlite'
        : process.env.DATABASE_URL || './database.sqlite';
    console.log(`Using database at: ${dbPath}`);
    db = await (0, sqlite_1.open)({
        filename: dbPath,
        driver: sqlite3_1.default.Database
    });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            registration_id INTEGER NOT NULL,
            identity_key TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS pre_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            key_id INTEGER NOT NULL,
            public_key TEXT NOT NULL,
            is_signed BOOLEAN DEFAULT 0,
            signature TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            payload TEXT NOT NULL,
            type TEXT DEFAULT 'text',
            state TEXT DEFAULT 'sent',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sender_id) REFERENCES users(id),
            FOREIGN KEY (receiver_id) REFERENCES users(id)
        );
    `);
    console.log('Database initialized');
    return db;
}
function getDb() {
    if (!db) {
        throw new Error('Database not initialized');
    }
    return db;
}
