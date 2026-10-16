import { useEffect, useMemo, useRef, useState } from 'react';
import collegeHeader from '../../static/college-header.png';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEPARTMENTS = [
  'Artificial Intelligence and Data Science',
  'Computer Engineering',
  'Electrical Engineering',
  'Electronics and Telecommunications Engineering',
  'Information Technology',
  'Mechanical Engineering',
];
const EMPTY_FORM = { date: '', dept: '', users: '', usage: '' };
const format = (value) => Number(value || 0).toLocaleString();

async function api(method, url, body) {
  const options = { method, headers: {} };
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  let result = {};
  try {
    result = await response.json();
  } catch {
    // Report non-JSON errors with the HTTP status below.
  }
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function MonthlyChart({ rows, allRows, metric }) {
  const reportMonths = allRows.map((row) => row.date.slice(0, 7)).filter(Boolean).sort();
  const first = reportMonths[0];
  const last = reportMonths.at(-1);
  if (!first || !last) return <p className="empty-state">No report data to chart.</p>;

  const months = [];
  const [startYear, startMonth] = first.split('-').map(Number);
  const [endYear, endMonth] = last.split('-').map(Number);
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    if (++month > 12) {
      month = 1;
      year += 1;
    }
  }
  const values = Object.fromEntries(months.map((key) => [key, 0]));
  const reported = new Set(allRows.filter((row) => !row.dup).map((row) => row.date.slice(0, 7)));
  rows.forEach((row) => {
    if (!row.dup) values[row.date.slice(0, 7)] += Number(row[metric]) || 0;
  });

  const max = Math.max(1, ...Object.values(values));
  const width = Math.max(720, months.length * 88);
  const height = 300;
  const left = 34;
  const bottom = 62;
  const top = 40;
  const slot = (width - left * 2) / months.length;
  const barWidth = Math.min(48, slot * 0.56);
  const color = metric === 'users' ? '#6478d7' : '#4c9e91';

  return (
    <div className="chart-scroll">
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Monthly ${metric === 'users' ? 'student count' : 'lab usage'}`}>
        {[0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = height - bottom - (height - top - bottom) * fraction;
          return <line key={fraction} x1={left} x2={width - left} y1={y} y2={y} className="chart-grid" />;
        })}
        {months.map((key, index) => {
          const x = left + slot * index + slot / 2;
          const value = values[key];
          const barHeight = (height - top - bottom) * value / max;
          const [labelYear, labelMonth] = key.split('-');
          return (
            <g key={key}>
              {value > 0 && (
                <>
                  <rect x={x - barWidth / 2} y={height - bottom - barHeight} width={barWidth} height={barHeight} rx="6" fill={color} />
                  <text className="chart-value" x={x} y={height - bottom - barHeight - 8} textAnchor="middle">{format(value)}</text>
                </>
              )}
              {!value && <line x1={x - 11} x2={x + 11} y1={height - bottom} y2={height - bottom} className="chart-empty" />}
              <text className="chart-label" x={x} y={height - bottom + 22} textAnchor="middle">{MONTHS[Number(labelMonth) - 1]}</text>
              <text className="chart-year" x={x} y={height - bottom + 43} textAnchor="middle">{reported.has(key) ? labelYear : '—'}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Dashboard() {
  const [rows, setRows] = useState([]);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [password, setPassword] = useState('');
  const [filters, setFilters] = useState({ year: '', month: '', dept: '' });
  const [metric, setMetric] = useState('users');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  async function refresh() {
    setRows(await api('GET', '/api/records'));
  }

  useEffect(() => {
    (async () => {
      try {
        const [, me] = await Promise.all([refresh(), api('GET', '/api/me')]);
        setAdmin(me.admin);
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const years = useMemo(() => [...new Set(rows.map((row) => row.date.slice(0, 4)))].sort(), [rows]);
  const departments = useMemo(
    () => [...new Set([...DEPARTMENTS, ...rows.map((row) => row.dept)])].sort(),
    [rows],
  );
  const filtered = useMemo(
    () => rows.filter((row) => !row.dup
      && (!filters.year || row.date.startsWith(filters.year))
      && (!filters.month || row.date.slice(5, 7) === filters.month)
      && (!filters.dept || row.dept === filters.dept)),
    [rows, filters],
  );
  const visibleRecords = useMemo(
    () => rows
      .filter((row) => (!filters.year || row.date.startsWith(filters.year))
        && (!filters.month || row.date.slice(5, 7) === filters.month)
        && (!filters.dept || row.dept === filters.dept))
      .sort((a, b) => b.date.localeCompare(a.date) || a.dept.localeCompare(b.dept)),
    [rows, filters],
  );
  const summary = useMemo(() => {
    const byMonth = {};
    const byDepartment = {};
    const dates = new Set();
    filtered.forEach((row) => {
      dates.add(row.date);
      const month = row.date.slice(0, 7);
      byMonth[month] = (byMonth[month] || 0) + Number(row.users || 0);
      byDepartment[row.dept] = (byDepartment[row.dept] || 0) + Number(row.users || 0);
    });
    const busiest = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
    return {
      students: filtered.reduce((total, row) => total + Number(row.users || 0), 0),
      usage: filtered.reduce((total, row) => total + Number(row.usage || 0), 0),
      days: dates.size,
      busiest: busiest ? `${MONTHS[Number(busiest[0].slice(5)) - 1]} ${busiest[0].slice(0, 4)}` : '—',
      departments: Object.entries(byDepartment).sort((a, b) => b[1] - a[1]),
    };
  }, [filtered]);

  async function runAction(action) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await action();
      await refresh();
    } catch (requestError) {
      setMessage(requestError.message);
      if (/login required/i.test(requestError.message)) setAdmin(false);
    } finally {
      setBusy(false);
    }
  }

  async function submitRecord(event) {
    event.preventDefault();
    if (!form.date || !form.dept) {
      setMessage('Choose a date and department.');
      return;
    }
    await runAction(async () => {
      const payload = { ...form, users: Number(form.users) || 0, usage: Number(form.usage) || 0 };
      if (editingId) {
        await api('PUT', `/api/records/${editingId}`, payload);
        setMessage('Record updated.');
      } else {
        await api('POST', '/api/records', payload);
        setMessage('Record added.');
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
    });
  }

  async function login(event) {
    event.preventDefault();
    await runAction(async () => {
      await api('POST', '/api/login', { password });
      setAdmin(true);
      setShowLogin(false);
      setPassword('');
      setMessage('Signed in as administrator.');
    });
  }

  async function logout() {
    await runAction(async () => {
      await api('POST', '/api/logout');
      setAdmin(false);
      setMessage('Signed out.');
    });
  }

  async function importCsv(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const data = new FormData();
    data.append('file', file);
    await runAction(async () => {
      const result = await api('POST', '/api/import', data);
      setMessage(`${result.added} records imported (${result.skipped} already present or invalid).`);
    });
    event.target.value = '';
  }

  async function deleteRecord(id) {
    if (!window.confirm('Delete this record? This cannot be undone.')) return;
    await runAction(async () => {
      await api('DELETE', `/api/records/${id}`);
      setMessage('Record deleted.');
    });
  }

  function editRecord(row) {
    setEditingId(row.id);
    setForm({ date: row.date, dept: row.dept, users: row.users, usage: row.usage });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <main className="page">
      <img className="college-header" src={collegeHeader} alt="Marathwada Mitra Mandal’s College of Engineering, Karvenagar, Pune 52" />
      <header className="hero">
        <div>
          <p className="eyebrow">VIRTUAL LABS · NCID 48</p>
          <h1>Student activity</h1>
          <p className="hero-copy">A clear view of lab participation, usage, and report trends.</p>
        </div>
        <div className="toolbar">
          {admin ? (
            <>
              <span className="admin-pill"><span />Admin mode</span>
              <button className="button button-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>Import CSV</button>
              <input ref={fileRef} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={importCsv} />
              <button className="button button-secondary" onClick={logout} disabled={busy}>Log out</button>
            </>
          ) : <button className="button button-secondary" onClick={() => setShowLogin((shown) => !shown)}>Admin login</button>}
          <a className="button button-primary" href="/api/export.csv">Export CSV <span aria-hidden="true">↗</span></a>
        </div>
      </header>

      {showLogin && !admin && (
        <form className="login-card" onSubmit={login}>
          <label htmlFor="admin-password">Administrator password</label>
          <input id="admin-password" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <button className="button button-primary" disabled={busy}>Sign in</button>
        </form>
      )}
      {(error || message) && <div className={`notice ${error ? 'notice-error' : ''}`} role="status">{error || message}</div>}

      {loading ? (
        <section className="loading-card" aria-live="polite">Loading dashboard…</section>
      ) : error && !rows.length ? (
        <section className="loading-card"><strong>Unable to load dashboard</strong><p>{error}. Check the server and refresh.</p></section>
      ) : (
        <>
          <section className="filter-card" aria-label="Dashboard filters">
            <div className="filter-title"><span className="filter-icon" aria-hidden="true">⌕</span><div><strong>Explore reports</strong><small>Filter by year, month, or department</small></div></div>
            <div className="filters">
              <label><span>Year</span><select value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })}><option value="">All years</option>{years.map((year) => <option key={year}>{year}</option>)}</select></label>
              <label><span>Month</span><select value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })}><option value="">All months</option>{MONTHS.map((month, index) => <option key={month} value={String(index + 1).padStart(2, '0')}>{month}</option>)}</select></label>
              <label className="department-filter"><span>Department</span><select value={filters.dept} onChange={(event) => setFilters({ ...filters, dept: event.target.value })}><option value="">All departments</option>{departments.map((dept) => <option key={dept}>{dept}</option>)}</select></label>
              <button className="clear-button" onClick={() => setFilters({ year: '', month: '', dept: '' })}>Clear filters</button>
            </div>
          </section>

          <section className="stats-grid" aria-label="Summary statistics">
            <article className="stat-card"><div className="stat-top"><span>Students</span><span className="stat-icon violet" aria-hidden="true">↗</span></div><strong>{format(summary.students)}</strong><small>Summed daily users</small></article>
            <article className="stat-card"><div className="stat-top"><span>Lab usage</span><span className="stat-icon mint" aria-hidden="true">⌁</span></div><strong>{format(summary.usage)}</strong><small>Total recorded usage</small></article>
            <article className="stat-card"><div className="stat-top"><span>Report days</span><span className="stat-icon amber" aria-hidden="true">▦</span></div><strong>{format(summary.days)}</strong><small>Unique days reported</small></article>
            <article className="stat-card"><div className="stat-top"><span>Busiest month</span><span className="stat-icon blue" aria-hidden="true">◷</span></div><strong className="stat-month">{summary.busiest}</strong><small>By student count</small></article>
          </section>

          <section className="content-grid">
            <article className="card trend-card">
              <div className="section-heading">
                <div><p className="eyebrow">ACTIVITY OVER TIME</p><h2>Monthly trend</h2></div>
                <div className="segmented" role="group" aria-label="Chart metric">
                  <button className={metric === 'users' ? 'selected' : ''} onClick={() => setMetric('users')}>Students</button>
                  <button className={metric === 'usage' ? 'selected' : ''} onClick={() => setMetric('usage')}>Usage</button>
                </div>
              </div>
              <MonthlyChart rows={filtered} allRows={rows} metric={metric} />
              <p className="chart-note">Daily counts are summed, not unique students. Empty months indicate no reports.</p>
            </article>

            <article className="card department-card">
              <div className="section-heading"><div><p className="eyebrow">WHERE ACTIVITY HAPPENS</p><h2>By department</h2></div></div>
              {summary.departments.length ? (
                <div className="department-list">
                  {summary.departments.map(([dept, value], index) => (
                    <div className="department-row" key={dept}>
                      <div className="department-meta"><span>{dept}</span><strong>{format(value)}</strong></div>
                      <div className="progress-track"><span style={{ width: `${value / summary.departments[0][1] * 100}%`, animationDelay: `${index * 55}ms` }} /></div>
                    </div>
                  ))}
                </div>
              ) : <p className="empty-state">No matching data for these filters.</p>}
            </article>
          </section>

          {admin && (
            <section className="card manage-card">
              <div className="section-heading">
                <div><p className="eyebrow">ADMINISTRATION</p><h2>{editingId ? 'Edit record' : 'Add a record'}</h2></div>
                {editingId && <button className="clear-button" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}>Cancel editing</button>}
              </div>
              <form className="record-form" onSubmit={submitRecord}>
                <label><span>Date</span><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></label>
                <label className="form-department"><span>Department</span><select value={form.dept} onChange={(event) => setForm({ ...form, dept: event.target.value })} required><option value="">Choose department</option>{departments.map((dept) => <option key={dept}>{dept}</option>)}</select></label>
                <label><span>Students</span><input type="number" min="0" max="1000000" value={form.users} onChange={(event) => setForm({ ...form, users: event.target.value })} placeholder="0" /></label>
                <label><span>Usage</span><input type="number" min="0" max="1000000" value={form.usage} onChange={(event) => setForm({ ...form, usage: event.target.value })} placeholder="0" /></label>
                <button className="button button-primary form-submit" disabled={busy}>{editingId ? 'Save changes' : 'Add record'}</button>
              </form>
            </section>
          )}

          <section className="card records-card">
            <div className="section-heading records-heading">
              <div><p className="eyebrow">{admin ? 'ADMINISTRATION' : 'REPORT DETAIL'}</p><h2>{admin ? 'Manage records' : 'All reports'} <span className="count-pill">{visibleRecords.length}</span></h2></div>
              <span className="records-caption">Duplicate reports are excluded from totals</span>
            </div>
            <div className="table-wrap">
              {visibleRecords.length ? (
                <table>
                  <thead><tr><th>Date</th><th>Department</th><th className="numeric">Students</th><th className="numeric">Usage</th><th>Status</th>{admin && <th>Actions</th>}</tr></thead>
                  <tbody>{visibleRecords.map((row) => (
                    <tr className={row.dup ? 'duplicate-row' : ''} key={row.id}>
                      <td className="date-cell">{row.date}</td><td>{row.dept}</td><td className="numeric">{format(row.users)}</td><td className="numeric">{format(row.usage)}</td>
                      <td>{row.dup ? <span className="status-duplicate">Duplicate</span> : <span className="status-included">Included</span>}</td>
                      {admin && <td className="actions-cell"><button className="text-button" onClick={() => editRecord(row)}>Edit</button><button className="text-button danger" onClick={() => deleteRecord(row.id)} disabled={busy}>Delete</button></td>}
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="empty-state">No reports match these filters.</p>}
            </div>
          </section>
          <footer className="footer">Virtual Labs student activity dashboard <span>·</span> Marathwada Mitra Mandal’s College of Engineering</footer>
        </>
      )}
    </main>
  );
}

export default Dashboard;
