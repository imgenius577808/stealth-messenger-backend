import { Router, Request, Response } from 'express';
import { getDb, dbRun, dbGet, dbAll } from '../db/database';
import { authenticateToken } from './auth';

const router = Router();

// Get user's key bundle (for establishing Signal session)
router.get('/bundle/:userId', (req: Request, res: Response) => {
    try {
        const userId = parseInt(req.params.userId);

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

        // Get one-time pre-key (and remove it after use)
        const preKey = dbGet(
            'SELECT id, key_id, public_key FROM pre_keys WHERE user_id = ? AND is_signed = 0 LIMIT 1',
            [userId]
        );

        if (preKey) {
            // Remove used pre-key
            dbRun('DELETE FROM pre_keys WHERE id = ?', [preKey.id]);
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
            } : null
        });

    } catch (error: any) {
        console.error('Get bundle error:', error);
        res.status(500).json({ error: error.message });
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

        for (const pk of preKeys) {
            dbRun(
                'INSERT OR REPLACE INTO pre_keys (user_id, key_id, public_key, is_signed) VALUES (?, ?, ?, 0)',
                [userId, pk.keyId, pk.publicKey]
            );
        }

        res.json({ success: true, count: preKeys.length });

    } catch (error: any) {
        console.error('Upload prekeys error:', error);
        res.status(500).json({ error: error.message });
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

        // Delete old signed pre-key
        dbRun('DELETE FROM pre_keys WHERE user_id = ? AND is_signed = 1', [userId]);

        // Insert new one
        dbRun(
            'INSERT INTO pre_keys (user_id, key_id, public_key, is_signed, signature) VALUES (?, ?, ?, 1, ?)',
            [userId, keyId, publicKey, signature]
        );

        res.json({ success: true });

    } catch (error: any) {
        console.error('Update signed prekey error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
