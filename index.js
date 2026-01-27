const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

// Database setup - use /tmp for cloud, local otherwise
const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/stealth.db' : './stealth.db';
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

console.log('Database ready at:', dbPath);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.json({ message: 'Stealth Messenger Backend Running!' });
});

// Register user
app.post('/auth/register', (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ error: 'Username required' });

        const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
        if (count >= 2) return res.status(403).json({ error: 'Max users reached' });

        const stmt = db.prepare('INSERT INTO users (username) VALUES (?)');
        const result = stmt.run(username);

        const token = jwt.sign({ userId: result.lastInsertRowid, username }, JWT_SECRET);
        res.json({ token, userId: result.lastInsertRowid });
    } catch (err) {
        if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        res.status(500).json({ error: err.message });
    }
});

// Socket.io for messaging
const connectedUsers = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('authenticate', (data) => {
        try {
            const decoded = jwt.verify(data.token, JWT_SECRET);
            connectedUsers.set(decoded.userId, socket.id);
            socket.userId = decoded.userId;
            socket.emit('authenticated', { success: true });
            console.log('User authenticated:', decoded.userId);
        } catch (e) {
            socket.emit('authenticated', { success: false });
        }
    });

    socket.on('send_message', (data) => {
        if (!socket.userId) return;
        const { receiverId, payload, type } = data;
        const receiverSocket = connectedUsers.get(receiverId);
        if (receiverSocket) {
            io.to(receiverSocket).emit('receive_message', {
                senderId: socket.userId,
                payload,
                type,
                timestamp: new Date()
            });
        }
    });

    socket.on('disconnect', () => {
        if (socket.userId) connectedUsers.delete(socket.userId);
        console.log('User disconnected:', socket.id);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
