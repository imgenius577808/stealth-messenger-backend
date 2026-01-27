"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../db/database");
const auth_1 = require("./auth");
const router = (0, express_1.Router)();
// Get user's key bundle (for establishing Signal session)
router.get('/bundle/:userId', (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        // Get user info
        const user = (0, database_1.dbGet)('SELECT id, username, registration_id, identity_key FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Get signed pre-key
        const signedPreKey = (0, database_1.dbGet)('SELECT key_id, public_key, signature FROM pre_keys WHERE user_id = ? AND is_signed = 1 ORDER BY id DESC LIMIT 1', [userId]);
        // Get one-time pre-key (and remove it after use)
        const preKey = (0, database_1.dbGet)('SELECT id, key_id, public_key FROM pre_keys WHERE user_id = ? AND is_signed = 0 LIMIT 1', [userId]);
        if (preKey) {
            // Remove used pre-key
            (0, database_1.dbRun)('DELETE FROM pre_keys WHERE id = ?', [preKey.id]);
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
    }
    catch (error) {
        console.error('Get bundle error:', error);
        res.status(500).json({ error: error.message });
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
        for (const pk of preKeys) {
            (0, database_1.dbRun)('INSERT OR REPLACE INTO pre_keys (user_id, key_id, public_key, is_signed) VALUES (?, ?, ?, 0)', [userId, pk.keyId, pk.publicKey]);
        }
        res.json({ success: true, count: preKeys.length });
    }
    catch (error) {
        console.error('Upload prekeys error:', error);
        res.status(500).json({ error: error.message });
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
        // Delete old signed pre-key
        (0, database_1.dbRun)('DELETE FROM pre_keys WHERE user_id = ? AND is_signed = 1', [userId]);
        // Insert new one
        (0, database_1.dbRun)('INSERT INTO pre_keys (user_id, key_id, public_key, is_signed, signature) VALUES (?, ?, ?, 1, ?)', [userId, keyId, publicKey, signature]);
        res.json({ success: true });
    }
    catch (error) {
        console.error('Update signed prekey error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=keys.js.map