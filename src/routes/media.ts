import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { dbRun, dbGet, dbAll } from '../db/database';
import { authenticateToken } from './auth';

const router = Router();

// Configure multer for encrypted file storage
const uploadDir = process.env.NODE_ENV === 'production' ? '/tmp/uploads' : './uploads';

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB max
    }
});

// Upload encrypted media
router.post('/upload', authenticateToken, upload.single('file'), (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const userId = (req as any).user.userId;
        const { encryptionKeyHash } = req.body;

        const result = dbRun(
            'INSERT INTO media (user_id, filename, original_name, mime_type, size, encryption_key_hash) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, encryptionKeyHash]
        );

        res.json({
            success: true,
            mediaId: result.lastInsertRowid,
            filename: req.file.filename,
            url: `/media/download/${req.file.filename}`
        });

    } catch (error: any) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Download encrypted media
router.get('/download/:filename', authenticateToken, (req: Request, res: Response) => {
    try {
        const { filename } = req.params;
        const filePath = path.join(uploadDir, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        res.sendFile(path.resolve(filePath));

    } catch (error: any) {
        console.error('Download error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete media
router.delete('/:mediaId', authenticateToken, (req: Request, res: Response) => {
    try {
        const mediaId = parseInt(req.params.mediaId);
        const userId = (req as any).user.userId;

        const media = dbGet('SELECT filename FROM media WHERE id = ? AND user_id = ?', [mediaId, userId]);

        if (!media) {
            return res.status(404).json({ error: 'Media not found or unauthorized' });
        }

        // Delete file
        const filePath = path.join(uploadDir, media.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        // Delete record
        dbRun('DELETE FROM media WHERE id = ?', [mediaId]);

        res.json({ success: true });

    } catch (error: any) {
        console.error('Delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get user's media list
router.get('/list', authenticateToken, (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.userId;
        const media = dbAll(
            'SELECT id, filename, original_name, mime_type, size, created_at FROM media WHERE user_id = ? ORDER BY id DESC',
            [userId]
        );

        res.json({ media });

    } catch (error: any) {
        console.error('List error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
