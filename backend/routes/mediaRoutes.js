const express = require('express');
const { analyzeMedia, downloadMedia, healthCheck } = require('../controllers/mediaController');
const { validateAnalyzeBody, validateDownloadBody } = require('../middlewares/security');

const router = express.Router();

router.get('/health', healthCheck);
router.post('/analyze', validateAnalyzeBody, analyzeMedia);
router.post('/download', validateDownloadBody, downloadMedia);

module.exports = router;
