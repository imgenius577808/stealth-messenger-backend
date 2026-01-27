import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { getDb, dbRun, dbGet, dbAll, saveDb } from '../db/database';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
const MAX_USERS = parseInt(process.env.MAX_USERS || '2');

// Input sanitization helper
function sanitizeUsername(username: string): string {
    return username.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50);
}

// Validate username
function isValidUsername(username: string): boolean {
    return /^[a-zA-Z0-9_-]{3,50}$/.test(username);
}

// Register new user
router.post('/register', (req: Request, res: Response) => {
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
        const countResult = dbGet('SELECT COUNT(*) as count FROM users');
        if (countResult && countResult.count >= MAX_USERS) {
            return res.status(403).json({ error: `Maximum ${MAX_USERS} users allowed. Registration closed.` });
        }

        // Check if username exists
        const existing = dbGet('SELECT id FROM users WHERE username = ?', [cleanUsername]);
        if (existing) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        // Insert user
        const result = dbRun(
            'INSERT INTO users (username, registration_id, identity_key) VALUES (?, ?, ?)',
            [cleanUsername, registrationId, identityKey]
        );

        const userId = result.lastInsertRowid;

        // Store signed pre-key
        if (signedPreKey && signedPreKey.keyId && signedPreKey.publicKey && signedPreKey.signature) {
            dbRun(
                'INSERT INTO pre_keys (user_id, key_id, public_key, is_signed, signature) VALUES (?, ?, ?, 1, ?)',
                [userId, signedPreKey.keyId, signedPreKey.publicKey, signedPreKey.signature]
            );
        }

        // Store pre-keys
        if (preKeys && Array.isArray(preKeys)) {
            for (const pk of preKeys) {
                if (pk.keyId && pk.publicKey) {
                    dbRun(
                        'INSERT INTO pre_keys (user_id, key_id, public_key, is_signed) VALUES (?, ?, ?, 0)',
                        [userId, pk.keyId, pk.publicKey]
                    );
                }
            }
        }

        // Generate JWT with userId and username
        const token = jwt.sign({ userId, username: cleanUsername }, JWT_SECRET, { expiresIn: '30d' });

        res.status(201).json({
            success: true,
            userId,
            username: cleanUsername,
            token
        });

    } catch (error: any) {
        console.error('Registration error:', error.message);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
router.post('/login', (req: Request, res: Response) => {
    try {
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({ error: 'Username required' });
        }

        const cleanUsername = sanitizeUsername(username);
        const user = dbGet('SELECT id, username FROM users WHERE username = ?', [cleanUsername]);

        if (!user) {
            // Use generic message to prevent username enumeration
            return res.status(401).json({ error: 'Invalid credentials' });
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
        console.error('Login error:', error.message);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Get partner user (only returns the other user, not all users)
router.get('/partner', authenticateToken, (req: Request, res: Response) => {
    try {
        const currentUserId = (req as any).user.userId;
        const partner = dbGet('SELECT id, username, last_seen FROM users WHERE id != ?', [currentUserId]);

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
    } catch (error: any) {
        console.error('Get partner error:', error.message);
        res.status(500).json({ error: 'Failed to get partner' });
    }
});

// Get own profile
router.get('/me', authenticateToken, (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.userId;
        const user = dbGet('SELECT id, username, last_seen, created_at FROM users WHERE id = ?', [userId]);

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
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

// Verify token middleware
export function authenticateToken(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; username: string };
        (req as any).user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

export default router;
