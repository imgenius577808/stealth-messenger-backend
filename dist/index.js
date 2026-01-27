"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const database_1 = require("./db/database");
const AuthController_1 = __importDefault(require("./controllers/AuthController"));
const MediaController_1 = __importDefault(require("./controllers/MediaController"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/auth', AuthController_1.default);
app.use('/media', MediaController_1.default);
const PORT = process.env.PORT || 3000;
// Basic health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});
// Socket.io logic
const connectedUsers = new Map(); // userId -> socketId
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    socket.on('authenticate', async (data) => {
        try {
            const decoded = jsonwebtoken_1.default.verify(data.token, process.env.JWT_SECRET || 'secret');
            connectedUsers.set(decoded.userId, socket.id);
            socket.join(`user_${decoded.userId}`);
            console.log(`User ${decoded.userId} authenticated`);
            socket.emit('authenticated', { success: true });
        }
        catch (error) {
            socket.emit('authenticated', { success: false, error: 'Invalid token' });
        }
    });
    socket.on('send_message', async (data) => {
        // Enforce sender authentication (simplified for now)
        const senderEntry = Array.from(connectedUsers.entries()).find(([uid, sid]) => sid === socket.id);
        if (!senderEntry)
            return;
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
        await (0, database_1.initDb)();
        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}
startServer();
