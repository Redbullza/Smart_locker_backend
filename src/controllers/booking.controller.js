const pool = require('../config/db');
const { normalizeStartTime, findOverlappingBooking } = require('../utils/scheduling');

// ==================================================================
// ส่วนที่ 3: จองตู้ล็อกเกอร์ (ฟรี ไม่มีขั้นตอนชำระเงิน)
// ผู้ใช้เลือกได้เอง 2 อย่าง:
//   1) planned_minutes — ระยะเวลาที่ตั้งใจฝาก (15 นาที - 24 ชม.)
//   2) start_time — จะเริ่มใช้เมื่อไหร่ (ไม่ระบุ = เดี๋ยวนี้ / เลือกล่วงหน้าได้ไม่เกิน 7 วัน)
// end_time คำนวณจาก start_time + planned_minutes โดยระบบ
// 1 ตู้จองซ้อนกันได้หลายช่วงเวลาตราบใดที่ไม่ชนกัน (เหมือนปฏิทินจองห้อง)
// ไม่มีการคิดค่าปรับหากคืนช้ากว่าที่เลือกไว้ (เกินเวลาแค่ขึ้นสถานะ "เกินเวลา" ให้เห็นเฉยๆ)
// ==================================================================

const MIN_PLANNED_MINUTES = 15;
const MAX_PLANNED_MINUTES = 24 * 60;

function normalizePlannedMinutes(minutes) {
  const value = Number(minutes);
  if (!Number.isInteger(value)) return null;
  if (value < MIN_PLANNED_MINUTES || value > MAX_PLANNED_MINUTES) return null;
  return value;
}

async function finalizeBooking({ user_id, locker_id, planned_minutes, start_time }) {
  const pinCode = Math.floor(100000 + Math.random() * 900000).toString();
  const endTime = new Date(start_time.getTime() + planned_minutes * 60 * 1000);

  const bookingResult = await pool.query(
    `INSERT INTO bookings (user_id, locker_id, pin_code, planned_minutes, start_time, end_time, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active') RETURNING booking_id`,
    [user_id, locker_id, pinCode, planned_minutes, start_time, endTime]
  );

  await pool.query('INSERT INTO logs (locker_id, user_id, action) VALUES ($1, $2, $3)', [locker_id, user_id, 'book']);

  return { booking_id: bookingResult.rows[0].booking_id, pin_code: pinCode, start_time, end_time: endTime };
}

async function createBooking(req, res) {
  const { user_id, locker_id, minutes, start_time } = req.body;
  if (!user_id || !locker_id) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุ user_id และ locker_id' });
  }

  const plannedMinutes = normalizePlannedMinutes(minutes);
  if (!plannedMinutes) {
    return res.status(400).json({ success: false, message: 'กรุณาเลือกระยะเวลาที่ต้องการฝาก (15 นาที - 24 ชม.)' });
  }

  const startResult = normalizeStartTime(start_time);
  if (startResult.error) {
    return res.status(400).json({ success: false, message: startResult.error });
  }
  const startTime = startResult.value;
  const endTime = new Date(startTime.getTime() + plannedMinutes * 60 * 1000);

  const lockerResult = await pool.query('SELECT * FROM lockers WHERE locker_id = $1', [locker_id]);
  if (lockerResult.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'ไม่พบตู้ล็อกเกอร์นี้' });
  }
  const locker = lockerResult.rows[0];
  if (locker.status === 'maintenance' || locker.status === 'unavailable') {
    return res.status(400).json({ success: false, message: 'ตู้นี้ปิดใช้งานอยู่ หรืออยู่ระหว่างซ่อมบำรุง' });
  }

  const conflict = await findOverlappingBooking(locker_id, startTime, endTime);
  if (conflict) {
    return res.status(400).json({ success: false, message: 'ช่วงเวลานี้ถูกจองไปแล้ว กรุณาเลือกช่วงเวลาอื่น' });
  }

  const booking = await finalizeBooking({ user_id, locker_id, planned_minutes: plannedMinutes, start_time: startTime });

  res.json({
    success: true,
    message: 'จองตู้สำเร็จ',
    booking_id: booking.booking_id,
    pin_code: booking.pin_code,
    locker_number: locker.locker_number,
    planned_minutes: plannedMinutes,
    start_time: booking.start_time,
    end_time: booking.end_time,
  });
}

// ดูรายการจองของผู้ใช้คนหนึ่ง
async function myBookings(req, res) {
  const { user_id } = req.query;
  const result = await pool.query(
    `SELECT b.*, l.locker_number, l.location, l.size
     FROM bookings b JOIN lockers l ON b.locker_id = l.locker_id
     WHERE b.user_id = $1 ORDER BY b.start_time DESC`,
    [user_id]
  );
  res.json({ success: true, data: result.rows });
}

// รายการจองทั้งหมด (Admin) — ใช้ปล่อยตู้ที่ไม่มีคนมาใช้งานได้
async function allBookings(req, res) {
  const result = await pool.query(
    `SELECT b.*, l.locker_number, u.username, u.firstname, u.lastname
     FROM bookings b
     JOIN lockers l ON b.locker_id = l.locker_id
     JOIN users u ON b.user_id = u.user_id
     ORDER BY b.created_at DESC
     LIMIT 100`
  );
  res.json({ success: true, data: result.rows });
}

async function releaseBooking(req, res) {
  const result = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [req.params.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'ไม่พบรายการจองนี้' });
  }
  const booking = result.rows[0];
  if (booking.status !== 'active') {
    return res.status(400).json({ success: false, message: 'รายการจองนี้ไม่ได้อยู่ในสถานะใช้งาน' });
  }

  await pool.query('UPDATE bookings SET status = $1, completed_at = NOW() WHERE booking_id = $2', ['cancelled', req.params.id]);
  await pool.query('INSERT INTO logs (locker_id, user_id, action) VALUES ($1, $2, $3)', [
    booking.locker_id,
    booking.user_id,
    'admin_release',
  ]);

  res.json({ success: true, message: 'ปล่อยตู้สำเร็จ คืนสิทธิ์ให้ผู้อื่นจองต่อได้แล้ว' });
}

module.exports = {
  createBooking,
  myBookings,
  allBookings,
  releaseBooking,
  finalizeBooking,
  normalizePlannedMinutes,
};
