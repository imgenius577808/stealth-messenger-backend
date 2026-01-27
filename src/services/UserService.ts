import { getDb } from '../db/database';
import jwt from 'jsonwebtoken';

export class UserService {
    static async register(username: string, registrationId: number, identityKey: string) {
        const db = getDb();

        // Check if max users reached
        const userCount = await db.get('SELECT COUNT(*) as count FROM users');
        const maxUsers = parseInt(process.env.MAX_USERS || '2');

        if (userCount.count >= maxUsers) {
            throw new Error('Maximum user limit reached');
        }

        // Check if user already exists
        const existingUser = await db.get('SELECT * FROM users WHERE username = ?', [username]);
        if (existingUser) {
            throw new Error('User already exists');
        }

        const result = await db.run(
            'INSERT INTO users (username, registration_id, identity_key) VALUES (?, ?, ?)',
            [username, registrationId, identityKey]
        );

        if (result.lastID === undefined) {
            throw new Error('Failed to retrieve user ID');
        }

        return { id: result.lastID as number, username, registrationId };
    }

    static async findByUsername(username: string) {
        const db = getDb();
        return await db.get('SELECT * FROM users WHERE username = ?', [username]);
    }

    static async findById(id: number) {
        const db = getDb();
        return await db.get('SELECT * FROM users WHERE id = ?', [id]);
    }

    static generateToken(userId: number, username: string) {
        return jwt.sign({ userId, username }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
    }
}
