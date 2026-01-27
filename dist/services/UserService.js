"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const database_1 = require("../db/database");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
class UserService {
    static async register(username, registrationId, identityKey) {
        const db = (0, database_1.getDb)();
        // Check if max users reached
        const userCount = await db.get('SELECT COUNT(*) as count FROM users');
        const maxUsers = parseInt(process.env.MAX_USERS || '2');
        if (userCount.count >= maxUsers) {
            throw new Error('Maximum user limit reached');
        }
        // Check if user already exists
        const existingUser = await db.get('SELECT * FROM users WHERE username = ?', [username]);
        if (existingUser) {
            throw new Error('User already exists');
        }
        const result = await db.run('INSERT INTO users (username, registration_id, identity_key) VALUES (?, ?, ?)', [username, registrationId, identityKey]);
        if (result.lastID === undefined) {
            throw new Error('Failed to retrieve user ID');
        }
        return { id: result.lastID, username, registrationId };
    }
    static async findByUsername(username) {
        const db = (0, database_1.getDb)();
        return await db.get('SELECT * FROM users WHERE username = ?', [username]);
    }
    static async findById(id) {
        const db = (0, database_1.getDb)();
        return await db.get('SELECT * FROM users WHERE id = ?', [id]);
    }
    static generateToken(userId, username) {
        return jsonwebtoken_1.default.sign({ userId, username }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
    }
}
exports.UserService = UserService;
