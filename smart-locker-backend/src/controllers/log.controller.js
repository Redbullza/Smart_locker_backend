const pool = require('../config/db');
const { computeDisplayStatus, getActiveBookingsByLocker } = require('../utils/scheduling');

// ==================================================================
// ส่วนที่ 5: ประวัติการใช้งาน (Admin)
// ==================================================================

// ฟังก์ชันดึงรายการประวัติการใช้งาน (Logs)
// รองรับการกรองตาม user_id จาก query parameter เช่น /logs?user_id=123 (สำหรับหน้า User)
// หากไม่ระบุ user_id จะดึงประวัติทั้งหมดของระบบ (สำหรับหน้า Admin)
async function listLogs(req, res) {
  try {
    const { user_id } = req.query;
    let query = `SELECT lg.*, l.locker_number, u.firstname, u.lastname
       FROM logs lg
       JOIN lockers l ON lg.locker_id = l.locker_id
       JOIN users u ON lg.user_id = u.user_id`;
    const params = [];

    // ถ้ามีการส่ง user_id มา ให้กรองเฉพาะประวัติของผู้ใช้นั้นๆ
    if (user_id) {
      query += ` WHERE lg.user_id = $1`;
      params.push(user_id);
    }

    query += ` ORDER BY lg.timestamp DESC`;
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงประวัติการใช้งาน' });
  }
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
