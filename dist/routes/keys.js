"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../db/database");
const auth_1 = require("./auth");
const router = (0, express_1.Router)();
// Get user's key bundle (for establishing Signal session) - requires auth
router.get('/bundle/:userId', auth_1.authenticateToken, (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const requestingUserId = req.user.userId;
        if (isNaN(userId) || userId < 1) {
            return res.status(400).json({ error: 'Invalid userId' });
        }
        // Get user info
        const user = (0, database_1.dbGet)('SELECT id, username, registration_id, identity_key FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Get signed pre-key
        const signedPreKey = (0, database_1.dbGet)('SELECT key_id, public_key, signature FROM pre_keys WHERE user_id = ? AND is_signed = 1 ORDER BY id DESC LIMIT 1', [userId]);
        // Get one-time pre-key count for monitoring
        const preKeyCount = (0, database_1.dbGet)('SELECT COUNT(*) as count FROM pre_keys WHERE user_id = ? AND is_signed = 0', [userId]);
        // Get one-time pre-key (and remove it after use)
        const preKey = (0, database_1.dbGet)('SELECT id, key_id, public_key FROM pre_keys WHERE user_id = ? AND is_signed = 0 LIMIT 1', [userId]);
        if (preKey) {
            // Remove used pre-key
            (0, database_1.dbRun)('DELETE FROM pre_keys WHERE id = ?', [preKey.id]);
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
    }
    catch (error) {
        console.error('Get bundle error:', error.message);
        res.status(500).json({ error: 'Failed to retrieve key bundle' });
    }
});
// Upload new pre-keys
router.post('/prekeys', auth_1.authenticateToken, (req, res) => {
    try {
        const { preKeys } = req.body;
        const userId = req.user.userId;
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
                    (0, database_1.dbRun)('INSERT OR REPLACE INTO pre_keys (user_id, key_id, public_key, is_signed) VALUES (?, ?, ?, 0)', [userId, pk.keyId, pk.publicKey]);
                    insertedCount++;
                }
                catch (e) {
                    // Skip invalid keys
                }
            }
        }
        res.json({ success: true, inserted: insertedCount });
    }
    catch (error) {
        console.error('Upload prekeys error:', error.message);
        res.status(500).json({ error: 'Failed to upload pre-keys' });
    }
});
// Update signed pre-key
router.post('/signed-prekey', auth_1.authenticateToken, (req, res) => {
    try {
        const { keyId, publicKey, signature } = req.body;
        const userId = req.user.userId;
        if (!keyId || !publicKey || !signature) {
            return res.status(400).json({ error: 'keyId, publicKey, and signature required' });
        }
        if (typeof keyId !== 'number') {
            return res.status(400).json({ error: 'keyId must be a number' });
        }
        // Delete old signed pre-key
        (0, database_1.dbRun)('DELETE FROM pre_keys WHERE user_id = ? AND is_signed = 1', [userId]);
        // Insert new one
        (0, database_1.dbRun)('INSERT INTO pre_keys (user_id, key_id, public_key, is_signed, signature) VALUES (?, ?, ?, 1, ?)', [userId, keyId, publicKey, signature]);
        res.json({ success: true });
    }
    catch (error) {
        console.error('Update signed prekey error:', error.message);
        res.status(500).json({ error: 'Failed to update signed pre-key' });
    }
});
// Get pre-key count (for client to know when to replenish)
router.get('/prekey-count', auth_1.authenticateToken, (req, res) => {
    try {
        const userId = req.user.userId;
        const result = (0, database_1.dbGet)('SELECT COUNT(*) as count FROM pre_keys WHERE user_id = ? AND is_signed = 0', [userId]);
        res.json({ count: result?.count ?? 0 });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get pre-key count' });
    }
});
exports.default = router;
//# sourceMappingURL=keys.js.map