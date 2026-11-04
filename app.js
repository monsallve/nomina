/* ═══════════════════════════════════════════
   Nómina Pro — Application Logic
   ═══════════════════════════════════════════ */

const STORAGE_KEY = 'nomina_pro_data_v3';
const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

let data = { companies: [] };
let currentCompanyId = null;
let currentEmployeeId = null;
let editingCompanyId = null;
let editingEmployeeId = null;
let logoBase64 = null;
let fileHandle = null; // File System Access API handle (same file overwrite)
let linkedFileName = localStorage.getItem('nomina_pro_linked_name') || '';
const IDB_NAME = 'nomina_pro_fs';
const IDB_STORE = 'handles';

/* ── Utils ── */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const money = (n) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(n || 0);

const esc = (s) => {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
};

const initials = (name) =>
  (name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();

/* Subtle UI sound via Web Audio (no external files needed) */
function playSound(type = 'click') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === 'success') {
      osc.frequency.value = 660;
      gain.gain.value = 0.06;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.stop(ctx.currentTime + 0.18);
    } else if (type === 'error') {
      osc.frequency.value = 180;
      gain.gain.value = 0.08;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.stop(ctx.currentTime + 0.22);
    } else {
      osc.frequency.value = 420;
      gain.gain.value = 0.04;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.stop(ctx.currentTime + 0.08);
    }
  } catch (_) { /* ignore */ }
}

function toast(msg, type = 'default') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'success' ? ' success' : type === 'error' ? ' error' : '');
  t.textContent = msg;
  c.appendChild(t);
  if (type === 'success') playSound('success');
  else if (type === 'error') playSound('error');
  else playSound('click');
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
    t.style.transition = 'all 0.25s';
    setTimeout(() => t.remove(), 250);
  }, 2800);
}

/* ── Persistence ── */
function normalizeData(raw) {
  const out = { companies: [] };
  if (!raw || typeof raw !== 'object') return out;
  const list = Array.isArray(raw.companies) ? raw.companies : [];
  out.companies = list.filter((c) => c && typeof c === 'object').map((c) => {
    const company = {
      id: c.id || uid(),
      name: String(c.name || 'Sin nombre'),
      nit: String(c.nit || ''),
      address: String(c.address || ''),
      phone: String(c.phone || ''),
      email: String(c.email || ''),
      rep: String(c.rep || ''),
      legal: String(c.legal || ''),
      logo: c.logo || null,
      employees: [],
      stubs: []
    };
    const emps = Array.isArray(c.employees) ? c.employees : [];
    company.employees = emps.filter((e) => e && typeof e === 'object').map((e) => ({
      id: e.id || uid(),
      name: String(e.name || ''),
      document: String(e.document || ''),
      position: String(e.position || ''),
      hourlyRate: Number(e.hourlyRate) || 0,
      paymentMethod: e.paymentMethod === 'banco' ? 'banco' : 'efectivo',
      bank: String(e.bank || ''),
      phone: String(e.phone || ''),
      applyNight: !!e.applyNight,
      nightPercent: Number(e.nightPercent) >= 0 ? Number(e.nightPercent) : 35,
      applyHoliday: !!e.applyHoliday,
      holidayPercent: Number(e.holidayPercent) >= 0 ? Number(e.holidayPercent) : 75,
      notes: String(e.notes || ''),
      hours: e.hours && typeof e.hours === 'object' ? e.hours : {}
    }));
    const stubs = Array.isArray(c.stubs) ? c.stubs : [];
    company.stubs = stubs.filter((s) => s && typeof s === 'object').map((s) => ({
      id: s.id || uid(),
      employeeId: s.employeeId || '',
      periodKey: s.periodKey || '',
      periodLabel: s.periodLabel || '',
      date: s.date || '',
      total: Number(s.total) || 0,
      totalHours: Number(s.totalHours) || 0,
      gross: Number(s.gross) || 0,
      days: s.days && typeof s.days === 'object' ? s.days : {},
      deductions: Array.isArray(s.deductions) ? s.deductions : [],
      dedTotal: Number(s.dedTotal) || 0
    }));
    return company;
  });
  return out;
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      data = normalizeData(JSON.parse(raw));
      return;
    }
    for (const k of ['nomina_pro_data_v2', 'nomina_pro_data_v1']) {
      const old = localStorage.getItem(k);
      if (old) {
        data = normalizeData(JSON.parse(old));
        saveData();
        return;
      }
    }
  } catch (e) {
    console.error(e);
    data = { companies: [] };
  }
}

function saveData() {
  try {
    if (!data || !Array.isArray(data.companies)) data = { companies: [] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error(e);
    const msg = (e && e.name === 'QuotaExceededError')
      ? 'Almacenamiento lleno. Exporta una copia y libera espacio.'
      : 'Error al guardar en el navegador.';
    toast(msg, 'error');
  }
}

/* ── Navigation ── */
function showPage(id) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goHome() {
  currentCompanyId = null;
  currentEmployeeId = null;
  showPage('page-home');
  renderCompanies();
}

function goCompany() {
  currentEmployeeId = null;
  showPage('page-company');
  renderCompanyPage();
}

function getCompany() {
  return data.companies.find((c) => c.id === currentCompanyId);
}

function getEmployee() {
  const c = getCompany();
  return c ? (c.employees || []).find((e) => e.id === currentEmployeeId) : null;
}

/* ── Companies ── */
function renderCompanies() {
  const list = document.getElementById('companies-list');
  const empty = document.getElementById('companies-empty');
  if (!list || !empty) return;
  list.innerHTML = '';
  if (!data.companies.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  data.companies
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
    .forEach((c) => {
      const el = document.createElement('div');
      el.className = 'list-item';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.onclick = () => openCompany(c.id);
      el.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openCompany(c.id);
        }
      };
      const nEmp = (c.employees && c.employees.length) || 0;
      let avatarHtml;
      if (c.logo) {
        avatarHtml = `<img class="list-logo" src="${c.logo.replace(/"/g, '')}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';"><div class="list-avatar company" style="display:none">${esc(initials(c.name))}</div>`;
      } else {
        avatarHtml = `<div class="list-avatar company">${esc(initials(c.name))}</div>`;
      }
      el.innerHTML = `
        ${avatarHtml}
        <div class="list-body">
          <div class="list-name">${esc(c.name)}</div>
          <div class="list-meta">NIT ${esc(c.nit)} · ${nEmp} empleado${nEmp !== 1 ? 's' : ''}</div>
        </div>
        <span class="list-arrow" aria-hidden="true">→</span>`;
      list.appendChild(el);
    });
}

function openCompany(id) {
  currentCompanyId = id;
  showPage('page-company');
  renderCompanyPage();
  playSound('click');
}

function renderCompanyPage() {
  const c = getCompany();
  if (!c) return goHome();
  document.getElementById('company-name-title').textContent = c.name;
  document.getElementById('company-nit').textContent = 'NIT: ' + c.nit;
  document.getElementById('company-address').textContent = [c.address, c.phone, c.email]
    .filter(Boolean)
    .join(' · ');

  const logo = document.getElementById('company-logo');
  const ph = document.getElementById('company-logo-ph');
  if (c.logo) {
    logo.src = c.logo;
    logo.style.display = 'block';
    ph.style.display = 'none';
  } else {
    logo.style.display = 'none';
    ph.style.display = 'grid';
    ph.textContent = initials(c.name);
  }

  const empList = document.getElementById('employees-list');
  const empEmpty = document.getElementById('employees-empty');
  empList.innerHTML = '';
  const emps = (c.employees || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (!emps.length) {
    empEmpty.classList.remove('hidden');
  } else {
    empEmpty.classList.add('hidden');
    emps.forEach((e) => {
      const pay = e.paymentMethod === 'banco' ? '🏦 Banco' : '💵 Efectivo';
      const el = document.createElement('div');
      el.className = 'list-item';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.onclick = () => openEmployee(e.id);
      el.onkeydown = (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openEmployee(e.id);
        }
      };
      el.innerHTML = `
        <div class="list-avatar">${esc(initials(e.name))}</div>
        <div class="list-body">
          <div class="list-name">${esc(e.name)}</div>
          <div class="list-meta">Doc ${esc(e.document)} · ${esc(e.position || 'Sin cargo')} · ${money(e.hourlyRate)}/h · ${pay}</div>
        </div>
        <span class="list-arrow" aria-hidden="true">→</span>`;
      empList.appendChild(el);
    });
  }

  const stubsList = document.getElementById('stubs-list');
  const stubsEmpty = document.getElementById('stubs-empty');
  stubsList.innerHTML = '';
  const stubs = (c.stubs || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!stubs.length) {
    stubsEmpty.classList.remove('hidden');
  } else {
    stubsEmpty.classList.add('hidden');
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    const table = document.createElement('table');
    table.innerHTML = `<thead><tr><th>Empleado</th><th>Periodo</th><th>Fecha</th><th>Valor</th><th></th></tr></thead><tbody></tbody>`;
    const tb = table.querySelector('tbody');
    stubs.forEach((s) => {
      const emp = (c.employees || []).find((e) => e.id === s.employeeId);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600;">${esc(emp ? emp.name : '—')}</td>
        <td>${esc(s.periodLabel || '')}</td>
        <td>${esc(s.date || '')}</td>
        <td style="font-weight:700;color:#b8c98a;">${money(s.total)}</td>
        <td><button type="button" class="btn btn-soft btn-sm" onclick="event.stopPropagation();downloadStub('${s.id}')">⬇ PDF</button></td>`;
      tb.appendChild(tr);
    });
    wrap.appendChild(table);
    stubsList.appendChild(wrap);
  }
}

/* ── Company modal ── */
function showAddCompanyModal() {
  editingCompanyId = null;
  logoBase64 = null;
  document.getElementById('modal-company-title').textContent = 'Nueva empresa';
  ['c-name', 'c-nit', 'c-address', 'c-phone', 'c-email', 'c-rep', 'c-legal'].forEach(
    (id) => (document.getElementById(id).value = '')
  );
  document.getElementById('c-logo-preview').style.display = 'none';
  document.getElementById('c-logo').value = '';
  document.getElementById('modal-company').classList.remove('hidden');
  setTimeout(() => document.getElementById('c-name').focus(), 120);
  playSound('click');
}


function deleteCompany() {
  const c = getCompany();
  if (!c) return;
  const nEmp = (c.employees && c.employees.length) || 0;
  const nStub = (c.stubs && c.stubs.length) || 0;
  const msg =
    '¿Eliminar la empresa «' + c.name + '»?\n\n' +
    'Se borrarán también ' + nEmp + ' empleado(s) y ' + nStub + ' colilla(s).\n' +
    'Esta acción no se puede deshacer.';
  if (!confirm(msg)) return;
  data.companies = data.companies.filter((x) => x.id !== c.id);
  saveData();
  toast('Empresa eliminada', 'success');
  goHome();
}

function deleteEmployee() {
  const c = getCompany();
  const e = getEmployee();
  if (!c || !e) return;
  const msg =
    '¿Eliminar al empleado «' + e.name + '»?\n\n' +
    'Se eliminarán sus horas registradas y las colillas asociadas.\n' +
    'Esta acción no se puede deshacer.';
  if (!confirm(msg)) return;
  if (!c.employees) c.employees = [];
  c.employees = c.employees.filter((x) => x.id !== e.id);
  if (c.stubs) c.stubs = c.stubs.filter((s) => s.employeeId !== e.id);
  currentEmployeeId = null;
  saveData();
  toast('Empleado eliminado', 'success');
  goCompany();
}

function editCompany() {
  const c = getCompany();
  if (!c) return;
  editingCompanyId = c.id;
  logoBase64 = c.logo || null;
  document.getElementById('modal-company-title').textContent = 'Editar empresa';
  document.getElementById('c-name').value = c.name || '';
  document.getElementById('c-nit').value = c.nit || '';
  document.getElementById('c-address').value = c.address || '';
  document.getElementById('c-phone').value = c.phone || '';
  document.getElementById('c-email').value = c.email || '';
  document.getElementById('c-rep').value = c.rep || '';
  document.getElementById('c-legal').value = c.legal || '';
  const prev = document.getElementById('c-logo-preview');
  if (c.logo) {
    prev.src = c.logo;
    prev.style.display = 'block';
  } else prev.style.display = 'none';
  document.getElementById('modal-company').classList.remove('hidden');
  playSound('click');
}

function previewLogo(ev) {
  const f = ev.target.files[0];
  if (!f) return;
  if (f.size > 2e6) {
    toast('La imagen es muy pesada (máx 2 MB)', 'error');
    return;
  }
  const r = new FileReader();
  r.onload = (e) => {
    logoBase64 = e.target.result;
    const img = document.getElementById('c-logo-preview');
    img.src = logoBase64;
    img.style.display = 'block';
  };
  r.readAsDataURL(f);
}

function saveCompany() {
  const name = document.getElementById('c-name').value.trim();
  const nit = document.getElementById('c-nit').value.trim();
  if (!name || !nit) {
    toast('Nombre y NIT son obligatorios', 'error');
    return;
  }
  const fields = {
    name,
    nit,
    address: document.getElementById('c-address').value.trim(),
    phone: document.getElementById('c-phone').value.trim(),
    email: document.getElementById('c-email').value.trim(),
    rep: document.getElementById('c-rep').value.trim(),
    legal: document.getElementById('c-legal').value.trim()
  };
  if (editingCompanyId) {
    const c = data.companies.find((x) => x.id === editingCompanyId);
    Object.assign(c, fields, { logo: logoBase64 || c.logo });
    toast('Empresa actualizada', 'success');
  } else {
    data.companies.push({
      id: uid(),
      ...fields,
      logo: logoBase64,
      employees: [],
      stubs: []
    });
    toast('Empresa creada', 'success');
  }
  saveData();
  closeModal('modal-company');
  if (editingCompanyId) renderCompanyPage();
  else renderCompanies();
}

/* ── Employees ── */
function openEmployee(id) {
  currentEmployeeId = id;
  showPage('page-employee');
  renderEmployeePage();
  playSound('click');
}

function renderEmployeePage() {
  const e = getEmployee();
  if (!e) return goCompany();
  document.getElementById('emp-name-title').textContent = e.name;
  document.getElementById('emp-doc').textContent = 'Documento: ' + e.document;
  document.getElementById('emp-position').textContent = e.position || 'Sin cargo definido';
  document.getElementById('emp-rate').textContent = money(e.hourlyRate) + '/h';
  document.getElementById('emp-payment').textContent =
    e.paymentMethod === 'banco'
      ? 'Consignación' + (e.bank ? ' · ' + e.bank : '')
      : 'Efectivo';
  document.getElementById('emp-phone').textContent = e.phone || '—';
  const surch = [];
  if (e.applyNight) surch.push('Noct. ' + (e.nightPercent || 35) + '%');
  if (e.applyHoliday) surch.push('Dom/Fest ' + (e.holidayPercent || 75) + '%');
  document.getElementById('emp-surcharges').textContent = surch.length ? surch.join(' · ') : 'Ninguno';

  const now = new Date();
  const yearSel = document.getElementById('quincena-year');
  yearSel.innerHTML = '';
  for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 1; y++) {
    const o = document.createElement('option');
    o.value = y;
    o.textContent = y;
    if (y === now.getFullYear()) o.selected = true;
    yearSel.appendChild(o);
  }
  const monthSel = document.getElementById('quincena-month');
  monthSel.innerHTML = '';
  MONTHS.forEach((m, i) => {
    const o = document.createElement('option');
    o.value = i + 1;
    o.textContent = m;
    if (i + 1 === now.getMonth() + 1) o.selected = true;
    monthSel.appendChild(o);
  });
  document.getElementById('quincena-half').value = now.getDate() <= 15 ? '1' : '2';

  ['ded-salud', 'ded-pension', 'ded-retefuente', 'ded-otra1', 'ded-otra2'].forEach(
    (id) => (document.getElementById(id).checked = false)
  );
  [
    'ded-salud-val',
    'ded-pension-val',
    'ded-retefuente-val',
    'ded-otra1-val',
    'ded-otra2-val',
    'ded-otra1-name',
    'ded-otra2-name'
  ].forEach((id) => (document.getElementById(id).value = ''));

  renderHoursGrid();
}

function showAddEmployeeModal() {
  editingEmployeeId = null;
  document.getElementById('modal-employee-title').textContent = 'Nuevo empleado';
  ['e-name', 'e-doc', 'e-position', 'e-rate', 'e-phone', 'e-bank', 'e-notes'].forEach(
    (id) => (document.getElementById(id).value = '')
  );
  document.getElementById('e-payment').value = 'efectivo';
  document.getElementById('e-night').checked = false;
  document.getElementById('e-holiday').checked = false;
  document.getElementById('e-night-pct').value = 35;
  document.getElementById('e-holiday-pct').value = 75;
  toggleBankField();
  toggleSurchargeFields();
  document.getElementById('modal-employee').classList.remove('hidden');
  setTimeout(() => document.getElementById('e-name').focus(), 120);
  playSound('click');
}

function editEmployee() {
  const e = getEmployee();
  if (!e) return;
  editingEmployeeId = e.id;
  document.getElementById('modal-employee-title').textContent = 'Editar empleado';
  document.getElementById('e-name').value = e.name || '';
  document.getElementById('e-doc').value = e.document || '';
  document.getElementById('e-position').value = e.position || '';
  document.getElementById('e-rate').value = e.hourlyRate || '';
  document.getElementById('e-payment').value = e.paymentMethod || 'efectivo';
  document.getElementById('e-bank').value = e.bank || '';
  document.getElementById('e-phone').value = e.phone || '';
  document.getElementById('e-night').checked = !!e.applyNight;
  document.getElementById('e-holiday').checked = !!e.applyHoliday;
  document.getElementById('e-night-pct').value = e.nightPercent != null ? e.nightPercent : 35;
  document.getElementById('e-holiday-pct').value = e.holidayPercent != null ? e.holidayPercent : 75;
  document.getElementById('e-notes').value = e.notes || '';
  toggleBankField();
  toggleSurchargeFields();
  document.getElementById('modal-employee').classList.remove('hidden');
  playSound('click');
}

function toggleBankField() {
  document.getElementById('bank-field').style.display =
    document.getElementById('e-payment').value === 'banco' ? 'block' : 'none';
}

function toggleSurchargeFields() {
  document.getElementById('night-percent-field').style.display = document.getElementById('e-night')
    .checked
    ? 'block'
    : 'none';
  document.getElementById('holiday-percent-field').style.display = document.getElementById(
    'e-holiday'
  ).checked
    ? 'block'
    : 'none';
}

function saveEmployee() {
  const name = document.getElementById('e-name').value.trim();
  const doc = document.getElementById('e-doc').value.trim();
  const rate = parseFloat(document.getElementById('e-rate').value) || 0;
  if (!name || !doc) {
    toast('Nombre y documento son obligatorios', 'error');
    return;
  }
  if (rate <= 0) {
    toast('El valor por hora debe ser mayor a 0', 'error');
    return;
  }
  const c = getCompany();
  if (!c) return;
  if (!c.employees) c.employees = [];
  const payload = {
    name,
    document: doc,
    position: document.getElementById('e-position').value.trim(),
    hourlyRate: rate,
    paymentMethod: document.getElementById('e-payment').value,
    bank:
      document.getElementById('e-payment').value === 'banco'
        ? document.getElementById('e-bank').value.trim()
        : '',
    phone: document.getElementById('e-phone').value.trim(),
    applyNight: document.getElementById('e-night').checked,
    nightPercent: parseFloat(document.getElementById('e-night-pct').value) || 35,
    applyHoliday: document.getElementById('e-holiday').checked,
    holidayPercent: parseFloat(document.getElementById('e-holiday-pct').value) || 75,
    notes: document.getElementById('e-notes').value.trim()
  };
  if (editingEmployeeId) {
    const e = c.employees.find((x) => x.id === editingEmployeeId);
    Object.assign(e, payload);
    toast('Empleado actualizado', 'success');
  } else {
    c.employees.push({ id: uid(), ...payload, hours: {} });
    toast('Empleado agregado', 'success');
  }
  saveData();
  closeModal('modal-employee');
  if (editingEmployeeId) renderEmployeePage();
  else renderCompanyPage();
}

/* ── Hours ── */
function getQuincenaKey() {
  const y = document.getElementById('quincena-year').value;
  const m = document.getElementById('quincena-month').value.padStart(2, '0');
  const h = document.getElementById('quincena-half').value;
  return `${y}-${m}-${h}`;
}

function getDaysInQuincena() {
  const y = +document.getElementById('quincena-year').value;
  const m = +document.getElementById('quincena-month').value;
  const half = document.getElementById('quincena-half').value;
  const last = new Date(y, m, 0).getDate();
  return half === '1'
    ? Array.from({ length: 15 }, (_, i) => i + 1)
    : Array.from({ length: last - 15 }, (_, i) => i + 16);
}

function calcDayValue(hours, isNight, isHoliday, emp) {
  if (!hours || hours <= 0) return 0;
  let rate = emp.hourlyRate || 0;
  if (emp.applyNight && isNight) rate *= 1 + (emp.nightPercent || 35) / 100;
  if (emp.applyHoliday && isHoliday) rate *= 1 + (emp.holidayPercent || 75) / 100;
  return hours * rate;
}

function renderHoursGrid() {
  const e = getEmployee();
  if (!e) return;
  const key = getQuincenaKey();
  const saved = e.hours && e.hours[key] ? e.hours[key] : { days: {} };
  const daysData = saved.days || {};
  const days = getDaysInQuincena();
  const grid = document.getElementById('hours-grid');
  grid.innerHTML = '';
  const y = +document.getElementById('quincena-year').value;
  const m = +document.getElementById('quincena-month').value;
  const showNight = !!e.applyNight;
  const showHoliday = !!e.applyHoliday;
  document.getElementById('surcharge-hint').classList.toggle('hidden', !(showNight || showHoliday));

  days.forEach((d) => {
    const date = new Date(y, m - 1, d);
    const dow = date.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const dd = daysData[d] || {};
    const hoursVal =
      typeof dd === 'object' && dd.hours != null ? dd.hours : typeof dd === 'number' ? dd : '';
    const nightVal = typeof dd === 'object' ? !!dd.night : false;
    const holVal =
      typeof dd === 'object' ? (dd.holiday != null ? !!dd.holiday : dow === 0) : dow === 0;
    const cell = document.createElement('div');
    cell.className = 'day-cell' + (isWeekend ? ' weekend' : '');
    let checks = '';
    if (showNight || showHoliday) {
      checks = '<div class="day-checks">';
      if (showNight)
        checks += `<label><input type="checkbox" data-day="${d}" data-type="night" ${nightVal ? 'checked' : ''} onchange="updateSummary()"> Nocturno</label>`;
      if (showHoliday)
        checks += `<label><input type="checkbox" data-day="${d}" data-type="holiday" ${holVal ? 'checked' : ''} onchange="updateSummary()"> Dom/Fest</label>`;
      checks += '</div>';
    }
    cell.innerHTML = `
      <div class="day-num">Día ${d}</div>
      <div class="day-name">${DAY_SHORT[dow]}</div>
      <input type="number" min="0" max="24" step="0.5" inputmode="decimal" data-day="${d}" data-type="hours" value="${hoursVal}" placeholder="0" oninput="updateSummary()">
      ${checks}`;
    grid.appendChild(cell);
  });

  if (saved.deductions) {
    const dd = saved.deductions;
    if (dd.salud) {
      document.getElementById('ded-salud').checked = true;
      document.getElementById('ded-salud-val').value = dd.salud;
    }
    if (dd.pension) {
      document.getElementById('ded-pension').checked = true;
      document.getElementById('ded-pension-val').value = dd.pension;
    }
    if (dd.retefuente) {
      document.getElementById('ded-retefuente').checked = true;
      document.getElementById('ded-retefuente-val').value = dd.retefuente;
    }
    if (dd.otra1) {
      document.getElementById('ded-otra1').checked = true;
      document.getElementById('ded-otra1-name').value = dd.otra1.name || '';
      document.getElementById('ded-otra1-val').value = dd.otra1.amount || '';
    }
    if (dd.otra2) {
      document.getElementById('ded-otra2').checked = true;
      document.getElementById('ded-otra2-name').value = dd.otra2.name || '';
      document.getElementById('ded-otra2-val').value = dd.otra2.amount || '';
    }
  }
  updateSummary();
}

function collectDayData() {
  const e = getEmployee();
  const days = {};
  let totalH = 0;
  let gross = 0;
  document.querySelectorAll('#hours-grid input[data-type="hours"]').forEach((inp) => {
    const d = inp.dataset.day;
    let hours = parseFloat(inp.value);
    if (!Number.isFinite(hours) || hours < 0) hours = 0;
    if (hours > 24) hours = 24;
    const nightEl = document.querySelector(`#hours-grid input[data-day="${d}"][data-type="night"]`);
    const holEl = document.querySelector(`#hours-grid input[data-day="${d}"][data-type="holiday"]`);
    const isNight = nightEl ? nightEl.checked : false;
    const isHoliday = holEl ? holEl.checked : false;
    if (hours <= 0 && !isNight && !isHoliday) return;
    const value = calcDayValue(hours, isNight, isHoliday, e);
    days[d] = { hours, night: isNight, holiday: isHoliday, value };
    totalH += hours;
    gross += value;
  });
  return { days, totalH, gross };
}

function collectDeductions() {
  const list = [];
  let total = 0;
  const add = (chk, name, val) => {
    const amount = parseFloat(val) || 0;
    if (chk && amount > 0) {
      list.push({ name, amount });
      total += amount;
    }
  };
  add(
    document.getElementById('ded-salud').checked,
    'Aporte salud (trabajador)',
    document.getElementById('ded-salud-val').value
  );
  add(
    document.getElementById('ded-pension').checked,
    'Aporte pensión (trabajador)',
    document.getElementById('ded-pension-val').value
  );
  add(
    document.getElementById('ded-retefuente').checked,
    'Retención en la fuente',
    document.getElementById('ded-retefuente-val').value
  );
  add(
    document.getElementById('ded-otra1').checked,
    document.getElementById('ded-otra1-name').value.trim() || 'Otra deducción',
    document.getElementById('ded-otra1-val').value
  );
  add(
    document.getElementById('ded-otra2').checked,
    document.getElementById('ded-otra2-name').value.trim() || 'Otra deducción',
    document.getElementById('ded-otra2-val').value
  );
  return { list, total };
}

function updateSummary() {
  const e = getEmployee();
  if (!e) return;
  const { totalH, gross } = collectDayData();
  const { total: dedTotal } = collectDeductions();
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set('sum-hours', totalH.toFixed(1) + ' h');
  set('sum-gross', money(gross));
  set('sum-deductions', money(dedTotal));
  set('sum-neto', money(Math.max(0, gross - dedTotal)));
}

function saveHours() {
  const e = getEmployee();
  if (!e) return;
  if (!e.hours) e.hours = {};
  const key = getQuincenaKey();
  const { days, totalH, gross } = collectDayData();
  const { list: dedList, total: dedTotal } = collectDeductions();
  const deductions = {};
  if (document.getElementById('ded-salud').checked)
    deductions.salud = parseFloat(document.getElementById('ded-salud-val').value) || 0;
  if (document.getElementById('ded-pension').checked)
    deductions.pension = parseFloat(document.getElementById('ded-pension-val').value) || 0;
  if (document.getElementById('ded-retefuente').checked)
    deductions.retefuente = parseFloat(document.getElementById('ded-retefuente-val').value) || 0;
  if (document.getElementById('ded-otra1').checked)
    deductions.otra1 = {
      name: document.getElementById('ded-otra1-name').value.trim() || 'Otra deducción',
      amount: parseFloat(document.getElementById('ded-otra1-val').value) || 0
    };
  if (document.getElementById('ded-otra2').checked)
    deductions.otra2 = {
      name: document.getElementById('ded-otra2-name').value.trim() || 'Otra deducción',
      amount: parseFloat(document.getElementById('ded-otra2-val').value) || 0
    };
  e.hours[key] = {
    days,
    totalHours: totalH,
    gross,
    deductions,
    dedTotal,
    deductionList: dedList,
    neto: Math.max(0, gross - dedTotal),
    savedAt: new Date().toISOString()
  };
  saveData();
  toast('Horas y deducciones guardadas', 'success');
}

/* ── PDF ── */
function getPeriodLabel() {
  const y = document.getElementById('quincena-year').value;
  const m = +document.getElementById('quincena-month').value;
  const half = document.getElementById('quincena-half').value;
  return `${half === '1' ? '1ª' : '2ª'} quincena de ${MONTHS[m - 1]} ${y}`;
}

function buildPdf(c, e, periodLabel, hoursData, genDate) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 14;

  if (c.logo) {
    try {
      doc.addImage(c.logo, 'JPEG', 14, y, 26, 15);
    } catch {
      try {
        doc.addImage(c.logo, 'PNG', 14, y, 26, 15);
      } catch (_) {}
    }
  }
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(c.name || 'Empresa', c.logo ? 44 : 14, y + 5);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text('NIT: ' + (c.nit || ''), c.logo ? 44 : 14, y + 10);
  if (c.address) doc.text(c.address, c.logo ? 44 : 14, y + 14);
  y += 20;

  doc.setFillColor(30, 58, 110);
  doc.roundedRect(14, y, pageW - 28, 8, 1.5, 1.5, 'F');
  doc.setTextColor(255);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('COLILLA DE PAGO', pageW / 2, y + 5.5, { align: 'center' });
  doc.setTextColor(0);
  y += 12;

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Periodo: ' + periodLabel, 14, y);
  doc.text('Fecha: ' + genDate, pageW - 14, y, { align: 'right' });
  y += 7;

  doc.setDrawColor(220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, y, pageW - 28, 26, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Datos del trabajador', 17, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Nombre: ' + e.name, 17, y + 11);
  doc.text('Documento: ' + e.document, 17, y + 16);
  doc.text('Cargo: ' + (e.position || '—'), 17, y + 21);
  doc.text('Valor hora: ' + money(e.hourlyRate), pageW / 2 + 2, y + 11);
  const payTxt =
    e.paymentMethod === 'banco'
      ? 'Consignación' + (e.bank ? ' · ' + e.bank : '')
      : 'Efectivo';
  doc.text('Pago: ' + payTxt, pageW / 2 + 2, y + 16);
  y += 32;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Detalle de horas por día', 14, y);
  y += 3;

  const daysObj = hoursData.days || {};
  const dayKeys = Object.keys(daysObj)
    .map(Number)
    .sort((a, b) => a - b);
  const body = dayKeys.map((d) => {
    const info = daysObj[d];
    const h = typeof info === 'object' ? info.hours || 0 : info || 0;
    const night = typeof info === 'object' && info.night;
    const holiday = typeof info === 'object' && info.holiday;
    const val =
      typeof info === 'object' && info.value != null
        ? info.value
        : calcDayValue(h, night, holiday, e);
    const flags = [night ? 'N' : '', holiday ? 'D/F' : ''].filter(Boolean).join('+') || '—';
    return [String(d), h.toFixed(1), flags, money(val)];
  });
  if (!body.length) body.push(['—', '0', '—', money(0)]);

  doc.autoTable({
    startY: y,
    head: [['Día', 'Horas', 'Recargo', 'Valor']],
    body,
    theme: 'striped',
    headStyles: { fillColor: [30, 58, 110], fontSize: 8, cellPadding: 2.5 },
    bodyStyles: { fontSize: 8, cellPadding: 2.2 },
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 25 },
      2: { cellWidth: 28 },
      3: { cellWidth: 40 }
    }
  });
  y = doc.lastAutoTable.finalY + 7;

  const gross = hoursData.gross || 0;
  const dedList = hoursData.deductionList || [];
  const dedTotal = hoursData.dedTotal || 0;
  const neto = hoursData.neto != null ? hoursData.neto : Math.max(0, gross - dedTotal);

  let boxH = 16 + (dedList.length ? dedList.length * 5 + 6 : 0) + 8;
  doc.setFillColor(245, 240, 230);
  doc.roundedRect(14, y, pageW - 28, boxH, 2, 2, 'F');
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Total horas:', 18, y + 6);
  doc.text((hoursData.totalHours || 0).toFixed(1) + ' h', pageW - 18, y + 6, { align: 'right' });
  doc.text('Total bruto:', 18, y + 12);
  doc.text(money(gross), pageW - 18, y + 12, { align: 'right' });
  let yy = y + 17;
  if (dedList.length) {
    doc.setFont('helvetica', 'bold');
    doc.text('Deducciones:', 18, yy);
    yy += 5;
    doc.setFont('helvetica', 'normal');
    dedList.forEach((d) => {
      doc.text('  · ' + d.name, 18, yy);
      doc.text(money(d.amount), pageW - 18, yy, { align: 'right' });
      yy += 5;
    });
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('NETO A PAGAR:', 18, y + boxH - 4);
  doc.text(money(neto), pageW - 18, y + boxH - 4, { align: 'right' });
  y += boxH + 7;

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120);
  const lines = [];
  if (c.rep) lines.push('Representante legal: ' + c.rep);
  if (c.legal) lines.push(c.legal);
  lines.push('Comprobante de pago conforme al Art. 134 del Código Sustantivo del Trabajo.');
  if (!dedList.length) lines.push('No se aplicaron deducciones en este periodo.');
  doc.text(lines, 14, y, { maxWidth: pageW - 28 });
  return doc;
}

function generateStub() {
  const c = getCompany();
  const e = getEmployee();
  if (!c || !e) return;
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast('Espera un momento a que cargue el generador de PDF e inténtalo de nuevo', 'error');
    return;
  }
  saveHours();
  const key = getQuincenaKey();
  if (!e.hours) e.hours = {};
  const hd = e.hours[key];
  if (!hd || hd.totalHours <= 0) {
    toast('Ingresa horas antes de generar la colilla', 'error');
    return;
  }
  const { list: dedList, total: dedTotal } = collectDeductions();
  hd.deductionList = dedList;
  hd.dedTotal = dedTotal;
  hd.neto = Math.max(0, (hd.gross || 0) - dedTotal);
  e.hours[key] = hd;
  saveData();

  const periodLabel = getPeriodLabel();
  const genDate = new Date().toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const doc = buildPdf(c, e, periodLabel, hd, genDate);

  if (!c.stubs) c.stubs = [];
  const idx = c.stubs.findIndex((s) => s.employeeId === e.id && s.periodKey === key);
  const rec = {
    id: idx >= 0 ? c.stubs[idx].id : uid(),
    employeeId: e.id,
    periodKey: key,
    periodLabel,
    date: new Date().toISOString().slice(0, 10),
    total: hd.neto,
    totalHours: hd.totalHours,
    gross: hd.gross,
    days: hd.days,
    deductions: dedList,
    dedTotal
  };
  if (idx >= 0) c.stubs[idx] = rec;
  else c.stubs.push(rec);
  saveData();

  doc.save(`Colilla_${e.name.replace(/\s+/g, '_')}_${periodLabel.replace(/\s+/g, '_')}.pdf`);
  toast('Colilla generada y descargada', 'success');
}

function downloadStub(stubId) {
  const c = getCompany();
  if (!c) return;
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast('Espera a que cargue el generador de PDF', 'error');
    return;
  }
  const stub = (c.stubs || []).find((s) => s.id === stubId);
  if (!stub) return;
  const e = (c.employees || []).find((emp) => emp.id === stub.employeeId);
  if (!e) {
    toast('Empleado no encontrado', 'error');
    return;
  }
  const hd = {
    days: stub.days || {},
    totalHours: stub.totalHours || 0,
    gross: stub.gross || 0,
    deductionList: stub.deductions || [],
    dedTotal: stub.dedTotal || 0,
    neto: stub.total
  };
  const doc = buildPdf(c, e, stub.periodLabel || '', hd, stub.date || '');
  doc.save(
    `Colilla_${e.name.replace(/\s+/g, '_')}_${(stub.periodLabel || '').replace(/\s+/g, '_')}.pdf`
  );
  toast('Colilla descargada', 'success');
}

/* ── Export / Import ── */
/* ── File System Access (same-file save) ── */
function isSecureCtx() {
  return window.isSecureContext === true;
}

function supportsFSAccess() {
  return isSecureCtx() &&
    typeof window.showOpenFilePicker === 'function' &&
    typeof window.showSaveFilePicker === 'function';
}

function setLinkedName(name) {
  linkedFileName = (name || '').trim();
  try {
    if (linkedFileName) localStorage.setItem('nomina_pro_linked_name', linkedFileName);
    else localStorage.removeItem('nomina_pro_linked_name');
  } catch (_) {}
  updateFileStatus();
}

function updateFileStatus() {
  const el = document.getElementById('file-status');
  const btn = document.getElementById('btn-save-file');
  if (!el) return;
  if (fileHandle && fileHandle.name) {
    el.textContent = '📄 ' + fileHandle.name;
    el.classList.remove('hidden');
    el.title = 'Guardar sobrescribe este archivo en el dispositivo';
    if (btn) btn.title = 'Guardar cambios en ' + fileHandle.name;
  } else if (linkedFileName) {
    el.textContent = '📄 ' + linkedFileName;
    el.classList.remove('hidden');
    el.title = supportsFSAccess()
      ? 'Archivo recordado. Usa Abrir y elige este archivo para poder sobrescribirlo.'
      : 'Al Guardar se descargará con este mismo nombre (elige Reemplazar si el sistema lo pide).';
    if (btn) btn.title = 'Guardar como ' + linkedFileName;
  } else {
    el.classList.add('hidden');
    el.textContent = '';
    if (btn) btn.title = 'Guardar archivo de trabajo';
  }
}

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistHandle(handle) {
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(handle, 'working');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('No se pudo recordar el archivo', e);
  }
}

async function clearPersistedHandle() {
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete('working');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (_) {}
}

async function restoreHandle() {
  if (!supportsFSAccess()) return;
  try {
    const db = await openIdb();
    const handle = await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get('working');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!handle) return;
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'prompt') {
      perm = await handle.requestPermission({ mode: 'readwrite' });
    }
    if (perm === 'granted') {
      fileHandle = handle;
      setLinkedName(handle.name);
      updateFileStatus();
    }
  } catch (e) {
    console.warn('No se restauró el archivo vinculado', e);
  }
}

async function writeToHandle(handle) {
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

function downloadJsonWithName(filename) {
  let name = (filename || linkedFileName || `nomina_${new Date().toISOString().slice(0, 10)}`).trim();
  name = name.replace(/[\\/:*?"<>|]/g, '_');
  if (!name.toLowerCase().endsWith('.json')) name += '.json';
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  setLinkedName(name);
  return name;
}

async function saveWorkingFile() {
  try {
    saveData();

    // 1) Same linked handle (true overwrite)
    if (fileHandle) {
      try {
        let perm = await fileHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          perm = await fileHandle.requestPermission({ mode: 'readwrite' });
        }
        if (perm === 'granted') {
          await writeToHandle(fileHandle);
          setLinkedName(fileHandle.name);
          toast('Guardado en ' + fileHandle.name, 'success');
          return;
        }
      } catch (err) {
        console.warn('Handle inválido, se pedirá de nuevo', err);
        fileHandle = null;
        await clearPersistedHandle();
      }
    }

    // 2) File System Access: pick existing file to overwrite OR create
    if (supportsFSAccess()) {
      const useExisting = linkedFileName
        ? confirm(
            '¿Sobrescribir el archivo «' + linkedFileName + '»?\n\n' +
            'Aceptar: elige ESE mismo archivo en el diálogo (para reemplazarlo).\n' +
            'Cancelar: crear / elegir otro archivo.'
          )
        : false;

      if (useExisting) {
        try {
          const [handle] = await window.showOpenFilePicker({
            multiple: false,
            types: [{ description: 'JSON Nómina Pro', accept: { 'application/json': ['.json'] } }]
          });
          let perm = await handle.queryPermission({ mode: 'readwrite' });
          if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
          if (perm !== 'granted') {
            toast('Sin permiso de escritura sobre ese archivo', 'error');
            return;
          }
          fileHandle = handle;
          await writeToHandle(handle);
          await persistHandle(handle);
          setLinkedName(handle.name);
          toast('Guardado en ' + handle.name, 'success');
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
          throw e;
        }
      }

      const def = linkedFileName || `nomina_${new Date().toISOString().slice(0, 10)}.json`;
      fileHandle = await window.showSaveFilePicker({
        suggestedName: def,
        types: [{ description: 'JSON Nómina Pro', accept: { 'application/json': ['.json'] } }]
      });
      await writeToHandle(fileHandle);
      await persistHandle(fileHandle);
      setLinkedName(fileHandle.name);
      toast('Guardado en ' + fileHandle.name, 'success');
      return;
    }

    // 3) Fallback (Android / HTTP / Safari): download with SAME name
    const name = downloadJsonWithName(linkedFileName);
    toast(
      'Descargado como «' + name + '». Si ya existe, elige Reemplazar. ' +
      (isSecureCtx() ? '' : 'Tip: con HTTPS el Guardar puede sobrescribir sin descargar de más.'),
      'success'
    );
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    console.error(e);
    toast('No se pudo guardar el archivo', 'error');
  }
}

async function openWorkingFile() {
  try {
    if (supportsFSAccess()) {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'JSON Nómina Pro', accept: { 'application/json': ['.json'] } }]
      });
      let perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        perm = await handle.requestPermission({ mode: 'readwrite' });
      }
      const file = await handle.getFile();
      const text = await file.text();
      let imp;
      try {
        imp = JSON.parse(text);
      } catch {
        toast('El archivo no es un JSON válido', 'error');
        return;
      }
      if (!imp.companies || !Array.isArray(imp.companies)) {
        toast('Archivo inválido: no contiene empresas', 'error');
        return;
      }
      if (data.companies.length && !confirm('¿Reemplazar los datos actuales con el contenido de «' + file.name + '»?')) {
        return;
      }
      data = normalizeData(imp);
      saveData();
      setLinkedName(file.name);
      if (perm === 'granted') {
        fileHandle = handle;
        await persistHandle(handle);
        toast('Vinculado: ' + file.name + ' — Guardar escribirá en este archivo', 'success');
      } else {
        fileHandle = null;
        await clearPersistedHandle();
        toast('Cargado: ' + file.name + ' (sin permiso de escritura; al Guardar podrás elegirlo de nuevo)', 'default');
      }
      updateFileStatus();
      goHome();
      return;
    }

    // Fallback: classic file input
    document.getElementById('importFile').click();
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    console.error(e);
    toast('No se pudo abrir el archivo', 'error');
  }
}

function exportData() {
  const def = (linkedFileName || `nomina_${new Date().toISOString().slice(0, 10)}`).replace(/\.json$/i, '');
  const input = document.getElementById('export-filename');
  if (input) {
    input.value = def;
    document.getElementById('modal-export').classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
    return;
  }
  doExport(def);
}

function doExport(name) {
  const saved = downloadJsonWithName(name);
  closeModal('modal-export');
  toast('Copia descargada: ' + saved, 'success');
}

function confirmExport() {
  const input = document.getElementById('export-filename');
  doExport(input ? input.value : '');
}

function importData(ev) {
  const f = ev.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = (e) => {
    try {
      const imp = JSON.parse(e.target.result);
      if (!imp.companies || !Array.isArray(imp.companies)) {
        toast('Archivo inválido', 'error');
        return;
      }
      if (confirm('¿Reemplazar todos los datos actuales con el archivo importado?')) {
        data = normalizeData(imp);
        saveData();
        fileHandle = null;
        clearPersistedHandle();
        setLinkedName(f.name);
        // Important: classic <input type=file> cannot write back to the same path.
        toast(
          'Cargado: ' + f.name + '. Usa Abrir (no Importar) en Chrome con HTTPS para Guardar encima del mismo archivo.',
          'success'
        );
        goHome();
      }
    } catch {
      toast('Error al leer el archivo JSON', 'error');
    }
  };
  r.readAsText(f);
  ev.target.value = '';
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document
      .querySelectorAll('.modal-overlay:not(.hidden)')
      .forEach((m) => m.classList.add('hidden'));
  }
});

/* Init */
loadData();
renderCompanies();
updateFileStatus();
restoreHandle().then(() => updateFileStatus());
