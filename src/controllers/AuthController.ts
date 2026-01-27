import { Router } from 'express';
import { UserService } from '../services/UserService';
import { KeyService } from '../services/KeyService';

const router = Router();

router.post('/register', async (req, res) => {
    try {
        const { username, registrationId, identityKey, preKeys, signedPreKey } = req.body;

        if (!username || !registrationId || !identityKey) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const user = await UserService.register(username, registrationId, identityKey);

        if (preKeys && signedPreKey) {
            await KeyService.storePreKeys(user.id as number, preKeys, signedPreKey);
        }

        const token = UserService.generateToken(user.id as number, user.username);
        res.json({ user, token });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/bundle/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const bundle = await KeyService.getPreKeyBundle(username);
        res.json(bundle);
    } catch (error: any) {
        res.status(404).json({ error: error.message });
    }
});

export default router;
