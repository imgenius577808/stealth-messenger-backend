"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const database_1 = require("../db/database");
const auth_1 = require("./auth");
const router = (0, express_1.Router)();
// Configure multer for encrypted file storage
const uploadDir = process.env.NODE_ENV === 'production' ? '/tmp/uploads' : './uploads';
// Ensure upload directory exists
if (!fs_1.default.existsSync(uploadDir)) {
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
}
// Allowed file types (all files are encrypted, so we check by extension only for sanity)
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.pdf', '.txt', '.enc'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB max
// File filter for security
const fileFilter = (req, file, cb) => {
    const ext = path_1.default.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext) || ext === '') {
        cb(null, true);
    }
    else {
        cb(new Error('File type not allowed'));
    }
};
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate secure random filename
        const uniqueName = `${(0, uuid_1.v4)()}${path_1.default.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});
const upload = (0, multer_1.default)({
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1 // Only 1 file per request
    }
});
// Error handler for multer
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer_1.default.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large. Maximum size is 50MB.' });
        }
        return res.status(400).json({ error: err.message });
    }
    else if (err) {
        return res.status(400).json({ error: err.message });
    }
    next();
};
// Upload encrypted media
router.post('/upload', auth_1.authenticateToken, upload.single('file'), handleMulterError, (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const userId = req.user.userId;
        const { encryptionKeyHash } = req.body;
        // Validate encryptionKeyHash if provided
        if (encryptionKeyHash && typeof encryptionKeyHash !== 'string') {
            // Delete uploaded file
            fs_1.default.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Invalid encryptionKeyHash' });
        }
        const result = (0, database_1.dbRun)('INSERT INTO media (user_id, filename, original_name, mime_type, size, encryption_key_hash) VALUES (?, ?, ?, ?, ?, ?)', [userId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, encryptionKeyHash || null]);
        res.json({
            success: true,
            mediaId: result.lastInsertRowid,
            filename: req.file.filename,
            url: `/media/download/${req.file.filename}`,
            size: req.file.size
        });
    }
    catch (error) {
        console.error('Upload error:', error.message);
        // Clean up file on error
        if (req.file) {
            try {
                fs_1.default.unlinkSync(req.file.path);
            }
            catch (e) { }
        }
        res.status(500).json({ error: 'Upload failed' });
    }
});
// Download encrypted media
router.get('/download/:filename', auth_1.authenticateToken, (req, res) => {
    try {
        const filename = req.params.filename;
        const userId = req.user.userId;
        // Sanitize filename to prevent path traversal
        const sanitizedFilename = path_1.default.basename(filename);
        if (sanitizedFilename !== filename || filename.includes('..')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        // Verify file belongs to user or is shared with them
        const media = (0, database_1.dbGet)('SELECT user_id FROM media WHERE filename = ?', [sanitizedFilename]);
        if (!media) {
            return res.status(404).json({ error: 'File not found' });
        }
        // For this 2-user system, allow both users to download
        // In a multi-user system, add proper access control
        const filePath = path_1.default.join(uploadDir, sanitizedFilename);
        if (!fs_1.default.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        // Set security headers
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.sendFile(path_1.default.resolve(filePath));
    }
    catch (error) {
        console.error('Download error:', error.message);
        res.status(500).json({ error: 'Download failed' });
    }
});
// Delete media
router.delete('/:mediaId', auth_1.authenticateToken, (req, res) => {
    try {
        const mediaId = parseInt(req.params.mediaId);
        const userId = req.user.userId;
        if (isNaN(mediaId) || mediaId < 1) {
            return res.status(400).json({ error: 'Invalid mediaId' });
        }
        const media = (0, database_1.dbGet)('SELECT filename FROM media WHERE id = ? AND user_id = ?', [mediaId, userId]);
        if (!media) {
            return res.status(404).json({ error: 'Media not found or unauthorized' });
        }
        // Delete file
        const filePath = path_1.default.join(uploadDir, media.filename);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
        }
        // Delete record
        (0, database_1.dbRun)('DELETE FROM media WHERE id = ?', [mediaId]);
        res.json({ success: true });
    }
    catch (error) {
        console.error('Delete error:', error.message);
        res.status(500).json({ error: 'Delete failed' });
    }
});
// Get user's media list
router.get('/list', auth_1.authenticateToken, (req, res) => {
    try {
        const userId = req.user.userId;
        const media = (0, database_1.dbAll)('SELECT id, filename, original_name, mime_type, size, created_at FROM media WHERE user_id = ? ORDER BY id DESC LIMIT 100', [userId]);
        res.json({
            media: media.map(m => ({
                id: m.id,
                filename: m.filename,
                originalName: m.original_name,
                mimeType: m.mime_type,
                size: m.size,
                createdAt: m.created_at
            }))
        });
    }
    catch (error) {
        console.error('List error:', error.message);
        res.status(500).json({ error: 'Failed to list media' });
    }
});
exports.default = router;
//# sourceMappingURL=media.js.map