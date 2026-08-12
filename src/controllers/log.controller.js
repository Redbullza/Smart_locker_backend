const pool = require('../config/db');
const { computeDisplayStatus, getActiveBookingsByLocker } = require('../utils/scheduling');

// ==================================================================
// ส่วนที่ 5: ประวัติการใช้งาน (Admin)
// ==================================================================

async function listLogs(req, res) {
  const result = await pool.query(
    `SELECT lg.*, l.locker_number, u.firstname, u.lastname
     FROM logs lg
     JOIN lockers l ON lg.locker_id = l.locker_id
     JOIN users u ON lg.user_id = u.user_id
     ORDER BY lg.timestamp DESC`
  );
  res.json({ success: true, data: result.rows });
}

// นับจำนวนตู้ตามสถานะ "ที่แสดงผลจริง ณ ตอนนี้" (คำนวณสดจากตารางจอง เหมือน GET /lockers)
// ไม่ใช้ lockers.status ตรงๆ อีกต่อไป เพราะคอลัมน์นั้นตอนนี้ใช้แค่กรณี admin ปิดใช้งานตู้เองเท่านั้น
// ไม่ได้ขยับตามการจอง/คืนตู้ปกติแล้ว
async function dashboard(req, res) {
  const lockersResult = await pool.query('SELECT * FROM lockers');
  const lockers = lockersResult.rows;
  const bookingsByLocker = await getActiveBookingsByLocker(lockers.map((l) => l.locker_id));
  const now = new Date();

  const counts = { total_lockers: lockers.length, available_lockers: 0, in_use_lockers: 0, maintenance_lockers: 0 };
  for (const locker of lockers) {
    const activeBookings = bookingsByLocker[locker.locker_id] || [];
    const { display_status } = computeDisplayStatus(locker, activeBookings, now);
    if (display_status === 'maintenance' || display_status === 'unavailable') {
      counts.maintenance_lockers += 1;
    } else if (display_status === 'occupied' || display_status === 'overdue') {
      counts.in_use_lockers += 1;
    } else {
      counts.available_lockers += 1;
    }
  }

  res.json({ success: true, data: counts });
}

module.exports = { listLogs, dashboard };
