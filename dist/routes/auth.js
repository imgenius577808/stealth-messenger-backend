"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = authenticateToken;
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_1 = require("../db/database");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
const MAX_USERS = parseInt(process.env.MAX_USERS || '2');
// Input sanitization helper
function sanitizeUsername(username) {
    return username.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50);
}
// Validate username
function isValidUsername(username) {
    return /^[a-zA-Z0-9_-]{3,50}$/.test(username);
}
// Register new user
router.post('/register', (req, res) => {
    try {
        const { username, identityKey, registrationId, signedPreKey, preKeys } = req.body;
        // Validation
        if (!username || !identityKey || !registrationId) {
            return res.status(400).json({ error: 'Missing required fields: username, identityKey, registrationId' });
        }
        const cleanUsername = sanitizeUsername(username);
        if (!isValidUsername(cleanUsername)) {
            return res.status(400).json({ error: 'Invalid username. Use 3-50 alphanumeric characters, underscores, or hyphens.' });
        }
        // Validate registrationId is a number
        if (typeof registrationId !== 'number' || registrationId < 1) {
            return res.status(400).json({ error: 'Invalid registrationId' });
        }
        // Check user limit
        const countResult = (0, database_1.dbGet)('SELECT COUNT(*) as count FROM users');
        if (countResult && countResult.count >= MAX_USERS) {
            return res.status(403).json({ error: `Maximum ${MAX_USERS} users allowed. Registration closed.` });
        }
        // Check if username exists
        const existing = (0, database_1.dbGet)('SELECT id FROM users WHERE username = ?', [cleanUsername]);
        if (existing) {
            return res.status(409).json({ error: 'Username already taken' });
        }
        // Insert user
        const result = (0, database_1.dbRun)('INSERT INTO users (username, registration_id, identity_key) VALUES (?, ?, ?)', [cleanUsername, registrationId, identityKey]);
        const userId = result.lastInsertRowid;
        // Store signed pre-key
        if (signedPreKey && signedPreKey.keyId && signedPreKey.publicKey && signedPreKey.signature) {
            (0, database_1.dbRun)('INSERT INTO pre_keys (user_id, key_id, public_key, is_signed, signature) VALUES (?, ?, ?, 1, ?)', [userId, signedPreKey.keyId, signedPreKey.publicKey, signedPreKey.signature]);
        }
        // Store pre-keys
        if (preKeys && Array.isArray(preKeys)) {
            for (const pk of preKeys) {
                if (pk.keyId && pk.publicKey) {
                    (0, database_1.dbRun)('INSERT INTO pre_keys (user_id, key_id, public_key, is_signed) VALUES (?, ?, ?, 0)', [userId, pk.keyId, pk.publicKey]);
                }
            }
        }
        // Generate JWT with userId and username
        const token = jsonwebtoken_1.default.sign({ userId, username: cleanUsername }, JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({
            success: true,
            userId,
            username: cleanUsername,
            token
        });
    }
    catch (error) {
        console.error('Registration error:', error.message);
        res.status(500).json({ error: 'Registration failed' });
    }
});
// Login
router.post('/login', (req, res) => {
    try {
        const { username } = req.body;
        if (!username) {
            return res.status(400).json({ error: 'Username required' });
        }
        const cleanUsername = sanitizeUsername(username);
        const user = (0, database_1.dbGet)('SELECT id, username FROM users WHERE username = ?', [cleanUsername]);
        if (!user) {
            // Use generic message to prevent username enumeration
            return res.status(401).json({ error: 'Invalid credentials' });
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
        console.error('Login error:', error.message);
        res.status(500).json({ error: 'Login failed' });
    }
});
// Get partner user (only returns the other user, not all users)
router.get('/partner', authenticateToken, (req, res) => {
    try {
        const currentUserId = req.user.userId;
        const partner = (0, database_1.dbGet)('SELECT id, username, last_seen FROM users WHERE id != ?', [currentUserId]);
        if (!partner) {
            return res.status(404).json({ error: 'No partner found' });
        }
        res.json({
            partner: {
                id: partner.id,
                username: partner.username,
                lastSeen: partner.last_seen
            }
        });
    }
    catch (error) {
        console.error('Get partner error:', error.message);
        res.status(500).json({ error: 'Failed to get partner' });
    }
});
// Get own profile
router.get('/me', authenticateToken, (req, res) => {
    try {
        const userId = req.user.userId;
        const user = (0, database_1.dbGet)('SELECT id, username, last_seen, created_at FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({
            user: {
                id: user.id,
                username: user.username,
                lastSeen: user.last_seen,
                createdAt: user.created_at
            }
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get profile' });
    }
});
// Verify token middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}
exports.default = router;
//# sourceMappingURL=auth.js.map