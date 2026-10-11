const pool = require('../config/db');

// ฟังก์ชันสร้างรายงานสรุปสถิติการใช้งานและรายได้ (Admin Reports)
// รองรับการดูข้อมูลแบบ: รายวัน (daily), รายเดือน (monthly), รายปี (yearly)
// พร้อมคำนวณรายได้ทั้งหมดแยกเป็น: รายวัน (วันนี้), รายเดือน (เดือนนี้), รายปี (ปีนี้), และยอดรวมทั้งหมด
async function reports(req, res) {
  try {
    const period = ['daily', 'monthly', 'yearly'].includes(req.query.period) ? req.query.period : 'daily';
    // ฟอร์แมตวันที่สำหรับ PostgreSQL TO_CHAR ตามช่วงเวลาที่เลือก
    const pgDateFormat = period === 'yearly' ? 'YYYY' : period === 'monthly' ? 'YYYY-MM' : 'YYYY-MM-DD';

    // ดึงสถิติเหตุการณ์จากตาราง logs พร้อมยอดรายได้จากตาราง bookings ตามช่วงเวลา
    const reportResult = await pool.query(
      `WITH period_logs AS (
        SELECT
          TO_CHAR(timestamp, $1) AS period_label,
          SUM(CASE WHEN action = 'book' THEN 1 ELSE 0 END) AS bookings,
          SUM(CASE WHEN action = 'open' THEN 1 ELSE 0 END) AS opens,
          SUM(CASE WHEN action = 'close' THEN 1 ELSE 0 END) AS closes,
          SUM(CASE WHEN action = 'wrong_pin' THEN 1 ELSE 0 END) AS wrong_pins,
          COUNT(*) AS total_events
        FROM logs
        GROUP BY period_label
      ),
      period_rev AS (
        SELECT
          TO_CHAR(created_at, $1) AS period_label,
          SUM(COALESCE(amount, price, 0)) AS total_revenue
        FROM bookings
        GROUP BY period_label
      )
      SELECT
        COALESCE(l.period_label, r.period_label) AS period_label,
        COALESCE(l.bookings, 0) AS bookings,
        COALESCE(l.opens, 0) AS opens,
        COALESCE(l.closes, 0) AS closes,
        COALESCE(l.wrong_pins, 0) AS wrong_pins,
        COALESCE(l.total_events, 0) AS total_events,
        COALESCE(r.total_revenue, 0)::numeric AS total_revenue
      FROM period_logs l
      FULL OUTER JOIN period_rev r ON l.period_label = r.period_label
      ORDER BY period_label DESC
      LIMIT 30`,
      [pgDateFormat]
    );

    // ดึงจำนวนตู้ทั้งหมดเพื่อใช้คำนวณอัตราการใช้งานตู้ (%)
    const lockerCountResult = await pool.query('SELECT COUNT(*) AS total_lockers FROM lockers');
    const total_lockers = parseInt(lockerCountResult.rows[0]?.total_lockers) || 0;

    // คำนวณอัตราการใช้งานตู้ (%) สำหรับแต่ละแถว
    const data = reportResult.rows.map((r) => {
      const utilizationRate = total_lockers > 0 ? Math.round((Number(r.bookings) / total_lockers) * 100) : 0;
      return {
        ...r,
        total_revenue: Number(r.total_revenue) || 0,
        utilization_rate: utilizationRate,
      };
    });

    // สรุปยอดรายได้ทั้งหมด: รายวัน (วันนี้), รายเดือน (เดือนนี้), รายปี (ปีนี้), และยอดรวมทั้งหมด
    const revSummaryResult = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN TO_CHAR(created_at, 'YYYY-MM-DD') = TO_CHAR(NOW(), 'YYYY-MM-DD') THEN COALESCE(amount, price, 0) ELSE 0 END), 0)::numeric AS daily_revenue,
        COALESCE(SUM(CASE WHEN TO_CHAR(created_at, 'YYYY-MM') = TO_CHAR(NOW(), 'YYYY-MM') THEN COALESCE(amount, price, 0) ELSE 0 END), 0)::numeric AS monthly_revenue,
        COALESCE(SUM(CASE WHEN TO_CHAR(created_at, 'YYYY') = TO_CHAR(NOW(), 'YYYY') THEN COALESCE(amount, price, 0) ELSE 0 END), 0)::numeric AS yearly_revenue,
        COALESCE(SUM(COALESCE(amount, price, 0)), 0)::numeric AS total_revenue
      FROM bookings
    `);

    const revenueSummary = {
      daily_revenue: Number(revSummaryResult.rows[0]?.daily_revenue) || 0,
      monthly_revenue: Number(revSummaryResult.rows[0]?.monthly_revenue) || 0,
      yearly_revenue: Number(revSummaryResult.rows[0]?.yearly_revenue) || 0,
      total_revenue: Number(revSummaryResult.rows[0]?.total_revenue) || 0,
    };

    res.json({
      success: true,
      period,
      data,
      revenue_summary: revenueSummary,
    });
  } catch (error) {
    console.error('Error generating reports:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงรายงานสรุป' });
  }
}

module.exports = { reports };

