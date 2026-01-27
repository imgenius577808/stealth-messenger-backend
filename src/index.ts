import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { initDb, getDb, dbRun, saveDb } from './db/database';
import authRoutes from './routes/auth';
import mediaRoutes from './routes/media';
import keyRoutes from './routes/keys';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/auth', authRoutes);
app.use('/media', mediaRoutes);
app.use('/keys', keyRoutes);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'stealth-secret-key';
const MAX_USERS = parseInt(process.env.MAX_USERS || '2');

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.json({
        message: 'Stealth Messenger Backend v1.0',
        endpoints: ['/health', '/auth/register', '/auth/login', '/keys/bundle/:userId', '/media/upload']
    });
});

// Socket.io - Real-time messaging
const connectedUsers = new Map<number, string>();

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('authenticate', async (data: { token: string }) => {
        try {
            const decoded = jwt.verify(data.token, JWT_SECRET) as { userId: number; username: string };
            connectedUsers.set(decoded.userId, socket.id);
            socket.join(`user_${decoded.userId}`);
            (socket as any).userId = decoded.userId;
            console.log(`User ${decoded.userId} authenticated`);
            socket.emit('authenticated', { success: true, userId: decoded.userId });
        } catch (error) {
            socket.emit('authenticated', { success: false, error: 'Invalid token' });
        }
    });

    socket.on('send_message', async (data: { receiverId: number; payload: string; type: string; messageId?: string }) => {
        const senderId = (socket as any).userId;
        if (!senderId) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }

        const { receiverId, payload, type, messageId } = data;
        const timestamp = new Date();

        // Store message metadata
        try {
            dbRun(
                'INSERT INTO messages (sender_id, receiver_id, payload_hash, type, state, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
                [senderId, receiverId, messageId || 'msg_' + Date.now(), type, 'sent', timestamp.toISOString()]
            );
        } catch (e) {
            console.error('Failed to store message:', e);
        }

        // Relay encrypted message to receiver
        const receiverSocketId = connectedUsers.get(receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('receive_message', {
                senderId,
                payload, // Already encrypted by client
                type,
                messageId,
                timestamp
            });
            socket.emit('message_delivered', { messageId, receiverId });
        } else {
            socket.emit('message_queued', { messageId, receiverId });
        }
    });

    socket.on('typing', (data: { receiverId: number; isTyping: boolean }) => {
        const senderId = (socket as any).userId;
        if (!senderId) return;

        const receiverSocketId = connectedUsers.get(data.receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('user_typing', { userId: senderId, isTyping: data.isTyping });
        }
    });

    socket.on('message_read', (data: { messageId: string; senderId: number }) => {
        const readerId = (socket as any).userId;
        if (!readerId) return;

        const senderSocketId = connectedUsers.get(data.senderId);
        if (senderSocketId) {
            io.to(senderSocketId).emit('message_read_receipt', { messageId: data.messageId, readBy: readerId });
        }
    });

    socket.on('disconnect', () => {
        const userId = (socket as any).userId;
        if (userId) {
            connectedUsers.delete(userId);
            console.log(`User ${userId} disconnected`);
        }
    });
});

// Start server
async function startServer() {
    try {
        await initDb();
        server.listen(PORT, () => {
            console.log(`🚀 Stealth Messenger Backend running on port ${PORT}`);
            console.log(`📊 Max users: ${MAX_USERS}`);
            console.log(`🔐 JWT Secret configured: ${JWT_SECRET !== 'stealth-secret-key' ? 'Yes' : 'Using default'}`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

export { io, JWT_SECRET, MAX_USERS };
