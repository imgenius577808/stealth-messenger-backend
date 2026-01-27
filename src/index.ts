import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDb } from './db/database';
import authRoutes from './controllers/AuthController';
import mediaRoutes from './controllers/MediaController';
import jwt from 'jsonwebtoken';
import { UserService } from './services/UserService';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

app.use(cors());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/media', mediaRoutes);

const PORT = process.env.PORT || 3000;

// Basic health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Socket.io logic
const connectedUsers = new Map<number, string>(); // userId -> socketId

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('authenticate', async (data: { token: string }) => {
        try {
            const decoded = jwt.verify(data.token, process.env.JWT_SECRET || 'secret') as any;
            connectedUsers.set(decoded.userId, socket.id);
            socket.join(`user_${decoded.userId}`);
            console.log(`User ${decoded.userId} authenticated`);
            socket.emit('authenticated', { success: true });
        } catch (error) {
            socket.emit('authenticated', { success: false, error: 'Invalid token' });
        }
    });

    socket.on('send_message', async (data: { receiverId: number, payload: string, type: string }) => {
        // Enforce sender authentication (simplified for now)
        const senderEntry = Array.from(connectedUsers.entries()).find(([uid, sid]) => sid === socket.id);
        if (!senderEntry) return;

        const senderId = senderEntry[0];
        const { receiverId, payload, type } = data;

        // Relay to receiver
        io.to(`user_${receiverId}`).emit('receive_message', {
            senderId,
            payload,
            type,
            timestamp: new Date()
        });

        // TODO: Persist message metadata in DB
    });

    socket.on('disconnect', () => {
        const userEntry = Array.from(connectedUsers.entries()).find(([uid, sid]) => sid === socket.id);
        if (userEntry) {
            connectedUsers.delete(userEntry[0]);
        }
        console.log('User disconnected:', socket.id);
    });
});

async function startServer() {
    try {
        await initDb();
        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
