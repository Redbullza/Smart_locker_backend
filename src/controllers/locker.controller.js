const pool = require('../config/db');
const { computeDisplayStatus, getActiveBookingsByLocker } = require('../utils/scheduling');

// ==================================================================
// ส่วนที่ 2: ตู้ล็อกเกอร์
// สถานะที่แสดงผล (display_status) คำนวณสดจาก booking ที่ active ทั้งหมดของตู้ ณ เวลาปัจจุบัน
// ไม่ได้เก็บเป็นค่าคงที่ในฐานข้อมูล เพราะตู้เดียวกันจองซ้อนหลายช่วงเวลาได้ (ไม่ชนกัน)
// ตู้จะ "ว่าง"/"ไม่ว่าง" ขึ้นอยู่กับว่า ณ ตอนนี้ อยู่ในช่วงเวลาของ booking ไหนอยู่หรือเปล่า
//   available  = ว่าง ไม่มี booking คลุมเวลาปัจจุบัน
//   occupied   = กำลังถูกใช้งานอยู่ในช่วงเวลาที่จองไว้ (แสดง available_at = จะว่างอีกครั้งเมื่อไหร่)
//   overdue    = เลยเวลาที่จองไว้แล้วแต่ยังไม่คืนตู้ (แสดง overdue_since = ควรจะว่างตั้งแต่เมื่อไหร่)
//   maintenance / unavailable = admin ตั้งเอง (ปิดใช้งานตู้ทั้งหมดไม่ว่าจะมี booking หรือไม่)
// ==================================================================

async function listLockers(req, res) {
  const result = await pool.query('SELECT * FROM lockers ORDER BY locker_number');
  const lockers = result.rows;

  const bookingsByLocker = await getActiveBookingsByLocker(lockers.map((l) => l.locker_id));
  const now = new Date();

  const data = lockers.map((locker) => {
    const activeBookings = bookingsByLocker[locker.locker_id] || [];
    const { display_status, available_at, overdue_since } = computeDisplayStatus(locker, activeBookings, now);
    return { ...locker, display_status, available_at, overdue_since };
  });

  res.json({ success: true, data });
}

// ==================================================================
// ส่วนที่ 7: จัดการตู้ล็อกเกอร์ (ขนาด / ปิดใช้งานเอง / ซ่อมบำรุง) — Admin
// หมายเหตุ: 'available' และ 'unavailable' ที่ admin ตั้งตรงนี้ คือการ "เปิด/ปิดใช้งานตู้ทั้งใบ" ด้วยมือ
// แยกจาก display_status (occupied/overdue) ที่ระบบคำนวณสดจากตารางการจอง — ตั้ง 'unavailable' ไว้
// จะ block การจองทุกช่วงเวลาไปเลย ไม่ใช่แค่ตอนนี้
// ==================================================================

async function updateLocker(req, res) {
  const { status, size } = req.body;
  const fields = [];
  const values = [];
  let paramIndex = 1;

  if (status) {
    if (!['available', 'unavailable', 'maintenance'].includes(status)) {
      return res.status(400).json({ success: false, message: 'สถานะไม่ถูกต้อง' });
    }
    fields.push(`status = $${paramIndex++}`);
    values.push(status);
  }
  if (size) {
    if (!['small', 'medium', 'large'].includes(size)) {
      return res.status(400).json({ success: false, message: 'ขนาดไม่ถูกต้อง' });
    }
    fields.push(`size = $${paramIndex++}`);
    values.push(size);
  }
  if (fields.length === 0) {
    return res.status(400).json({ success: false, message: 'ไม่มีข้อมูลให้อัปเดต' });
  }

  values.push(req.params.id);
  const queryText = `UPDATE lockers SET ${fields.join(', ')} WHERE locker_id = $${paramIndex}`;
  const result = await pool.query(queryText, values);

  if (result.rowCount === 0) {
    return res.status(404).json({ success: false, message: 'ไม่พบตู้ล็อกเกอร์นี้' });
  }
  res.json({ success: true, message: 'อัปเดตตู้ล็อกเกอร์สำเร็จ' });
}

module.exports = { listLockers, updateLocker };
