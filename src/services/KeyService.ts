import { getDb } from '../db/database';

export interface PreKeyBundle {
    registrationId: number;
    identityKey: string;
    signedPreKey: {
        id: number;
        publicKey: string;
        signature: string;
    };
    oneTimePreKey?: {
        id: number;
        publicKey: string;
    };
}

export class KeyService {
    static async storePreKeys(userId: number, preKeys: any[], signedPreKey: any) {
        const db = getDb();

        // Store Signed PreKey
        await db.run(
            'INSERT INTO pre_keys (user_id, key_id, public_key, is_signed, signature) VALUES (?, ?, ?, 1, ?)',
            [userId, signedPreKey.id, signedPreKey.publicKey, signedPreKey.signature]
        );

        // Store One-Time PreKeys
        for (const key of preKeys) {
            await db.run(
                'INSERT INTO pre_keys (user_id, key_id, public_key, is_signed) VALUES (?, ?, ?, 0)',
                [userId, key.id, key.publicKey]
            );
        }
    }

    static async getPreKeyBundle(username: string): Promise<PreKeyBundle> {
        const db = getDb();
        const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

        if (!user) {
            throw new Error('User not found');
        }

        const signedPreKey = await db.get(
            'SELECT * FROM pre_keys WHERE user_id = ? AND is_signed = 1 ORDER BY id DESC LIMIT 1',
            [user.id]
        );

        const oneTimePreKey = await db.get(
            'SELECT * FROM pre_keys WHERE user_id = ? AND is_signed = 0 LIMIT 1',
            [user.id]
        );

        // Delete the one-time prekey after retrieval (Signal protocol requirement)
        if (oneTimePreKey) {
            await db.run('DELETE FROM pre_keys WHERE id = ?', [oneTimePreKey.id]);
        }

        return {
            registrationId: user.registration_id,
            identityKey: user.identity_key,
            signedPreKey: {
                id: signedPreKey.key_id,
                publicKey: signedPreKey.public_key,
                signature: signedPreKey.signature
            },
            oneTimePreKey: oneTimePreKey ? {
                id: oneTimePreKey.key_id,
                publicKey: oneTimePreKey.public_key
            } : undefined
        };
    }
}
