import { Router, Request, Response } from 'express';
import { getDb, dbRun, dbGet, dbAll } from '../db/database';
import { authenticateToken } from './auth';

const router = Router();

// Get user's key bundle (for establishing Signal session) - requires auth
router.get('/bundle/:userId', authenticateToken, (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.userId);
        const requestingUserId = (req as any).user.userId;

        if (isNaN(userId) || userId < 1) {
            return res.status(400).json({ error: 'Invalid userId' });
        }

        // Get user info
        const user = dbGet(
            'SELECT id, username, registration_id, identity_key FROM users WHERE id = ?',
            [userId]
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get signed pre-key
        const signedPreKey = dbGet(
            'SELECT key_id, public_key, signature FROM pre_keys WHERE user_id = ? AND is_signed = 1 ORDER BY id DESC LIMIT 1',
            [userId]
        );

        // Get one-time pre-key count for monitoring
        const preKeyCount = dbGet(
            'SELECT COUNT(*) as count FROM pre_keys WHERE user_id = ? AND is_signed = 0',
            [userId]
        ) as { count: number } | null;

        // Get one-time pre-key (and remove it after use)
        const preKey = dbGet(
            'SELECT id, key_id, public_key FROM pre_keys WHERE user_id = ? AND is_signed = 0 LIMIT 1',
            [userId]
        );

        if (preKey) {
            // Remove used pre-key
            dbRun('DELETE FROM pre_keys WHERE id = ?', [preKey.id]);
        }

        // Warn if pre-keys are running low
        if (preKeyCount && preKeyCount.count < 5) {
            console.warn(`Low pre-key count for user ${userId}: ${preKeyCount.count}`);
        }

        res.json({
            registrationId: user.registration_id,
            identityKey: user.identity_key,
            signedPreKey: signedPreKey ? {
                keyId: signedPreKey.key_id,
                publicKey: signedPreKey.public_key,
                signature: signedPreKey.signature
            } : null,
            preKey: preKey ? {
                keyId: preKey.key_id,
                publicKey: preKey.public_key
            } : null,
            preKeysRemaining: preKeyCount?.count ?? 0
        });

    } catch (error: any) {
        console.error('Get bundle error:', error.message);
        res.status(500).json({ error: 'Failed to retrieve key bundle' });
    }
});

// Upload new pre-keys
router.post('/prekeys', authenticateToken, (req: Request, res: Response) => {
    try {
        const { preKeys } = req.body;
        const userId = (req as any).user.userId;

        if (!preKeys || !Array.isArray(preKeys)) {
            return res.status(400).json({ error: 'preKeys array required' });
        }

        if (preKeys.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 pre-keys per request' });
        }

        let insertedCount = 0;
        for (const pk of preKeys) {
            if (pk.keyId && pk.publicKey && typeof pk.keyId === 'number') {
                try {
                    dbRun(
                        'INSERT OR REPLACE INTO pre_keys (user_id, key_id, public_key, is_signed) VALUES (?, ?, ?, 0)',
                        [userId, pk.keyId, pk.publicKey]
                    );
                    insertedCount++;
                } catch (e) {
                    // Skip invalid keys
                }
            }
        }

        res.json({ success: true, inserted: insertedCount });

    } catch (error: any) {
        console.error('Upload prekeys error:', error.message);
        res.status(500).json({ error: 'Failed to upload pre-keys' });
    }
});

// Update signed pre-key
router.post('/signed-prekey', authenticateToken, (req: Request, res: Response) => {
    try {
        const { keyId, publicKey, signature } = req.body;
        const userId = (req as any).user.userId;

        if (!keyId || !publicKey || !signature) {
            return res.status(400).json({ error: 'keyId, publicKey, and signature required' });
        }

        if (typeof keyId !== 'number') {
            return res.status(400).json({ error: 'keyId must be a number' });
        }

        // Delete old signed pre-key
        dbRun('DELETE FROM pre_keys WHERE user_id = ? AND is_signed = 1', [userId]);

        // Insert new one
        dbRun(
            'INSERT INTO pre_keys (user_id, key_id, public_key, is_signed, signature) VALUES (?, ?, ?, 1, ?)',
            [userId, keyId, publicKey, signature]
        );

        res.json({ success: true });

    } catch (error: any) {
        console.error('Update signed prekey error:', error.message);
        res.status(500).json({ error: 'Failed to update signed pre-key' });
    }
});

// Get pre-key count (for client to know when to replenish)
router.get('/prekey-count', authenticateToken, (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.userId;
        const result = dbGet(
            'SELECT COUNT(*) as count FROM pre_keys WHERE user_id = ? AND is_signed = 0',
            [userId]
        );

        res.json({ count: result?.count ?? 0 });

    } catch (error: any) {
        res.status(500).json({ error: 'Failed to get pre-key count' });
    }
});

export default router;
