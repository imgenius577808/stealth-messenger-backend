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
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${(0, uuid_1.v4)()}${path_1.default.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});
const upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB max
    }
});
// Upload encrypted media
router.post('/upload', auth_1.authenticateToken, upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const userId = req.user.userId;
        const { encryptionKeyHash } = req.body;
        const result = (0, database_1.dbRun)('INSERT INTO media (user_id, filename, original_name, mime_type, size, encryption_key_hash) VALUES (?, ?, ?, ?, ?, ?)', [userId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, encryptionKeyHash]);
        res.json({
            success: true,
            mediaId: result.lastInsertRowid,
            filename: req.file.filename,
            url: `/media/download/${req.file.filename}`
        });
    }
    catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});
// Download encrypted media
router.get('/download/:filename', auth_1.authenticateToken, (req, res) => {
    try {
        const { filename } = req.params;
        const filePath = path_1.default.join(uploadDir, filename);
        if (!fs_1.default.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        res.sendFile(path_1.default.resolve(filePath));
    }
    catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: error.message });
    }
});
// Delete media
router.delete('/:mediaId', auth_1.authenticateToken, (req, res) => {
    try {
        const mediaId = parseInt(req.params.mediaId);
        const userId = req.user.userId;
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
        console.error('Delete error:', error);
        res.status(500).json({ error: error.message });
    }
});
// Get user's media list
router.get('/list', auth_1.authenticateToken, (req, res) => {
    try {
        const userId = req.user.userId;
        const media = (0, database_1.dbAll)('SELECT id, filename, original_name, mime_type, size, created_at FROM media WHERE user_id = ? ORDER BY id DESC', [userId]);
        res.json({ media });
    }
    catch (error) {
        console.error('List error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=media.js.map