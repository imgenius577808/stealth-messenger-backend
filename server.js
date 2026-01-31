const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Load sql.js
let db = null;
const initSqlJs = require('sql.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Config
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'stealth-secret-key';
const MAX_USERS = parseInt(process.env.MAX_USERS || '2');

app.use(cors());
app.use(express.json());

// Initialize Database
async function initDb() {
    const SQL = await initSqlJs();
    const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/stealth.db' : './stealth.db';

    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            registration_id INTEGER NOT NULL,
            identity_key TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS pre_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            key_id INTEGER NOT NULL,
            public_key TEXT NOT NULL,
            is_signed INTEGER DEFAULT 0,
            signature TEXT
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            payload_hash TEXT NOT NULL,
            type TEXT DEFAULT 'text',
            state TEXT DEFAULT 'sent',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size INTEGER NOT NULL,
            encryption_key_hash TEXT
        );
    `);

    saveDb();
    console.log('✅ Database initialized');
}

function saveDb() {
    if (!db) return;
    const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/stealth.db' : './stealth.db';
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
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

function dbRun(sql, params = []) {
    db.run(sql, params);
    saveDb();
    const result = db.exec('SELECT last_insert_rowid() as id, changes() as changes')[0];
    return {
        lastInsertRowid: result?.values[0]?.[0] || 0,
        changes: result?.values[0]?.[1] || 0
    };
}

// Auth middleware
function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// Routes
app.get('/', (req, res) => {
    res.json({ message: 'Stealth Messenger Backend v1.0.3', status: 'running' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes
app.post('/auth/register', (req, res) => {
    try {
        const { username, identityKey, registrationId, signedPreKey, preKeys } = req.body;
        if (!username || !identityKey || !registrationId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const count = dbGet('SELECT COUNT(*) as count FROM users');
        if (count && count.count >= MAX_USERS) {
            return res.status(403).json({ error: `Max ${MAX_USERS} users allowed` });
        }

        const existing = dbGet('SELECT id FROM users WHERE username = ?', [username]);
        if (existing) return res.status(409).json({ error: 'Username taken' });

        const result = dbRun('INSERT INTO users (username, registration_id, identity_key) VALUES (?, ?, ?)',
            [username, registrationId, identityKey]);
        const userId = result.lastInsertRowid;

        if (signedPreKey) {
            dbRun('INSERT INTO pre_keys (user_id, key_id, public_key, is_signed, signature) VALUES (?, ?, ?, 1, ?)',
                [userId, signedPreKey.keyId, signedPreKey.publicKey, signedPreKey.signature]);
        }

        if (preKeys && Array.isArray(preKeys)) {
            for (const pk of preKeys) {
                dbRun('INSERT INTO pre_keys (user_id, key_id, public_key, is_signed) VALUES (?, ?, ?, 0)',
                    [userId, pk.keyId, pk.publicKey]);
            }
        }

        const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({ success: true, userId, username, token });
    } catch (e) {
        console.error('Register error:', e);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/auth/login', (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ error: 'Username required' });

        const user = dbGet('SELECT id, username FROM users WHERE username = ?', [username]);
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        dbRun('UPDATE users SET last_seen = datetime("now") WHERE id = ?', [user.id]);
        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ success: true, userId: user.id, username: user.username, token });
    } catch (e) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/auth/partner', authMiddleware, (req, res) => {
    const partner = dbGet('SELECT id, username, last_seen FROM users WHERE id != ?', [req.user.userId]);
    if (!partner) return res.status(404).json({ error: 'No partner found' });
    res.json({ partner });
});

// Keys routes
app.get('/keys/bundle/:userId', authMiddleware, (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const user = dbGet('SELECT id, registration_id, identity_key FROM users WHERE id = ?', [userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const signedPreKey = dbGet('SELECT key_id, public_key, signature FROM pre_keys WHERE user_id = ? AND is_signed = 1 ORDER BY id DESC LIMIT 1', [userId]);
        const preKey = dbGet('SELECT id, key_id, public_key FROM pre_keys WHERE user_id = ? AND is_signed = 0 LIMIT 1', [userId]);

        if (preKey) dbRun('DELETE FROM pre_keys WHERE id = ?', [preKey.id]);

        res.json({
            registrationId: user.registration_id,
            identityKey: user.identity_key,
            signedPreKey: signedPreKey ? { keyId: signedPreKey.key_id, publicKey: signedPreKey.public_key, signature: signedPreKey.signature } : null,
            preKey: preKey ? { keyId: preKey.key_id, publicKey: preKey.public_key } : null
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get bundle' });
    }
});

app.post('/keys/prekeys', authMiddleware, (req, res) => {
    try {
        const { preKeys } = req.body;
        if (!preKeys || !Array.isArray(preKeys)) return res.status(400).json({ error: 'preKeys array required' });

        for (const pk of preKeys) {
            dbRun('INSERT OR REPLACE INTO pre_keys (user_id, key_id, public_key, is_signed) VALUES (?, ?, ?, 0)',
                [req.user.userId, pk.keyId, pk.publicKey]);
        }
        res.json({ success: true, count: preKeys.length });
    } catch (e) {
        res.status(500).json({ error: 'Failed to upload prekeys' });
    }
});

// Media routes
const uploadDir = process.env.NODE_ENV === 'production' ? '/tmp/uploads' : './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.post('/media/upload', authMiddleware, upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const result = dbRun('INSERT INTO media (user_id, filename, original_name, mime_type, size, encryption_key_hash) VALUES (?, ?, ?, ?, ?, ?)',
            [req.user.userId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.body.encryptionKeyHash || null]);

        res.json({ success: true, mediaId: result.lastInsertRowid, filename: req.file.filename, url: `/media/download/${req.file.filename}` });
    } catch (e) {
        res.status(500).json({ error: 'Upload failed' });
    }
});

app.get('/media/download/:filename', authMiddleware, (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(uploadDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(path.resolve(filePath));
});

// Socket.io
const connectedUsers = new Map();

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('authenticate', (data) => {
        try {
            const decoded = jwt.verify(data.token, JWT_SECRET);
            connectedUsers.set(decoded.userId, socket.id);
            socket.userId = decoded.userId;
            socket.emit('authenticated', { success: true, userId: decoded.userId });
        } catch (e) {
            socket.emit('authenticated', { success: false, error: 'Invalid token' });
        }
    });

    socket.on('send_message', (data) => {
        if (!socket.userId) return socket.emit('error', { message: 'Not authenticated' });

        const { receiverId, payload, type, messageId } = data;
        dbRun('INSERT INTO messages (sender_id, receiver_id, payload_hash, type, state, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
            [socket.userId, receiverId, messageId || 'msg_' + Date.now(), type, 'sent', new Date().toISOString()]);

        const receiverSocketId = connectedUsers.get(receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('receive_message', { senderId: socket.userId, payload, type, messageId, timestamp: new Date() });
            socket.emit('message_delivered', { messageId, receiverId });
        } else {
            socket.emit('message_queued', { messageId, receiverId });
        }
    });

    socket.on('typing', (data) => {
        if (!socket.userId) return;
        const receiverSocketId = connectedUsers.get(data.receiverId);
        if (receiverSocketId) io.to(receiverSocketId).emit('user_typing', { userId: socket.userId, isTyping: data.isTyping });
    });

    socket.on('disconnect', () => {
        if (socket.userId) connectedUsers.delete(socket.userId);
    });
});

// Start server
initDb().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Stealth Messenger running on port ${PORT}`);
        console.log(`📊 Max users: ${MAX_USERS}`);
    });
}).catch(err => {
    console.error('Failed to start:', err);
    process.exit(1);
});
