const express = require('express');
const {
  createBooking,
  myBookings,
  allBookings,
  releaseBooking,
  batchAction,
} = require('../controllers/booking.controller');

const router = express.Router();

router.post('/booking', createBooking);
router.get('/my-bookings', myBookings);
router.get('/bookings', allBookings);
router.post('/bookings/batch-action', batchAction);
router.put('/bookings/:id/release', releaseBooking);

module.exports = router;
