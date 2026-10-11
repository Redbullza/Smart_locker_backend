import { useEffect, useState, useCallback, useMemo } from 'react';
import { getJSON, putJSON } from '../api';
import { formatDateTime, formatFullDateTime, formatClock } from '../utils/format';
import RevenuePanel from '../components/RevenuePanel';

const ACTION_LABEL = { book: 'จองตู้', open: 'ปลดล็อกตู้', close: 'คืนตู้', wrong_pin: 'กรอก PIN ผิด', admin_release: 'Admin ปล่อยตู้', relocate: 'ย้ายตู้', decline_relocate: 'ปฏิเสธย้ายตู้ (ยกเลิกจอง)' };
// สถานะที่คำนวณสดจากตารางการจอง (แสดงในคอลัมน์ "สถานะ")
const DISPLAY_STATUS_LABEL = {
  available: 'ว่าง',
  occupied: 'กำลังถูกใช้งาน',
  overdue: 'เกินเวลาที่จอง',
  unavailable: 'ปิดใช้งาน',
  maintenance: 'ซ่อมบำรุง',
};
const USER_STATUS_LABEL = { active: 'ปกติ', suspended: 'ถูกระงับ' };
const ROLE_LABEL = { admin: 'Admin', user: 'User' };

// สถานะของ booking แต่ละแถว เทียบกับเวลาปัจจุบัน (ใช้แค่ตอน status ยัง active อยู่)
function bookingPhase(b) {
  if (b.status !== 'active') return b.status; // completed / cancelled แสดงตามเดิม
  const now = Date.now();
  const start = new Date(b.start_time).getTime();
  const end = new Date(b.end_time).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 'active';
  if (now < start) return 'upcoming';
  if (now < end) return 'active';
  return 'overdue';
}
const PHASE_LABEL = {
  upcoming: 'ยังไม่เริ่ม',
  active: 'กำลังใช้งาน',
  overdue: 'เกินเวลา',
  completed: 'คืนแล้ว',
  cancelled: 'ถูกปล่อย/ยกเลิก',
};

const TABS = [
  { key: 'logs', label: 'ประวัติการใช้งาน' },
  { key: 'allbookings', label: 'การจองทั้งหมด' },
  { key: 'users', label: 'จัดการผู้ใช้งาน' },
  { key: 'lockers', label: 'จัดการตู้ล็อกเกอร์' },
  { key: 'revenue', label: 'ประวัติรายได้' },
  { key: 'reports', label: 'รายงานสรุป' },
];

function loadStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('locker_user') || 'null');
  } catch {
    return null;
  }
}

// ==================================================================
// ไอคอน SVG แบบ Inline สำหรับหน้าผู้ดูแลระบบ
// ==================================================================

// ไอคอนหน้าหลัก
function IconHome(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

// ไอคอนรีเฟรชข้อมูล
function IconRefresh(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

// ไอคอนเปิด-ปิดเมนูแถบข้าง (Hamburger Menu 3 ขีด)
function IconMenu(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

// ไอคอนปิด / กากบาท
function IconClose(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ไอคอนประวัติการใช้งาน
function IconHistory(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
      <path d="M3.05 11a9 9 0 0 1 .5-2" />
    </svg>
  );
}

// ไอคอนการจองตู้
function IconTicket(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4Z" />
      <path d="M13 5v2M13 17v2M13 10.5v3" />
    </svg>
  );
}

// ไอคอนจัดการผู้ใช้งาน
function IconUsers(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// ไอคอนจัดการตู้ล็อกเกอร์
function IconLockers(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}

// ไอคอนรายงานสรุปและรายได้
function IconReport(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

// ไอคอนออกจากระบบ
function IconLogout(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export default function AdminPage() {
  const currentUser = useMemo(loadStoredUser, []);
  const isAdmin = currentUser && currentUser.role === 'admin';

  // ออกจากระบบ: ล้างข้อมูลผู้ใช้ที่เก็บไว้ แล้วกลับหน้าแรก (reload เต็มหน้าเพื่อเคลียร์ state ทั้งหมด)
  // จำเป็นเพราะ admin ถูก redirect ออกจากหน้า user ตลอด จึงไม่มีทางไปกดออกจากระบบที่หน้านั้นได้
  function handleLogout() {
    localStorage.removeItem('locker_user');
    window.location.replace('/');
  }

  // สถานะเปิด-ปิดแถบเมนูด้านซ้าย (ค่าเริ่มต้น: เปิดไว้)
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // แท็บเมนูปัจจุบัน
  const [activeTab, setActiveTab] = useState('logs');

  const [dashboard, setDashboard] = useState({});
  const [updatedAt, setUpdatedAt] = useState('–');

  const [allLogs, setAllLogs] = useState([]);
  const [logsError, setLogsError] = useState(false);
  const [filterAction, setFilterAction] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  const [bookings, setBookings] = useState([]);
  const [bookingsError, setBookingsError] = useState(false);

  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState(false);

  const [lockers, setLockers] = useState([]);
  const [lockersError, setLockersError] = useState(false);

  const [reportPeriod, setReportPeriod] = useState('daily');
  const [reports, setReports] = useState([]);
  const [reportsError, setReportsError] = useState(false);
  const [reportRevenueSummary, setReportRevenueSummary] = useState(null); // สรุปรายได้จาก backend

  const loadDashboard = useCallback(async () => {
    const json = await getJSON('/dashboard');
    setDashboard(json.data || {});
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const json = await getJSON('/logs');
      setAllLogs(json.data || []);
      setLogsError(false);
    } catch {
      setLogsError(true);
    }
  }, []);

  const loadAllBookings = useCallback(async () => {
    try {
      const json = await getJSON('/bookings');
      setBookings(json.data || []);
      setBookingsError(false);
    } catch {
      setBookingsError(true);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const json = await getJSON('/users');
      setUsers(json.data || []);
      setUsersError(false);
    } catch {
      setUsersError(true);
    }
  }, []);

  const loadLockers = useCallback(async () => {
    try {
      const json = await getJSON('/lockers');
      setLockers(json.data || []);
      setLockersError(false);
    } catch {
      setLockersError(true);
    }
  }, []);

  // ดึงข้อมูลรายงานสรุป (และยอดรายได้) ตามช่วงเวลา
  const loadReports = useCallback(async (period) => {
    try {
      const json = await getJSON('/reports?period=' + period);
      setReports(json.data || []);
      if (json.revenue_summary) {
        setReportRevenueSummary(json.revenue_summary);
      }
      setReportsError(false);
    } catch {
      setReportsError(true);
    }
  }, []);

  const loadAll = useCallback(() => {
    loadDashboard();
    loadLogs();
    loadAllBookings();
    loadUsers();
    loadLockers();
    loadReports(reportPeriod);
    setUpdatedAt('อัปเดตล่าสุด ' + formatClock(new Date()));
  }, [loadDashboard, loadLogs, loadAllBookings, loadUsers, loadLockers, loadReports, reportPeriod]);

  useEffect(() => {
    if (!isAdmin) return;
    loadAll();
    const id = setInterval(loadAll, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    loadReports(reportPeriod);
  }, [reportPeriod, isAdmin, loadReports]);

  async function releaseBooking(booking_id) {
    if (!confirm('ยืนยันปล่อยตู้นี้? ตู้จะกลับเป็นสถานะว่างทันที')) return;
    await putJSON(`/bookings/${booking_id}/release`);
    loadAllBookings();
    loadDashboard();
  }

  async function toggleUserStatus(user_id, status) {
    await putJSON(`/users/${user_id}/status`, { status });
    loadUsers();
  }

  async function changeLocker(locker_id, field, value) {
    await putJSON(`/lockers/${locker_id}`, { [field]: value });
    loadLockers();
    loadDashboard();
  }

  const filteredLogs = useMemo(() => {
    let rows = allLogs;
    if (filterAction) rows = rows.filter((r) => r.action === filterAction);
    const search = filterSearch.trim().toLowerCase();
    if (search) {
      rows = rows.filter(
        (r) =>
          (r.locker_number || '').toLowerCase().includes(search) ||
          (r.firstname || '').toLowerCase().includes(search) ||
          (r.lastname || '').toLowerCase().includes(search)
      );
    }
    return rows;
  }, [allLogs, filterAction, filterSearch]);

  // คำนวณสรุปยอดรายได้ทั้งหมด: รายวัน (วันนี้), รายเดือน (เดือนนี้), รายปี (ปีนี้), และยอดรวมทั้งหมด
  const revenueSummary = useMemo(() => {
    if (reportRevenueSummary && reportRevenueSummary.total_revenue != null) {
      return reportRevenueSummary;
    }
    // คำนวณสดจากรายการ bookings ทั้งหมด (กรณีที่ backend ยังไม่ได้ส่งมา)
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const monthStr = todayStr.slice(0, 7);
    const yearStr = todayStr.slice(0, 4);

    let daily = 0;
    let monthly = 0;
    let yearly = 0;
    let total = 0;

    for (const b of bookings) {
      const amt = Number(b.amount ?? b.price ?? 0) || 0;
      const bDate = (b.created_at || b.start_time || '').slice(0, 10);
      if (bDate === todayStr) daily += amt;
      if (bDate.startsWith(monthStr)) monthly += amt;
      if (bDate.startsWith(yearStr)) yearly += amt;
      total += amt;
    }

    return {
      daily_revenue: daily,
      monthly_revenue: monthly,
      yearly_revenue: yearly,
      total_revenue: total,
    };
  }, [reportRevenueSummary, bookings]);

  if (!isAdmin) {
    return (
      <div className="wrap admin">
        <header>
          <div>
            <p className="eyebrow">Prince of Songkla University · Faculty of Liberal Arts</p>
            <h1>แผงควบคุมผู้ดูแลระบบ</h1>
            <p className="subtitle">จัดการผู้ใช้งาน / ตู้ล็อกเกอร์ / ประวัติ / รายงาน — ฝากได้ไม่จำกัดเวลา ไม่มีค่าปรับ</p>
          </div>
          <div className="top-links"><a href="/">← กลับหน้าหลัก</a></div>
        </header>
        <div className="guard-panel">
          <h2>ต้องเข้าสู่ระบบด้วยบัญชี Admin</h2>
          <p>บัญชีของคุณไม่มีสิทธิ์เข้าถึงหน้านี้ กรุณาเข้าสู่ระบบด้วยบัญชีที่มี role เป็น admin</p>
          <a className="btn primary" href="/">กลับไปหน้าหลักเพื่อเข้าสู่ระบบ</a>
        </div>
      </div>
    );
  }

  // รายการเมนูทั้งหมดในแถบเมนูด้านข้าง (Sidebar Navigation) พร้อมไอคอนและตัวเลขนับจำนวน
  const adminNavItems = [
    { key: 'logs', label: 'ประวัติการใช้งาน', icon: IconHistory, count: allLogs.length },
    { key: 'allbookings', label: 'การจองทั้งหมด', icon: IconTicket, count: bookings.length },
    { key: 'users', label: 'จัดการผู้ใช้งาน', icon: IconUsers, count: users.length },
    { key: 'lockers', label: 'จัดการตู้ล็อกเกอร์', icon: IconLockers, count: lockers.length },
    { key: 'reports', label: 'รายงานสรุป & รายได้', icon: IconReport, count: null },
  ];

  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : 'sidebar-collapsed'}`} id="top">
      {/* พื้นหลังมืดสำหรับจอมือถือเมื่อเปิดแถบเมนู (Backdrop) */}
      <div
        className={`sidebar-backdrop ${sidebarOpen ? 'show' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* ==================================================================
          1. แถบเมนูด้านข้างซ้ายที่สามารถเปิด-ปิดได้ (Collapsible App Sidebar)
          ================================================================== */}
      <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}>
        {/* โลโก้และชื่อระบบส่วนหัวของแถบเมนู */}
        <div className="sidebar-brand">
          <div className="brand-logo">
            <div className="brand-badge">PSU</div>
            <div className="brand-text">
              <span className="brand-title">Smart Locker</span>
              <span className="brand-sub">Admin Console</span>
            </div>
          </div>
          {/* ปุ่มปิดแถบเมนู (แสดงเฉพาะบนหน้าจอมือถือ) */}
          <button
            className="sidebar-close-btn"
            onClick={() => setSidebarOpen(false)}
            title="ปิดแถบเมนู"
            aria-label="ปิดแถบเมนู"
          >
            <IconClose />
          </button>
        </div>

        {/* การ์ดข้อมูลโปรไฟล์ผู้ดูแลระบบที่กำลังเข้าสู่ระบบ */}
        <div className="sidebar-user-card">
          <div className="user-avatar">
            {currentUser?.firstname ? currentUser.firstname.charAt(0).toUpperCase() : 'A'}
          </div>
          <div className="user-details">
            <span className="user-name">
              {currentUser?.firstname} {currentUser?.lastname}
            </span>
            <span className="user-role-badge">Admin System</span>
          </div>
        </div>

        {/* รายการเมนูทั้ง 5 ส่วน พร้อมตัวเลข Badge นับจำนวนข้อมูลสด */}
        <div className="sidebar-menu-section">
          <div className="sidebar-section-title">เมนูควบคุมระบบ</div>
          <nav className="sidebar-nav">
            {adminNavItems.map((item) => {
              const IconComp = item.icon;
              const isActive = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  className={`nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab(item.key);
                    // บนจอมือถือ (กว้างน้อยกว่า 900px) เมื่อกดเลือกเมนูแล้ว ให้ปิด sidebar อัตโนมัติ
                    if (typeof window !== 'undefined' && window.innerWidth < 900) {
                      setSidebarOpen(false);
                    }
                  }}
                >
                  <span className="nav-icon">
                    <IconComp />
                  </span>
                  <span className="nav-label">{item.label}</span>
                  {item.count !== null && item.count !== undefined && (
                    <span className={`nav-badge ${isActive ? '' : 'ok'}`}>
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* ส่วนท้ายของแถบเมนู: ปุ่มกลับหน้าผู้ใช้ และปุ่มออกจากระบบ */}
        <div className="sidebar-footer">
          <a href="/" className="sidebar-link-btn" title="กลับไปหน้าแรก">
            <IconHome width={15} height={15} /> กลับไปหน้าแรก
          </a>
          <button
            className="sidebar-logout-btn"
            onClick={handleLogout}
            title="ออกจากระบบ Admin"
          >
            <IconLogout /> ออกจากระบบ
          </button>
          <div className="sidebar-version">
            PSU Faculty of Liberal Arts
          </div>
        </div>
      </aside>

      {/* ==================================================================
          2. ส่วนเนื้อหาหลักด้านขวา (App Main Content Area)
          ================================================================== */}
      <div className="app-main">
        {/* แถบส่วนหัวด้านบน (Topbar) พร้อมปุ่ม Hamburger สลับเปิด-ปิด Sidebar */}
        <header className="main-topbar">
          <div className="topbar-left">
            <button
              className="sidebar-toggle-btn"
              onClick={() => setSidebarOpen((prev) => !prev)}
              title={sidebarOpen ? 'ย่อแถบเมนู' : 'ขยายแถบเมนู'}
              aria-label="สลับแถบเมนู"
            >
              <IconMenu />
            </button>
            <div className="topbar-title-group">
              <span className="topbar-breadcrumb">Admin Console · คณะศิลปศาสตร์ ม.อ.</span>
              <h1 className="topbar-main-title">
                {activeTab === 'logs' && 'ประวัติการใช้งานทั้งหมด'}
                {activeTab === 'allbookings' && 'รายการจองทั้งหมด'}
                {activeTab === 'users' && 'จัดการผู้ใช้งาน'}
                {activeTab === 'lockers' && 'จัดการตู้ล็อกเกอร์'}
                {activeTab === 'reports' && 'รายงานสรุป & รายได้'}
              </h1>
            </div>
          </div>
          <div className="topbar-right">
            <span className="updated-badge">{updatedAt}</span>
            <button className="topbar-refresh-btn" onClick={loadAll} title="รีเฟรชข้อมูลทั้งหมด">
              <IconRefresh width={14} height={14} /> รีเฟรช
            </button>
          </div>
        </header>

        {/* พื้นที่แสดงผลข้อมูลหลัก (Main Body Container) */}
        <main className="main-body">
          {/* สถิติตู้ล็อกเกอร์ภาพรวมในระบบ */}
          <div className="stats admin">
            <div className="stat">
              <div className="num">{dashboard.total_lockers ?? '0'}</div>
              <div className="label">ตู้ทั้งหมด</div>
            </div>
            <div className="stat ok">
              <div className="num">{dashboard.available_lockers ?? '0'}</div>
              <div className="label">ตู้ว่าง</div>
            </div>
            <div className="stat danger">
              <div className="num">{dashboard.in_use_lockers ?? '0'}</div>
              <div className="label">กำลังใช้งาน</div>
            </div>
            <div className="stat grey">
              <div className="num">{dashboard.maintenance_lockers ?? '0'}</div>
              <div className="label">ปิดใช้งาน/ซ่อมบำรุง</div>
            </div>
          </div>

      {/* ===== แท็บ: ประวัติการใช้งาน ===== */}
      <div className={`tab-panel ${activeTab === 'logs' ? 'active' : ''}`}>
        <div className="filter-row">
          <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
            <option value="">ทุกประเภทเหตุการณ์</option>
            <option value="book">จองตู้</option>
            <option value="open">เปิดตู้</option>
            <option value="close">คืนตู้</option>
            <option value="wrong_pin">กรอก PIN ผิด</option>
            <option value="admin_release">Admin ปล่อยตู้</option>
            <option value="relocate">ย้ายตู้</option>
            <option value="decline_relocate">ปฏิเสธย้ายตู้</option>
          </select>
          <input
            type="text"
            placeholder="ค้นหาชื่อผู้ใช้หรือหมายเลขตู้..."
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>เวลา</th><th>ตู้</th><th>ผู้ใช้งาน</th><th>เหตุการณ์</th></tr></thead>
            <tbody>
              {logsError ? (
                <tr><td colSpan={4} className="empty">เชื่อมต่อ API ไม่ได้</td></tr>
              ) : filteredLogs.length === 0 ? (
                <tr><td colSpan={4} className="empty">ไม่พบข้อมูล</td></tr>
              ) : (
                filteredLogs.map((r, i) => (
                  <tr key={i}>
                    <td data-label="เวลา">{formatFullDateTime(r.timestamp)}</td>
                    <td data-label="ตู้">{r.locker_number}</td>
                    <td data-label="ผู้ใช้งาน">{r.firstname} {r.lastname}</td>
                    <td data-label="เหตุการณ์"><span className={`badge ${r.action}`}>{ACTION_LABEL[r.action] || r.action}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== แท็บ: การจองทั้งหมด ===== */}
      <div className={`tab-panel ${activeTab === 'allbookings' ? 'active' : ''}`}>
        <div className="section-label"><span>การจองทั้งหมด — ปล่อยตู้ที่ไม่มีคนมาใช้งานได้ที่นี่</span><div className="rule" /></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>ตู้</th><th>ผู้จอง</th><th>เริ่ม</th><th>ถึง</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
            <tbody>
              {bookingsError ? (
                <tr><td colSpan={6} className="empty">เชื่อมต่อ API ไม่ได้</td></tr>
              ) : bookings.length === 0 ? (
                <tr><td colSpan={6} className="empty">ยังไม่มีรายการจอง</td></tr>
              ) : (
                bookings.map((b) => {
                  const phase = bookingPhase(b);
                  return (
                    <tr key={b.booking_id}>
                      <td data-label="ตู้">{b.locker_number}</td>
                      <td data-label="ผู้จอง">{b.firstname} {b.lastname}</td>
                      <td data-label="เริ่ม">{formatDateTime(b.start_time)}</td>
                      <td data-label="ถึง">{formatDateTime(b.end_time)}</td>
                      <td data-label="สถานะ"><span className={`badge ${phase}`}>{PHASE_LABEL[phase] || phase}</span></td>
                      <td data-label="จัดการ">
                        {b.status === 'active' ? (
                          <button className="btn warn small" onClick={() => releaseBooking(b.booking_id)}>ปล่อยตู้ (ไม่มาใช้)</button>
                        ) : '–'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== แท็บ: จัดการผู้ใช้งาน ===== */}
      <div className={`tab-panel ${activeTab === 'users' ? 'active' : ''}`}>
        <div className="section-label"><span>ผู้ใช้งานทั้งหมด — ตรวจสอบ/ระงับสิทธิ์</span><div className="rule" /></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>ชื่อ-นามสกุล</th><th>Username</th><th>บทบาท</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
            <tbody>
              {usersError ? (
                <tr><td colSpan={5} className="empty">เชื่อมต่อ API ไม่ได้</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={5} className="empty">ยังไม่มีผู้ใช้งาน</td></tr>
              ) : (
                users.map((u) => (
                  <tr key={u.user_id}>
                    <td data-label="ชื่อ-นามสกุล">{u.firstname} {u.lastname}</td>
                    <td data-label="Username">{u.username}</td>
                    <td data-label="บทบาท"><span className={`badge ${u.role}`}>{ROLE_LABEL[u.role] || u.role}</span></td>
                    <td data-label="สถานะ"><span className={`badge ${u.status}`}>{USER_STATUS_LABEL[u.status] || u.status}</span></td>
                    <td data-label="จัดการ">
                      {u.status === 'active' ? (
                        <button className="btn danger small" onClick={() => toggleUserStatus(u.user_id, 'suspended')}>ระงับสิทธิ์</button>
                      ) : (
                        <button className="btn ok small" onClick={() => toggleUserStatus(u.user_id, 'active')}>คืนสิทธิ์</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== แท็บ: จัดการตู้ล็อกเกอร์ ===== */}
      <div className={`tab-panel ${activeTab === 'lockers' ? 'active' : ''}`}>
        <div className="section-label"><span>ตู้ล็อกเกอร์ทั้งหมด — เปิด/ปิด/ซ่อมบำรุง/ขนาด</span><div className="rule" /></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>หมายเลขตู้</th><th>ตำแหน่ง</th><th>ขนาด</th><th>สถานะ</th><th>เปลี่ยนสถานะ (ปิดใช้งานเอง)</th></tr></thead>
            <tbody>
              {lockersError ? (
                <tr><td colSpan={5} className="empty">เชื่อมต่อ API ไม่ได้</td></tr>
              ) : lockers.length === 0 ? (
                <tr><td colSpan={5} className="empty">ยังไม่มีตู้ล็อกเกอร์</td></tr>
              ) : (
                lockers.map((l) => (
                  <tr key={l.locker_id}>
                    <td data-label="หมายเลขตู้">{l.locker_number}</td>
                    <td data-label="ตำแหน่ง">{l.location}</td>
                    <td data-label="ขนาด">
                      <select value={l.size} onChange={(e) => changeLocker(l.locker_id, 'size', e.target.value)}>
                        <option value="small">เล็ก</option>
                        <option value="medium">กลาง</option>
                        <option value="large">ใหญ่</option>
                      </select>
                    </td>
                    <td data-label="สถานะ">
                      <span className={`badge ${l.display_status}`}>{DISPLAY_STATUS_LABEL[l.display_status] || l.display_status}</span>
                      {l.display_status === 'occupied' && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>ว่างอีกครั้ง {formatDateTime(l.available_at)}</div>
                      )}
                      {l.display_status === 'overdue' && (
                        <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>ควรว่างตั้งแต่ {formatDateTime(l.overdue_since)}</div>
                      )}
                    </td>
                    <td data-label="เปลี่ยนสถานะ">
                      <select value={l.status} onChange={(e) => changeLocker(l.locker_id, 'status', e.target.value)}>
                        <option value="available">ว่าง (ปกติ)</option>
                        <option value="unavailable">ปิดใช้งานเอง</option>
                        <option value="maintenance">ซ่อมบำรุง</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== แท็บ: ประวัติรายได้ ===== */}
      <div className={`tab-panel ${activeTab === 'revenue' ? 'active' : ''}`}>
        <RevenuePanel adminId={currentUser.user_id} active={activeTab === 'revenue'} />
      </div>

      {/* ===== 5. แท็บ: รายงานสรุปและรายได้ ===== */}
      <div className={`tab-panel ${activeTab === 'reports' ? 'active' : ''}`}>
        {/* ================================================================
            สถิติรายได้ทั้งหมดของระบบ: แยกเป็น รายได้รวมทั้งหมด, รายวัน, รายเดือน, รายปี
            (แสดงเฉพาะในหน้ารายงานสรุปเท่านั้น หน้าอื่นไม่ต้องมี)
            ================================================================ */}
        <div className="section-label">
          <span>สรุปรายได้ทั้งหมดของระบบ</span>
          <div className="rule" />
        </div>
        <div className="revenue-stats">
          <div className="stat gold">
            <div className="num">{(revenueSummary.total_revenue || 0).toLocaleString()} ฿</div>
            <div className="label">รายได้รวมทั้งหมด</div>
          </div>
          <div className="stat ok">
            <div className="num">{(revenueSummary.daily_revenue || 0).toLocaleString()} ฿</div>
            <div className="label">รายได้วันนี้ (รายวัน)</div>
          </div>
          <div className="stat warn">
            <div className="num">{(revenueSummary.monthly_revenue || 0).toLocaleString()} ฿</div>
            <div className="label">รายได้เดือนนี้ (รายเดือน)</div>
          </div>
          <div className="stat">
            <div className="num">{(revenueSummary.yearly_revenue || 0).toLocaleString()} ฿</div>
            <div className="label">รายได้ปีนี้ (รายปี)</div>
          </div>
        </div>

        <div className="section-label">
          <span>รายงานการใช้งานและรายได้ของตู้ล็อกเกอร์</span>
          <div className="rule" />
        </div>
        <div className="filter-row">
          <select value={reportPeriod} onChange={(e) => setReportPeriod(e.target.value)}>
            <option value="daily">รายวัน</option>
            <option value="monthly">รายเดือน</option>
            <option value="yearly">รายปี</option>
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{reportPeriod === 'yearly' ? 'ปี' : reportPeriod === 'monthly' ? 'เดือน' : 'วันที่'}</th>
                <th>จองตู้</th>
                <th>เปิดตู้</th>
                <th>คืนตู้</th>
                <th>PIN ผิด</th>
                <th>รวมเหตุการณ์</th>
                <th>อัตราการใช้ตู้</th>
                <th>รายได้รวม (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {reportsError ? (
                <tr>
                  <td colSpan={8} className="empty">เชื่อมต่อ API ไม่ได้</td>
                </tr>
              ) : reports.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">ยังไม่มีข้อมูล</td>
                </tr>
              ) : (
                reports.map((r, i) => (
                  <tr key={i}>
                    <td data-label={reportPeriod === 'yearly' ? 'ปี' : reportPeriod === 'monthly' ? 'เดือน' : 'วันที่'}>
                      {r.period_label}
                    </td>
                    <td data-label="จองตู้">{r.bookings}</td>
                    <td data-label="เปิดตู้">{r.opens}</td>
                    <td data-label="คืนตู้">{r.closes}</td>
                    <td data-label="PIN ผิด">{r.wrong_pins}</td>
                    <td data-label="รวมเหตุการณ์"><b>{r.total_events}</b></td>
                    <td data-label="อัตราการใช้ตู้">{r.utilization_rate}%</td>
                    <td data-label="รายได้รวม (บาท)">
                      <b className="revenue-amount">
                        {(Number(r.total_revenue) || 0).toLocaleString()} ฿
                      </b>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

          <footer style={{ marginTop: 28, display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="topbar-refresh-btn" onClick={loadAll} title="รีเฟรชข้อมูลตอนนี้">
              <IconRefresh width={14} height={14} /> รีเฟรชตอนนี้
            </button>
            <span className="updated-badge">{updatedAt}</span>
          </footer>
        </main>
      </div>

      {/* แถบนำทางด้านล่างสำหรับหน้าจอมือถือ (Bottom App Navigation) */}
      <nav className="bottom-nav">
        <button
          className={sidebarOpen ? 'active' : ''}
          onClick={() => setSidebarOpen((v) => !v)}
          title="เปิด/ปิดแถบเมนู"
        >
          <IconMenu /> เมนู
        </button>
        <a href="/" title="กลับไปหน้าแรก">
          <IconHome /> หน้าแรก
        </a>
        <button onClick={loadAll} title="รีเฟรชข้อมูล">
          <IconRefresh /> รีเฟรช
        </button>
      </nav>
    </div>
  );
}
