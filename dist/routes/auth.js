"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = void 0;
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_1 = require("../db/database");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET || 'stealth-secret-key';
const MAX_USERS = parseInt(process.env.MAX_USERS || '2');
// Register new user
router.post('/register', (req, res) => {
    try {
        const { username, identityKey, registrationId, signedPreKey, preKeys } = req.body;
        if (!username || !identityKey || !registrationId) {
            return res.status(400).json({ error: 'Missing required fields: username, identityKey, registrationId' });
        }
        // Check user limit
        const countResult = (0, database_1.dbGet)('SELECT COUNT(*) as count FROM users');
        if (countResult && countResult.count >= MAX_USERS) {
            return res.status(403).json({ error: `Maximum ${MAX_USERS} users allowed. Registration closed.` });
        }
        // Check if username exists
        const existing = (0, database_1.dbGet)('SELECT id FROM users WHERE username = ?', [username]);
        if (existing) {
            return res.status(400).json({ error: 'Username already taken' });
        }
        // Insert user
        const result = (0, database_1.dbRun)('INSERT INTO users (username, registration_id, identity_key) VALUES (?, ?, ?)', [username, registrationId, identityKey]);
        const userId = result.lastInsertRowid;
        // Store signed pre-key
        if (signedPreKey) {
            (0, database_1.dbRun)('INSERT INTO pre_keys (user_id, key_id, public_key, is_signed, signature) VALUES (?, ?, ?, 1, ?)', [userId, signedPreKey.keyId, signedPreKey.publicKey, signedPreKey.signature]);
        }
        // Store pre-keys
        if (preKeys && Array.isArray(preKeys)) {
            for (const pk of preKeys) {
                (0, database_1.dbRun)('INSERT INTO pre_keys (user_id, key_id, public_key, is_signed) VALUES (?, ?, ?, 0)', [userId, pk.keyId, pk.publicKey]);
            }
        }
        // Generate JWT
        const token = jsonwebtoken_1.default.sign({ userId, username }, JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({
            success: true,
            userId,
            username,
            token
        });
    }
    catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: error.message });
    }
});
// Login
router.post('/login', (req, res) => {
    try {
        const { username } = req.body;
        if (!username) {
            return res.status(400).json({ error: 'Username required' });
        }
        const user = (0, database_1.dbGet)('SELECT id, username FROM users WHERE username = ?', [username]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Update last seen
        (0, database_1.dbRun)('UPDATE users SET last_seen = datetime("now") WHERE id = ?', [user.id]);
        // Generate JWT
        const token = jsonwebtoken_1.default.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
        res.json({
            success: true,
            userId: user.id,
            username: user.username,
            token
        });
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});
// Get all users (for finding chat partner)
router.get('/users', (req, res) => {
    try {
        const users = (0, database_1.dbAll)('SELECT id, username, last_seen FROM users');
        res.json({ users });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Verify token middleware export
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
}
exports.authenticateToken = authenticateToken;
exports.default = router;
//# sourceMappingURL=auth.js.map