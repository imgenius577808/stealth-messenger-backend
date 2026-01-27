import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { getDb, dbRun, dbGet, dbAll, saveDb } from '../db/database';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'stealth-secret-key';
const MAX_USERS = parseInt(process.env.MAX_USERS || '2');

// Register new user
router.post('/register', (req: Request, res: Response) => {
    try {
        const { username, identityKey, registrationId, signedPreKey, preKeys } = req.body;

        if (!username || !identityKey || !registrationId) {
            return res.status(400).json({ error: 'Missing required fields: username, identityKey, registrationId' });
        }

        // Check user limit
        const countResult = dbGet('SELECT COUNT(*) as count FROM users');
        if (countResult && countResult.count >= MAX_USERS) {
            return res.status(403).json({ error: `Maximum ${MAX_USERS} users allowed. Registration closed.` });
        }

        // Check if username exists
        const existing = dbGet('SELECT id FROM users WHERE username = ?', [username]);
        if (existing) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        // Insert user
        const result = dbRun(
            'INSERT INTO users (username, registration_id, identity_key) VALUES (?, ?, ?)',
            [username, registrationId, identityKey]
        );

        const userId = result.lastInsertRowid;

        // Store signed pre-key
        if (signedPreKey) {
            dbRun(
                'INSERT INTO pre_keys (user_id, key_id, public_key, is_signed, signature) VALUES (?, ?, ?, 1, ?)',
                [userId, signedPreKey.keyId, signedPreKey.publicKey, signedPreKey.signature]
            );
        }

        // Store pre-keys
        if (preKeys && Array.isArray(preKeys)) {
            for (const pk of preKeys) {
                dbRun(
                    'INSERT INTO pre_keys (user_id, key_id, public_key, is_signed) VALUES (?, ?, ?, 0)',
                    [userId, pk.keyId, pk.publicKey]
                );
            }
        }

        // Generate JWT
        const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '30d' });

        res.status(201).json({
            success: true,
            userId,
            username,
            token
        });

    } catch (error: any) {
        console.error('Registration error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Login
router.post('/login', (req: Request, res: Response) => {
    try {
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({ error: 'Username required' });
        }

        const user = dbGet('SELECT id, username FROM users WHERE username = ?', [username]);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update last seen
        dbRun('UPDATE users SET last_seen = datetime("now") WHERE id = ?', [user.id]);

        // Generate JWT
        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

        res.json({
            success: true,
            userId: user.id,
            username: user.username,
            token
        });

    } catch (error: any) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all users (for finding chat partner)
router.get('/users', (req: Request, res: Response) => {
    try {
        const users = dbAll('SELECT id, username, last_seen FROM users');
        res.json({ users });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Verify token middleware export
export function authenticateToken(req: Request, res: Response, next: Function) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; username: string };
        (req as any).user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
}

export default router;
