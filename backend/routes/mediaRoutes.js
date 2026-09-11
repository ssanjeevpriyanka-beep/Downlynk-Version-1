const express = require('express');
const {
  analyzeMedia,
  downloadMedia,
  downloadProgress,
  healthCheck
} = require('../controllers/mediaController');
const { validateAnalyzeBody, validateDownloadBody } = require('../middlewares/security');

const router = express.Router();

router.get('/health', healthCheck);
router.post('/analyze', validateAnalyzeBody, analyzeMedia);
router.post('/download', validateDownloadBody, downloadMedia);
router.get('/download-progress/:requestId', downloadProgress);

module.exports = router;
