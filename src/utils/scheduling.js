const pool = require('../config/db');

const MAX_ADVANCE_DAYS = 7;

// ==================================================================
// ตรวจสอบ/ปรับค่าเวลาเริ่มจองที่ผู้ใช้ส่งมา
// ไม่ระบุ -> ใช้ "ตอนนี้" / ต้องไม่ใช่อดีต (เผื่อ clock skew เล็กน้อย) / ห้ามเกิน 7 วันข้างหน้า
// ==================================================================
function normalizeStartTime(input) {
  let start;
  if (input === undefined || input === null || input === '') {
    start = new Date();
  } else {
    start = new Date(input);
    if (Number.isNaN(start.getTime())) return { error: 'รูปแบบวันเวลาที่เลือกไม่ถูกต้อง' };
  }

  const now = new Date();
  const graceMs = 60 * 1000; // เผื่อเวลาที่ request วิ่งมาถึง server
  if (start.getTime() < now.getTime() - graceMs) {
    return { error: 'เลือกเวลาย้อนหลังไม่ได้' };
  }

  const maxDate = new Date(now.getTime() + MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000);
  if (start.getTime() > maxDate.getTime()) {
    return { error: `จองล่วงหน้าได้ไม่เกิน ${MAX_ADVANCE_DAYS} วัน` };
  }

  return { value: start };
}

// ==================================================================
// เช็คว่าช่วงเวลาที่จะจอง [start, end) ชนกับการจองอื่นที่ยัง active อยู่ของตู้เดียวกันหรือไม่
// เงื่อนไขชนกันมาตรฐาน: existing.start < new.end AND existing.end > new.start
// excludeBookingId ใช้ตอน re-check ตอน confirm payment (ไม่ต้องกันชนกับตัวเอง ถ้ามี)
// ==================================================================
async function findOverlappingBooking(locker_id, startTime, endTime, excludeBookingId = null) {
  const params = [locker_id, startTime, endTime];
  let query = `
    SELECT booking_id, start_time, end_time FROM bookings
    WHERE locker_id = $1 AND status = 'active' AND start_time < $3 AND end_time > $2
  `;
  if (excludeBookingId) {
    params.push(excludeBookingId);
    query += ` AND booking_id != $${params.length}`;
  }
  query += ' LIMIT 1';

  const result = await pool.query(query, params);
  return result.rows[0] || null;
}

// ==================================================================
// คำนวณสถานะที่จะแสดงผลของตู้ ณ เวลาปัจจุบัน จาก booking ที่ active ทั้งหมดของตู้นั้น
// ลำดับความสำคัญ: ซ่อมบำรุง/ปิดใช้งานเอง (admin ตั้งเอง) > เกินเวลา > กำลังใช้งาน > ว่าง
// ==================================================================
function computeDisplayStatus(locker, activeBookings, now = new Date()) {
  if (locker.status === 'maintenance') {
    return { display_status: 'maintenance', available_at: null, overdue_since: null };
  }
  if (locker.status === 'unavailable') {
    return { display_status: 'unavailable', available_at: null, overdue_since: null };
  }

  const overdue = activeBookings.find((b) => new Date(b.end_time) < now);
  if (overdue) {
    return { display_status: 'overdue', available_at: null, overdue_since: overdue.end_time };
  }

  const current = activeBookings.find((b) => new Date(b.start_time) <= now && new Date(b.end_time) > now);
  if (current) {
    return { display_status: 'occupied', available_at: current.end_time, overdue_since: null };
  }

  return { display_status: 'available', available_at: null, overdue_since: null };
}

// ดึง booking ที่ active ทั้งหมดของตู้หลายใบพร้อมกัน แล้วจัดกลุ่มตาม locker_id
async function getActiveBookingsByLocker(lockerIds) {
  if (lockerIds.length === 0) return {};
  const result = await pool.query(
    `SELECT booking_id, locker_id, start_time, end_time FROM bookings
     WHERE locker_id = ANY($1::int[]) AND status = 'active'
     ORDER BY start_time ASC`,
    [lockerIds]
  );
  const grouped = {};
  for (const row of result.rows) {
    if (!grouped[row.locker_id]) grouped[row.locker_id] = [];
    grouped[row.locker_id].push(row);
  }
  return grouped;
}

module.exports = {
  MAX_ADVANCE_DAYS,
  normalizeStartTime,
  findOverlappingBooking,
  computeDisplayStatus,
  getActiveBookingsByLocker,
};
