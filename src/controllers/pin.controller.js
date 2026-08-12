const pool = require('../config/db');

// ==================================================================
// ส่วนที่ 4: ตรวจสอบรหัส PIN + ควบคุมการเปิด/ปิดตู้
// ==================================================================

async function verifyPin(req, res) {
  const { booking_id, pin_code, action } = req.body;

  const result = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [booking_id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'ไม่พบรายการจองนี้' });
  }
  const booking = result.rows[0];

  if (booking.pin_code !== pin_code) {
    await pool.query('INSERT INTO logs (locker_id, user_id, action) VALUES ($1, $2, $3)', [
      booking.locker_id,
      booking.user_id,
      'wrong_pin',
    ]);
    return res.status(401).json({ success: false, message: 'รหัส PIN ไม่ถูกต้อง' });
  }

  // TODO: ในระบบจริงจะยิง request ไปสั่งงานบอร์ด ESP32 ตรงนี้

  if (action === 'close') {
    // คืนตู้ได้ทุกเมื่อ ไม่ว่าจะก่อนหรือหลังเวลาที่จองไว้ (เช็คเอาต์ก่อนเวลาก็ทำได้ปกติ)
    // ไม่ต้องอัปเดตสถานะตู้ที่นี่ — display_status ของตู้คำนวณสดจาก booking ที่ยัง active อยู่
    // พอ booking นี้กลายเป็น completed แล้ว ตู้จะกลับไปแสดง "ว่าง" เองทันทีในครั้งถัดไปที่เรียก GET /lockers
    await pool.query(
      'UPDATE bookings SET status = $1, completed_at = NOW() WHERE booking_id = $2',
      ['completed', booking_id]
    );
  }

  await pool.query('INSERT INTO logs (locker_id, user_id, action) VALUES ($1, $2, $3)', [
    booking.locker_id,
    booking.user_id,
    action,
  ]);

  res.json({ success: true, message: action === 'open' ? 'ปลดล็อกตู้สำเร็จ' : 'คืนตู้สำเร็จ' });
}

module.exports = { verifyPin };
