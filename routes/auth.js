
const express = require('express');
const router = express.Router();
const { register, login, changePassword, getClients, getStatus } = require('../controllers/authController');
const { verifyToken, isAdmin } = require('../middleware/authMiddleware');

router.post('/register', verifyToken, isAdmin, register);
router.post('/login', login);
router.post('/register-worker', verifyToken, isAdmin, register);
router.post('/change-password', verifyToken, changePassword);
router.get('/clients', verifyToken, getClients);
router.get('/status', verifyToken, getStatus);

module.exports = router;
