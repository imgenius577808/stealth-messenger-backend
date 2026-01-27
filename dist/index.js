"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_USERS = exports.JWT_SECRET = exports.io = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_1 = require("./db/database");
const auth_1 = __importDefault(require("./routes/auth"));
const media_1 = __importDefault(require("./routes/media"));
const keys_1 = __importDefault(require("./routes/keys"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});
exports.io = io;
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Routes
app.use('/auth', auth_1.default);
app.use('/media', media_1.default);
app.use('/keys', keys_1.default);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'stealth-secret-key';
exports.JWT_SECRET = JWT_SECRET;
const MAX_USERS = parseInt(process.env.MAX_USERS || '2');
exports.MAX_USERS = MAX_USERS;
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
const connectedUsers = new Map();
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('authenticate', async (data) => {
        try {
            const decoded = jsonwebtoken_1.default.verify(data.token, JWT_SECRET);
            connectedUsers.set(decoded.userId, socket.id);
            socket.join(`user_${decoded.userId}`);
            socket.userId = decoded.userId;
            console.log(`User ${decoded.userId} authenticated`);
            socket.emit('authenticated', { success: true, userId: decoded.userId });
        }
        catch (error) {
            socket.emit('authenticated', { success: false, error: 'Invalid token' });
        }
    });
    socket.on('send_message', async (data) => {
        const senderId = socket.userId;
        if (!senderId) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }
        const { receiverId, payload, type, messageId } = data;
        const timestamp = new Date();
        // Store message metadata
        try {
            (0, database_1.dbRun)('INSERT INTO messages (sender_id, receiver_id, payload_hash, type, state, timestamp) VALUES (?, ?, ?, ?, ?, ?)', [senderId, receiverId, messageId || 'msg_' + Date.now(), type, 'sent', timestamp.toISOString()]);
        }
        catch (e) {
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
        }
        else {
            socket.emit('message_queued', { messageId, receiverId });
        }
    });
    socket.on('typing', (data) => {
        const senderId = socket.userId;
        if (!senderId)
            return;
        const receiverSocketId = connectedUsers.get(data.receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('user_typing', { userId: senderId, isTyping: data.isTyping });
        }
    });
    socket.on('message_read', (data) => {
        const readerId = socket.userId;
        if (!readerId)
            return;
        const senderSocketId = connectedUsers.get(data.senderId);
        if (senderSocketId) {
            io.to(senderSocketId).emit('message_read_receipt', { messageId: data.messageId, readBy: readerId });
        }
    });
    socket.on('disconnect', () => {
        const userId = socket.userId;
        if (userId) {
            connectedUsers.delete(userId);
            console.log(`User ${userId} disconnected`);
        }
    });
});
// Start server
async function startServer() {
    try {
        await (0, database_1.initDb)();
        server.listen(PORT, () => {
            console.log(`🚀 Stealth Messenger Backend running on port ${PORT}`);
            console.log(`📊 Max users: ${MAX_USERS}`);
            console.log(`🔐 JWT Secret configured: ${JWT_SECRET !== 'stealth-secret-key' ? 'Yes' : 'Using default'}`);
        });
    }
    catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}
startServer();
//# sourceMappingURL=index.js.map