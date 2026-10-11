const express = require('express');
const { listLockers, updateLocker } = require('../controllers/locker.controller');

const router = express.Router();

router.get('/lockers', listLockers);
router.get('/admin/lockers', listLockers); // รองรับ alias สำหรับฝั่ง admin
router.put('/lockers/:id', updateLocker);

module.exports = router;
