import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import { initDb, getDb, dbRun, saveDb } from './db/database';
import authRoutes from './routes/auth';
import mediaRoutes from './routes/media';
import keyRoutes from './routes/keys';

dotenv.config();

const app = express();
const server = http.createServer(app);

// Configuration
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
const MAX_USERS = parseInt(process.env.MAX_USERS || '2');
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];

// Security: Log warning if using default JWT secret
if (JWT_SECRET === 'fallback-secret-change-in-production') {
    console.warn('⚠️  WARNING: Using default JWT secret. Set JWT_SECRET in production!');
}

// Socket.io with CORS
const io = new Server(server, {
    cors: {
        origin: ALLOWED_ORIGINS.includes('*') ? '*' : ALLOWED_ORIGINS,
        methods: ['GET', 'POST']
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable for API
    crossOriginEmbedderPolicy: false
}));

// CORS with proper configuration
const corsOptions = {
    origin: ALLOWED_ORIGINS.includes('*')
        ? true
        : (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
            if (!origin || ALLOWED_ORIGINS.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};
app.use(cors(corsOptions));

// Body parser with size limit
app.use(express.json({ limit: '10mb' }));

// Rate limiting (simple in-memory implementation)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 100; // 100 requests per minute

function rateLimiter(req: Request, res: Response, next: NextFunction) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    const entry = rateLimitStore.get(ip);
    if (!entry || now > entry.resetTime) {
        rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return next();
    }

    if (entry.count >= RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    entry.count++;
    next();
}

app.use(rateLimiter);

// Clean up rate limit store periodically
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitStore.entries()) {
        if (now > entry.resetTime) {
            rateLimitStore.delete(ip);
        }
    }
}, 60000);

// Routes
app.use('/auth', authRoutes);
app.use('/media', mediaRoutes);
app.use('/keys', keyRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.1'
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'Stealth Messenger Backend v1.0.1',
        status: 'running'
    });
});

// Global error handler - sanitize error responses
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Server error:', err.message);
    res.status(500).json({
        error: 'Internal server error',
        // Only include details in development
        ...(process.env.NODE_ENV !== 'production' && { details: err.message })
    });
});

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Socket.io - Real-time messaging
const connectedUsers = new Map<number, string>();

// Socket authentication middleware
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
        return next();  // Allow connection, but require explicit authentication
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; username: string };
        (socket as any).userId = decoded.userId;
        (socket as any).username = decoded.username;
        next();
    } catch (err) {
        next();  // Allow connection but not authenticated
    }
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('authenticate', async (data: { token: string }) => {
        if (!data?.token) {
            socket.emit('authenticated', { success: false, error: 'Token required' });
            return;
        }

        try {
            const decoded = jwt.verify(data.token, JWT_SECRET) as { userId: number; username: string };
            connectedUsers.set(decoded.userId, socket.id);
            socket.join(`user_${decoded.userId}`);
            (socket as any).userId = decoded.userId;
            (socket as any).username = decoded.username;
            console.log(`User ${decoded.userId} (${decoded.username}) authenticated`);
            socket.emit('authenticated', { success: true, userId: decoded.userId });
        } catch (error) {
            socket.emit('authenticated', { success: false, error: 'Invalid or expired token' });
        }
    });

    socket.on('send_message', async (data: { receiverId: number; payload: string; type: string; messageId?: string }) => {
        const senderId = (socket as any).userId;
        if (!senderId) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }

        // Input validation
        if (!data?.receiverId || !data?.payload || !data?.type) {
            socket.emit('error', { message: 'Invalid message format' });
            return;
        }

        const { receiverId, payload, type, messageId } = data;

        // Validate type
        const validTypes = ['text', 'image', 'voice', 'video', 'file'];
        if (!validTypes.includes(type)) {
            socket.emit('error', { message: 'Invalid message type' });
            return;
        }

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
                payload,
                type,
                messageId,
                timestamp
            });
            socket.emit('message_delivered', { messageId, receiverId, timestamp });
        } else {
            socket.emit('message_queued', { messageId, receiverId, status: 'offline' });
        }
    });

    socket.on('typing', (data: { receiverId: number; isTyping: boolean }) => {
        const senderId = (socket as any).userId;
        if (!senderId || !data?.receiverId) return;

        const receiverSocketId = connectedUsers.get(data.receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('user_typing', { userId: senderId, isTyping: data.isTyping });
        }
    });

    socket.on('message_read', (data: { messageId: string; senderId: number }) => {
        const readerId = (socket as any).userId;
        if (!readerId || !data?.messageId || !data?.senderId) return;

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

    // Error handling for socket
    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Start server
async function startServer() {
    try {
        await initDb();
        server.listen(PORT, () => {
            console.log(`🚀 Stealth Messenger Backend running on port ${PORT}`);
            console.log(`📊 Max users: ${MAX_USERS}`);
            console.log(`🔐 JWT Secret: ${JWT_SECRET !== 'fallback-secret-change-in-production' ? 'Custom (secure)' : 'Default (INSECURE)'}`);
            console.log(`🌐 CORS Origins: ${ALLOWED_ORIGINS.join(', ')}`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

export { io, JWT_SECRET, MAX_USERS };
