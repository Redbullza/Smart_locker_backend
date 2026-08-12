const pool = require('../config/db');
const { finalizeBooking, normalizePlannedMinutes } = require('./booking.controller');
const { createSession, getSession, deleteSession } = require('../utils/paymentSessions');
const { SIZE_PRICE } = require('../config/pricing');
const { normalizeStartTime, findOverlappingBooking } = require('../utils/scheduling');

// ==================================================================
// หน้าคิดเงิน — คิดราคาตามขนาดตู้ ก่อนยืนยันจอง (QR จำลอง)
// flow: กด "จองตู้นี้" -> สร้าง payment session (แสดง QR+ราคา) -> กด "ฉันชำระเงินแล้ว" -> confirm -> สร้าง booking จริง
// รองรับเลือกเวลาเริ่มใช้ล่วงหน้าได้ (ไม่เกิน 7 วัน) และเช็คช่วงเวลาชนกันทั้งตอนสร้าง session และตอน confirm
// (กันเคสมีคนอื่นจองแทรกช่วงเวลาเดียวกันระหว่างที่ session นี้ยัง pending อยู่)
// ==================================================================

function generateRefCode() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `LK-${Date.now()}-${rand}`;
}

async function createPaymentSession(req, res) {
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

  const amount = SIZE_PRICE[locker.size] ?? 0;
  const refCode = generateRefCode(); // สุ่มใหม่ทุกครั้ง แม้ราคาจะเท่าเดิม
  const qrPayload = `LOCKER|${locker.locker_number}|${amount}|${refCode}`; // จำลองเท่านั้น ไม่ใช่ QR ชำระเงินจริง

  const session = createSession({
    user_id,
    locker_id,
    locker_number: locker.locker_number,
    locker_size: locker.size,
    planned_minutes: plannedMinutes,
    start_time: startTime,
    end_time: endTime,
    amount,
    ref_code: refCode,
  });

  res.json({
    success: true,
    session_id: session.session_id,
    locker_number: locker.locker_number,
    locker_size: locker.size,
    amount,
    ref_code: refCode,
    qr_payload: qrPayload,
    planned_minutes: plannedMinutes,
    start_time: startTime,
    end_time: endTime,
  });
}

async function cancelPaymentSession(req, res) {
  deleteSession(req.params.id);
  res.json({ success: true, message: 'ยกเลิกรายการชำระเงินแล้ว' });
}

async function confirmPaymentSession(req, res) {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, message: 'ไม่พบรายการชำระเงินนี้ หรือหมดอายุแล้ว กรุณาลองจองใหม่' });
  }

  const lockerResult = await pool.query('SELECT * FROM lockers WHERE locker_id = $1', [session.locker_id]);
  const locker = lockerResult.rows[0];
  if (!locker || locker.status === 'maintenance' || locker.status === 'unavailable') {
    deleteSession(req.params.id);
    return res.status(400).json({ success: false, message: 'ตู้นี้ปิดใช้งานไปแล้ว กรุณาเลือกตู้ใหม่' });
  }

  // เช็คซ้ำว่าช่วงเวลานี้ยังไม่ชนกับใคร กันกรณีมีคนอื่นจองแทรกระหว่างที่ session นี้ค้างอยู่
  const conflict = await findOverlappingBooking(session.locker_id, session.start_time, session.end_time);
  if (conflict) {
    deleteSession(req.params.id);
    return res.status(400).json({ success: false, message: 'ช่วงเวลานี้ถูกคนอื่นจองไปก่อนแล้ว กรุณาเลือกช่วงเวลาใหม่' });
  }

  const booking = await finalizeBooking({
    user_id: session.user_id,
    locker_id: session.locker_id,
    planned_minutes: session.planned_minutes,
    start_time: session.start_time,
  });

  deleteSession(req.params.id);

  res.json({
    success: true,
    message: 'ชำระเงินสำเร็จ',
    booking_id: booking.booking_id,
    pin_code: booking.pin_code,
    locker_number: locker.locker_number,
    planned_minutes: session.planned_minutes,
    start_time: booking.start_time,
    end_time: booking.end_time,
    amount: session.amount,
  });
}

module.exports = { createPaymentSession, cancelPaymentSession, confirmPaymentSession };
