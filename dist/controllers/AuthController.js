"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const UserService_1 = require("../services/UserService");
const KeyService_1 = require("../services/KeyService");
const router = (0, express_1.Router)();
router.post('/register', async (req, res) => {
    try {
        const { username, registrationId, identityKey, preKeys, signedPreKey } = req.body;
        if (!username || !registrationId || !identityKey) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const user = await UserService_1.UserService.register(username, registrationId, identityKey);
        if (preKeys && signedPreKey) {
            await KeyService_1.KeyService.storePreKeys(user.id, preKeys, signedPreKey);
        }
        const token = UserService_1.UserService.generateToken(user.id, user.username);
        res.json({ user, token });
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
router.get('/bundle/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const bundle = await KeyService_1.KeyService.getPreKeyBundle(username);
        res.json(bundle);
    }
    catch (error) {
        res.status(404).json({ error: error.message });
    }
});
exports.default = router;
