/*
 * Helpers compartidos por todas las páginas: cliente Supabase, sesión,
 * perfil del usuario, navegación, formato de fechas/montos, comprobantes.
 * Todos los textos pasan por t() (js/i18n.js).
 */

// Se guarda antes de crear el cliente, que limpia el hash al leer la sesión
// (lo usa login.js para detectar links de invitación / recuperación).
const INITIAL_HASH = location.hash;

/*
 * "Recordarme": con la opción activa (por defecto) la sesión se guarda en
 * localStorage y sobrevive al cierre del navegador; sin ella va a
 * sessionStorage y se pierde al cerrarlo. La preferencia se lee en cada
 * acceso, así que login.js puede cambiarla justo antes de ingresar.
 */
const REMEMBER_KEY = "ikmf_remember";
const REMEMBER_EMAIL_KEY = "ikmf_remember_email";

function safeStore(kind) {
  try { return window[kind]; } catch { return null; }
}

function rememberMe() {
  const ls = safeStore("localStorage");
  try { return !ls || ls.getItem(REMEMBER_KEY) !== "0"; } catch { return true; }
}

function setRememberMe(on, email) {
  const ls = safeStore("localStorage");
  if (!ls) return;
  try {
    ls.setItem(REMEMBER_KEY, on ? "1" : "0");
    if (on && email) ls.setItem(REMEMBER_EMAIL_KEY, email);
    else ls.removeItem(REMEMBER_EMAIL_KEY);
  } catch { /* sin storage */ }
}

function rememberedEmail() {
  try { return safeStore("localStorage")?.getItem(REMEMBER_EMAIL_KEY) || ""; } catch { return ""; }
}

const authStorage = {
  getItem(key) {
    for (const kind of ["localStorage", "sessionStorage"]) {
      try { const v = safeStore(kind)?.getItem(key); if (v != null) return v; } catch { /* sin storage */ }
    }
    return null;
  },
  setItem(key, value) {
    const [keep, drop] = rememberMe() ? ["localStorage", "sessionStorage"] : ["sessionStorage", "localStorage"];
    try { safeStore(keep)?.setItem(key, value); } catch { /* sin storage */ }
    try { safeStore(drop)?.removeItem(key); } catch { /* sin storage */ }
  },
  removeItem(key) {
    for (const kind of ["localStorage", "sessionStorage"]) {
      try { safeStore(kind)?.removeItem(key); } catch { /* sin storage */ }
    }
  },
};

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: authStorage },
});

// Se guarda la clave en payments.method; los valores viejos en español se mapean.
const PAYMENT_METHODS = ["transfer", "deposit", "mercadopago", "paypal", "cash", "other"];
const LEGACY_METHODS = {
  Transferencia: "transfer",
  "Depósito": "deposit",
  "Mercado Pago": "mercadopago",
  PayPal: "paypal",
  Efectivo: "cash",
  Otro: "other",
};
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

let ME = null; // { ...profile, country }

/* ---------- Sesión / perfil ---------- */

async function loadMe() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb
    .from("profiles")
    .select("*, country:countries(*)")
    .eq("id", session.user.id)
    .single();
  if (error) throw error;
  ME = data;
  return ME;
}

/*
 * Llamar al principio de cada página protegida. Si no hay sesión manda
 * al login; si el rol no alcanza, manda a la página que le corresponde.
 */
async function requireRole(roles) {
  applyI18n();
  let me;
  try {
    me = await loadMe();
  } catch (e) {
    await sb.auth.signOut();
    location.href = "index.html";
    return null;
  }
  if (!me) {
    location.href = "index.html";
    return null;
  }
  if (roles && !roles.includes(me.role)) {
    location.href = homeFor(me);
    return null;
  }
  renderTopbar();
  return me;
}

// Página de inicio según el rol: admin y director entran al dashboard.
function homeFor(profile) {
  return profile.role === "instructor" ? "instructor.html" : "dashboard.html";
}

async function signOut() {
  await sb.auth.signOut();
  location.href = "index.html";
}

// Versión publicada: se muestra al pie para saber qué versión cargó el navegador.
const APP_VERSION = "2026.11.17d";

function renderVersionFooter() {
  const f = document.createElement("footer");
  f.className = "app-version";
  f.textContent = `IKMF Pagos · v${APP_VERSION}`;
  document.body.appendChild(f);
}

function renderTopbar() {
  const page = document.body.dataset.page;
  const links = [];
  if (ME.role === "admin" || ME.role === "director") links.push({ href: "dashboard.html", key: "dashboard", label: t("nav.dashboard") });
  links.push({ href: "instructor.html", key: "instructor", label: t("nav.my_payments") });
  if (ME.role === "director" || ME.role === "admin") {
    links.push({ href: "director.html", key: "director", label: t(ME.role === "admin" ? "nav.countries" : "nav.my_country") });
  }
  if (ME.role === "admin") links.push({ href: "admin.html", key: "admin", label: t("nav.admin") });
  links.push({ href: "settings.html", key: "settings", label: t("nav.settings") });

  const bar = document.createElement("header");
  bar.className = "topbar";
  bar.innerHTML = `
    <div class="topbar-inner">
      <div class="brand"><span class="brand-mark">IK</span> ${esc(t("app.name"))}</div>
      <nav class="nav">
        ${links.map((l) => `<a href="${l.href}" class="${l.key === page ? "active" : ""}">${esc(l.label)}</a>`).join("")}
      </nav>
      <div class="user-box">
        <span>${esc(ME.full_name || ME.email)} · ${esc(roleLabel(ME.role))}${ME.country ? " · " + esc(ME.country.name) : ""}</span>
        ${langSelectHTML("topbar-lang")}
        <button type="button" id="logout-btn">${esc(t("nav.logout"))}</button>
      </div>
    </div>`;
  document.body.prepend(bar);
  renderVersionFooter();
  bar.querySelector("#logout-btn").addEventListener("click", signOut);
  bindLangSelect(bar.querySelector("#topbar-lang"));
}

/* ---------- Datos ---------- */

// PostgREST devuelve como máximo 1000 filas por pedido: se pagina.
async function fetchAll(query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// Suma de montos agrupada por moneda → "25.000 ARS · 1.500 UYU".
function sumByCurrency(items) {
  const totals = {};
  items.forEach(({ amount, currency }) => { totals[currency] = (totals[currency] || 0) + Number(amount); });
  const parts = Object.entries(totals).map(([cur, v]) => fmtMoney(v, cur));
  return parts.length ? parts.join(" · ") : "—";
}

/* ---------- Etiquetas ---------- */

function roleLabel(role) {
  return t(`role.${role}`);
}

function statusLabel(status) {
  return t(`status.${status}`);
}

function methodLabel(method) {
  if (!method) return "—";
  const key = PAYMENT_METHODS.includes(method) ? method : LEGACY_METHODS[method];
  return key ? t(`method.${key}`) : method;
}

function methodOptions(selected) {
  const sel = LEGACY_METHODS[selected] || selected;
  return PAYMENT_METHODS
    .map((m) => `<option value="${m}" ${m === sel ? "selected" : ""}>${esc(t(`method.${m}`))}</option>`)
    .join("");
}

/* ---------- Fechas ---------- */

// Los períodos se guardan como "YYYY-MM-01".
function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function addMonths(period, n) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/*
 * Opciones del selector de mes (valor "YYYY-MM"): de 12 meses atrás a 3
 * adelante respecto de hoy, ampliado para incluir siempre el mes elegido.
 */
function monthSelectOptions(selected) {
  const now = currentPeriod();
  let from = addMonths(now, -12);
  let to = addMonths(now, 3);
  if (selected < from) from = selected;
  if (selected > to) to = selected;
  return periodsBetween(from, to)
    .map((p) => `<option value="${p.slice(0, 7)}" ${p === selected ? "selected" : ""}>${esc(fmtPeriod(p))}</option>`)
    .join("");
}

// Lista de períodos desde `from` hasta `to` inclusive, del más nuevo al más viejo.
function periodsBetween(from, to) {
  const out = [];
  for (let p = to; p >= from; p = addMonths(p, -1)) out.push(p);
  return out;
}

function fmtPeriod(period) {
  const [y, m] = period.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString(currentLocale(), { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(iso + "T00:00:00") : new Date(iso);
  return d.toLocaleDateString(currentLocale(), { day: "2-digit", month: "2-digit", year: "numeric" });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ---------- Montos ---------- */

function fmtMoney(amount, currency) {
  if (amount === null || amount === undefined || amount === "") return "—";
  try {
    return new Intl.NumberFormat(currentLocale(), { style: "currency", currency: currency || "USD" }).format(amount);
  } catch {
    return `${Number(amount).toFixed(2)} ${currency || ""}`;
  }
}

// Cuota que le corresponde a un instructor: la propia o la por defecto del país.
function feeFor(profile, country) {
  if (profile.monthly_fee !== null && profile.monthly_fee !== undefined) return Number(profile.monthly_fee);
  return country ? Number(country.default_fee) : 0;
}

/* ---------- Vigencia de 30 días ---------- */

// Cada pago aprobado cubre un mes desde su fecha de pago (paid_on): un pago
// del 30/10 está vigente hasta el 30/11 (mismo día del mes siguiente; si ese
// mes no tiene ese día, el último día del mes: 31/01 → 28/02).

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Último día de vigencia de un pago hecho en la fecha `iso`.
function coverageUntil(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(y, m + 1, 0).getDate(); // último día del mes siguiente
  const dt = new Date(y, m, Math.min(d, last));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function validUntil(pay) {
  return coverageUntil(pay.paid_on);
}

// Fechas de pago aprobadas por persona (cada página las registra al cargar).
const APPROVED_INDEX = new Map();
// Último mes con un pago cargado (aprobado o en revisión) por persona.
const LAST_PAID_PERIOD = new Map();

function registerPayments(list) {
  APPROVED_INDEX.clear();
  LAST_PAID_PERIOD.clear();
  (list || []).forEach((p) => {
    if (p.status !== "rejected") {
      const prev = LAST_PAID_PERIOD.get(p.instructor_id);
      if (!prev || p.period > prev) LAST_PAID_PERIOD.set(p.instructor_id, p.period);
    }
    if (p.status !== "approved" || !p.paid_on) return;
    if (!APPROVED_INDEX.has(p.instructor_id)) APPROVED_INDEX.set(p.instructor_id, []);
    APPROVED_INDEX.get(p.instructor_id).push(p.paid_on);
  });
}

// ¿La persona tiene un pago aprobado vigente en la fecha `iso`?
function coveredOn(personId, iso) {
  return (APPROVED_INDEX.get(personId) || []).some((d) => d <= iso && iso <= coverageUntil(d));
}

// Hasta cuándo está cubierta la persona (null si nunca pagó).
function coverageEnd(personId) {
  const list = APPROVED_INDEX.get(personId) || [];
  return list.length ? list.map(coverageUntil).sort().pop() : null;
}

// Día con el que se evalúa un mes: hoy para el mes en curso, el último día
// para los meses pasados y el primero para los futuros.
function referenceDate(period) {
  const now = currentPeriod();
  if (period === now) return todayISO();
  if (period < now) return addDays(addMonths(period, 1), -1);
  return period;
}

// ¿Ese mes está saldado? Tiene su pago (aprobado o en revisión) o la
// persona está cubierta por un pago vigente en la fecha de referencia.
function monthSettled(personId, period, payment) {
  if (payment && payment.status !== "rejected") return true;
  return coveredOn(personId, referenceDate(period));
}

// ¿Está al día en ese mes por un pago aprobado propio o por la vigencia
// de un pago anterior? (cuenta como "Aprobado" en los totales)
function monthApproved(personId, period, payment) {
  if (payment && payment.status === "approved") return true;
  if (payment && payment.status === "pending") return false;
  return coveredOn(personId, referenceDate(period));
}

/*
 * Estado de un mes para un instructor. `payment` puede ser undefined.
 * Sin pago propio pero cubierto por la vigencia de 30 días → "Cubierto".
 * Si no, cuenta como deuda, salvo el mes en curso ("A pagar").
 */
function monthStatus(payment, period, personId) {
  if (payment) return payment.status;
  if (personId && coveredOn(personId, referenceDate(period))) return "covered";
  return period >= currentPeriod() ? "upcoming" : "due";
}

function chip(status) {
  return `<span class="chip ${status}">${esc(statusLabel(status))}</span>`;
}

// Estado de la cuenta: activa, pendiente de activación (se registró sola) o de baja.
function accountState(profile) {
  if (profile.end_month) return "left";
  return profile.active ? "active" : "pending";
}

function accountChip(profile) {
  const st = accountState(profile);
  const cls = { active: "approved", pending: "pending", left: "inactive" }[st];
  const text = st === "left"
    ? t("account.left_since", { month: fmtPeriod(addMonths(profile.end_month, 1)) })
    : t(`account.${st}`);
  return `<span class="chip ${cls}">${esc(text)}</span>`;
}

/* ---------- Regiones y primer mes de cobro por país ---------- */

const REGIONS = ["latam", "north_america", "europe", "asia", "africa", "oceania"];

function regionLabel(region) {
  return t(region ? `region.${region}` : "region.none");
}

// Países conocidos por la página (cada página los registra al cargarlos),
// para aplicar el primer mes de cobro de cada país.
const COUNTRY_INDEX = new Map();
function registerCountries(list) {
  (list || []).forEach((c) => { if (c) COUNTRY_INDEX.set(c.id, c); });
}

// Primer mes que se le cobra a alguien: su propio inicio, pero nunca antes
// del primer mes de cobro de su país (ej. Argentina desde noviembre 2026).
function startMonthFor(p) {
  const c = COUNTRY_INDEX.get(p.country_id) || (p.country && p.country.id === p.country_id ? p.country : null);
  const first = c && c.first_month;
  return first && first > p.start_month ? first : p.start_month;
}

/*
 * Opciones del filtro "Todos / región / país". Valores: "" (todos),
 * "r:<región>" o el id del país. Los países van agrupados por región.
 */
function regionCountryOptions(countries, selected, extra = []) {
  const opt = (value, label) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`;
  const used = REGIONS.filter((r) => countries.some((c) => c.region === r));
  let html = opt("", t("adm.all_countries")) + extra.map(([v, l]) => opt(v, l)).join("");
  if (used.length) {
    html += `<optgroup label="${esc(t("region.group"))}">${used.map((r) => opt(`r:${r}`, regionLabel(r))).join("")}</optgroup>`;
  }
  [...REGIONS, null].forEach((r) => {
    const list = countries.filter((c) => (c.region || null) === r);
    if (list.length) html += `<optgroup label="${esc(regionLabel(r))}">${list.map((c) => opt(c.id, c.name)).join("")}</optgroup>`;
  });
  return html;
}

// ¿El país `c` entra en el filtro ("" todos · "r:<región>" · id de país)?
function countryMatchesFilter(c, filter) {
  if (!filter) return true;
  if (!c) return false;
  if (filter.startsWith("r:")) return c.region === filter.slice(2);
  return c.id === filter;
}

// ¿Se le cobra `period` a esta persona? (alta, no pendiente, no de baja para ese mes)
function billable(p, period) {
  if (startMonthFor(p) > period) return false;
  if (p.end_month) return period <= p.end_month;
  return p.active;
}

/*
 * Meses vencidos (anteriores al actual) sin pago aprobado ni en revisión.
 * `paymentOf(personId, period)` devuelve el pago de ese mes, si hay.
 */
/*
 * Meses vencidos (anteriores al actual) sin saldar. Solo cuentan los meses
 * posteriores al último pago cargado: quien acaba de pagar está al día y no
 * arrastra meses viejos.
 */
function dueMonthsFor(p, paymentOf) {
  if (!p.active && !p.end_month) return []; // pendiente de activación
  let last = addMonths(currentPeriod(), -1);
  if (p.end_month && p.end_month < last) last = p.end_month;
  let start = startMonthFor(p);
  const lastPaid = LAST_PAID_PERIOD.get(p.id);
  if (lastPaid && addMonths(lastPaid, 1) > start) start = addMonths(lastPaid, 1);
  if (start > last) return [];
  return periodsBetween(start, last).filter((period) => !monthSettled(p.id, period, paymentOf(p.id, period)));
}

/* ---------- Comprobantes ---------- */

/*
 * Selector de archivo traducido. El <input type="file"> nativo muestra su
 * botón en el idioma del navegador; acá se oculta y se usa un botón propio
 * con t(). El input sigue con el mismo id, así que .files funciona igual.
 */
function fileField(id, { multiple } = {}) {
  return `<label class="file-pick">
    <input id="${id}" type="file" accept="image/*,application/pdf" ${multiple ? "multiple" : ""} />
    <span class="btn ghost sm">${esc(t("file.choose"))}</span>
    <span class="file-name">${esc(t("file.none"))}</span>
  </label>`;
}

document.addEventListener("change", (e) => {
  const input = e.target;
  if (!input.matches || !input.matches(".file-pick input[type=file]")) return;
  const name = input.closest(".file-pick").querySelector(".file-name");
  const files = input.files ? [...input.files] : [];
  name.textContent = files.length > 1 ? t("file.many", { n: files.length, names: files.map((f) => f.name).join(", ") })
    : files.length ? files[0].name : t("file.none");
  name.classList.toggle("chosen", files.length > 0);
});

function validateReceipt(file) {
  if (!file) return t("receipt.err_missing");
  if (file.size > MAX_RECEIPT_BYTES) return t("receipt.err_size");
  if (file.type && !RECEIPT_TYPES.includes(file.type)) return t("receipt.err_type");
  return null;
}

async function uploadReceipt(instructorId, period, file) {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${instructorId}/${period}-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from("receipts").upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

// Comprobantes de un pago grupal: carpeta g-<grupo>/.
async function uploadGroupReceipt(groupId, file, i) {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `g-${groupId}/${Date.now()}-${i + 1}.${ext}`;
  const { error } = await sb.storage.from("receipts").upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

// Visor de varios comprobantes: botones 1, 2, 3… y el comprobante elegido.
function renderReceipts(container, paths) {
  if (!paths || paths.length < 2) return renderReceipt(container, paths && paths[0]);
  container.innerHTML = `<div class="receipt-tabs">${paths.map((_, i) =>
    `<button type="button" class="btn ghost sm ${i ? "" : "active"}" data-receipt-i="${i}">${esc(t("grp.receipt_n", { n: i + 1 }))}</button>`).join("")}</div>
    <div class="receipt-view"></div>`;
  const view = container.querySelector(".receipt-view");
  container.querySelectorAll("[data-receipt-i]").forEach((b) => b.addEventListener("click", () => {
    container.querySelectorAll("[data-receipt-i]").forEach((x) => x.classList.toggle("active", x === b));
    renderReceipt(view, paths[Number(b.dataset.receiptI)]);
  }));
  renderReceipt(view, paths[0]);
}

async function receiptUrl(path) {
  const { data, error } = await sb.storage.from("receipts").createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}

async function openReceipt(path) {
  try {
    window.open(await receiptUrl(path), "_blank", "noopener");
  } catch (e) {
    toast(errMsg(e), true);
  }
}

// Renderiza el comprobante dentro de un contenedor (imagen o PDF).
async function renderReceipt(container, path) {
  if (!path) {
    container.innerHTML = `<p class="empty">${esc(t("receipt.none"))}</p>`;
    return;
  }
  container.innerHTML = `<p class="empty">${esc(t("receipt.loading"))}</p>`;
  try {
    const url = await receiptUrl(path);
    if (/\.pdf$/i.test(path)) {
      container.innerHTML = `<iframe src="${url}" title="${esc(t("receipt.alt"))}"></iframe>`;
    } else if (/\.heic$/i.test(path)) {
      container.innerHTML = `<p class="empty">HEIC: <a href="${url}" target="_blank" rel="noopener">${esc(t("receipt.download"))}</a></p>`;
    } else {
      container.innerHTML = `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(t("receipt.alt"))}" /></a>`;
    }
  } catch (e) {
    container.innerHTML = `<p class="empty">${esc(t("receipt.error", { msg: errMsg(e) }))}</p>`;
  }
}

/* ---------- Endpoints del servidor (api/*.php) ---------- */

async function callFunction(name, body) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`api/${name}.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.code = data.code;
    throw err;
  }
  return data;
}

/* ---------- Alta / edición / baja de usuarios ---------- */

/*
 * Formulario de alta o edición de un usuario (instructor o director).
 *   user       → perfil a editar; sin user es un alta.
 *   roles      → roles elegibles (ej. ["instructor", "director"]); null = solo instructor.
 *   countries  → lista de países elegibles; null = el país queda fijo (director).
 *   country    → país fijo / por defecto (para la cuota por defecto y la moneda).
 *   onSaved(result)
 */
function openUserForm({ user, roles, countries, country, onSaved }) {
  const isNew = !user;
  const roleList = roles || ["instructor"];
  const currentCountry = user ? user.country_id : country ? country.id : "";
  const countryFee = (id) => {
    const c = (countries || []).find((x) => x.id === id) || country;
    return c ? `${c.default_fee} ${c.currency}` : "";
  };

  const { el, close } = openModal(isNew ? t("user.new") : t("user.edit_title", { name: user.full_name || user.email }), `
    <form id="u-form" novalidate>
      <div class="grid-2">
        <div class="field">
          <label for="uf-name">${esc(t("common.name"))}</label>
          <input class="input" id="uf-name" value="${esc(user ? user.full_name : "")}" />
        </div>
        <div class="field">
          <label for="uf-email">${esc(t("common.email"))}</label>
          <input class="input" id="uf-email" type="email" dir="ltr" value="${esc(user ? user.email : "")}" />
        </div>
        <div class="field">
          <label for="uf-phone">${esc(t("common.phone"))}</label>
          <input class="input" id="uf-phone" type="tel" dir="ltr" value="${esc(user ? user.phone : "")}" />
        </div>
        ${roleList.length > 1 ? `
        <div class="field">
          <label for="uf-role">${esc(t("common.role"))}</label>
          <select class="input" id="uf-role">
            ${roleList.map((r) => `<option value="${r}" ${user && user.role === r ? "selected" : ""}>${esc(roleLabel(r))}</option>`).join("")}
          </select>
        </div>` : ""}
        ${countries ? `
        <div class="field">
          <label for="uf-country">${esc(t("common.country"))}</label>
          <select class="input" id="uf-country">
            <option value="">${esc(t("common.choose"))}</option>
            ${countries.map((c) => `<option value="${c.id}" ${c.id === currentCountry ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
          </select>
        </div>` : ""}
        <div class="field">
          <label for="uf-fee">${esc(t("user.own_fee"))}</label>
          <input class="input" id="uf-fee" type="number" min="0" step="0.01" value="${user && user.monthly_fee !== null ? user.monthly_fee : ""}" placeholder="${esc(countryFee(currentCountry))}" />
        </div>
        <div class="field">
          <label for="uf-start">${esc(t("user.start"))}</label>
          <input class="input" id="uf-start" type="month" value="${(user ? user.start_month : currentPeriod()).slice(0, 7)}" />
        </div>
      </div>
      ${isNew ? `
      <div class="field">
        <label for="uf-password">${esc(t("user.password"))}</label>
        <input class="input" id="uf-password" type="text" autocomplete="off" placeholder="${esc(t("user.password_ph"))}" />
      </div>` : ""}
      <div id="uf-error"></div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" id="uf-cancel">${esc(t("common.cancel"))}</button>
        <button type="submit" class="btn primary" id="uf-submit">${esc(t(isNew ? "common.create" : "common.save_changes"))}</button>
      </div>
    </form>`);

  const countrySel = el.querySelector("#uf-country");
  if (countrySel) {
    countrySel.addEventListener("change", () => { el.querySelector("#uf-fee").placeholder = countryFee(countrySel.value); });
  }
  el.querySelector("#uf-cancel").addEventListener("click", close);
  el.querySelector("#u-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const val = (id) => { const x = el.querySelector(id); return x ? x.value.trim() : undefined; };
    const data = {
      full_name: val("#uf-name"),
      email: val("#uf-email"),
      phone: val("#uf-phone"),
      monthly_fee: val("#uf-fee"),
      start_month: val("#uf-start") ? `${val("#uf-start")}-01` : undefined,
    };
    if (roleList.length > 1) data.role = val("#uf-role");
    else if (isNew) data.role = roleList[0];
    if (countries) data.country_id = val("#uf-country");
    else if (isNew && country) data.country_id = country.id;
    if (isNew && val("#uf-password")) data.password = val("#uf-password");

    const errBox = el.querySelector("#uf-error");
    const showErr = (m) => { errBox.innerHTML = `<div class="banner error">${esc(m)}</div>`; };
    errBox.innerHTML = "";
    if (!data.full_name) return showErr(t("user.err_name"));
    if (!data.email) return showErr(t("user.err_email"));
    if (countries && !data.country_id) return showErr(t("user.err_country"));

    const btn = el.querySelector("#uf-submit");
    btn.disabled = true;
    try {
      const result = await callFunction("manage-user", isNew
        ? { action: "create", data }
        : { action: "update", userId: user.id, data });
      close();
      toast(isNew ? t(result.invited ? "user.created_invited" : "user.created") : t("user.saved"));
      if (onSaved) await onSaved(result);
    } catch (err) {
      showErr(errMsg(err));
      btn.disabled = false;
    }
  });
}

// Baja: elige el último mes que se le cobra. Conserva todo su historial.
function openDeactivateForm(user, onDone) {
  const options = periodsBetween(user.start_month, addMonths(currentPeriod(), 2));
  const { el, close } = openModal(t("user.deactivate_title", { name: user.full_name || user.email }), `
    <p>${esc(t("user.deactivate_text"))}</p>
    <div class="field">
      <label for="d-month">${esc(t("user.last_month"))}</label>
      <select class="input" id="d-month">
        ${options.map((p) => `<option value="${p}" ${p === currentPeriod() ? "selected" : ""}>${fmtPeriod(p)}</option>`).join("")}
      </select>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn ghost" id="d-cancel">${esc(t("common.cancel"))}</button>
      <button type="button" class="btn danger" id="d-ok">${esc(t("user.deactivate"))}</button>
    </div>`);
  el.querySelector("#d-cancel").addEventListener("click", close);
  el.querySelector("#d-ok").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await callFunction("manage-user", { action: "deactivate", userId: user.id, data: { end_month: el.querySelector("#d-month").value } });
      close();
      toast(t("user.deactivated"));
      if (onDone) await onDone();
    } catch (err) {
      toast(errMsg(err), true);
      e.target.disabled = false;
    }
  });
}

async function reactivateUser(user, onDone) {
  const name = user.full_name || user.email;
  if (!confirm(t(user.end_month ? "user.confirm_reactivate" : "user.confirm_activate", { name }))) return;
  try {
    await callFunction("manage-user", { action: "reactivate", userId: user.id });
    toast(t("user.activated"));
    if (onDone) await onDone();
  } catch (err) {
    toast(errMsg(err), true);
  }
}

// Reenvía el acceso: la invitación si nunca la aceptó, o un link para
// elegir nueva contraseña si ya tenía cuenta.
async function resendAccess(user) {
  if (!confirm(t("user.resend_confirm", { email: user.email }))) return;
  try {
    const r = await callFunction("manage-user", { action: "resend", userId: user.id });
    if (r.link) return showAccessLink(r);
    toast(t(r.sent === "invite" ? "user.resend_done_invite" : "user.resend_done_reset", { email: r.email }));
  } catch (err) {
    toast(errMsg(err), true);
  }
}

// Link de acceso de un solo uso (solo admins): para copiarlo o mandarlo por
// WhatsApp cuando el email no llega.
function showAccessLink(r) {
  const status = r.sent
    ? `<div class="banner ok">${esc(t(r.sent === "invite" ? "user.resend_done_invite" : "user.resend_done_reset", { email: r.email }))}</div>`
    : `<div class="banner warn">${esc(t("user.email_failed", { msg: r.email_error || "" }))}</div>`;
  const wa = `https://wa.me/?text=${encodeURIComponent(t("user.wa_text", { link: r.link }))}`;
  const { el } = openModal(t("user.link_title", { email: r.email }), `
    ${status}
    <p>${esc(t("user.link_text"))}</p>
    <div class="field"><input class="input" id="al-link" dir="ltr" readonly value="${esc(r.link)}" /></div>
    <div class="modal-foot" style="justify-content:flex-start">
      <button type="button" class="btn primary" id="al-copy">${esc(t("user.copy"))}</button>
      <a class="btn success" href="${esc(wa)}" target="_blank" rel="noopener">${esc(t("user.whatsapp"))}</a>
    </div>`);
  el.querySelector("#al-copy").addEventListener("click", async () => {
    const input = el.querySelector("#al-link");
    try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand("copy"); }
    toast(t("user.copied"));
  });
}

// Contraseña aleatoria legible (sin caracteres que se confundan).
function randomPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

// (Solo admins) Definir la contraseña de otro usuario y compartirla.
function openSetPassword(user) {
  const { el, close } = openModal(t("user.pw_title", { name: user.full_name || user.email }), `
    <p>${esc(t("user.pw_text"))}</p>
    <div class="field">
      <label for="sp-pass">${esc(t("user.pw_label"))}</label>
      <div class="row" style="flex-wrap:nowrap">
        <input class="input" id="sp-pass" type="text" dir="ltr" autocomplete="off" minlength="8" value="${randomPassword()}" />
        <button type="button" class="btn ghost sm" id="sp-gen">${esc(t("user.pw_generate"))}</button>
      </div>
    </div>
    <div id="sp-done"></div>
    <div class="modal-foot">
      <button type="button" class="btn ghost" id="sp-cancel">${esc(t("common.cancel"))}</button>
      <button type="button" class="btn primary" id="sp-save">${esc(t("common.save"))}</button>
    </div>`);
  el.querySelector("#sp-gen").addEventListener("click", () => { el.querySelector("#sp-pass").value = randomPassword(); });
  el.querySelector("#sp-cancel").addEventListener("click", close);
  el.querySelector("#sp-save").addEventListener("click", async (e) => {
    const password = el.querySelector("#sp-pass").value.trim();
    if (password.length < 8) return toast(t("login.err_password"), true);
    e.target.disabled = true;
    try {
      await callFunction("manage-user", { action: "set_password", userId: user.id, data: { password } });
      const text = t("user.pw_share", { url: location.origin, email: user.email, password });
      const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
      el.querySelector("#sp-pass").readOnly = true;
      el.querySelector("#sp-gen").remove();
      el.querySelector("#sp-done").innerHTML = `<div class="banner ok">${esc(t("user.pw_saved"))}</div>`;
      el.querySelector(".modal-foot").innerHTML = `
        <button type="button" class="btn primary" id="sp-copy">${esc(t("user.copy_access"))}</button>
        <a class="btn success" href="${esc(wa)}" target="_blank" rel="noopener">${esc(t("user.whatsapp"))}</a>
        <button type="button" class="btn ghost" id="sp-close">${esc(t("common.close"))}</button>`;
      el.querySelector("#sp-close").addEventListener("click", close);
      el.querySelector("#sp-copy").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(text); toast(t("user.copied")); } catch { toast(text); }
      });
    } catch (err) {
      toast(errMsg(err), true);
      e.target.disabled = false;
    }
  });
}

/* ---------- Revisión de un pago ---------- */

// Nombre del instructor como link: al tocarlo se abre la ficha del pago con
// el comprobante (la abre el handler de data-review de cada página).
// Pago cargado por otra persona (director o admin), no por el propio instructor.
function isThirdParty(pay) {
  return !!(pay && pay.created_by && pay.created_by !== pay.instructor_id);
}

// Obleas de un pago: "Grupal" y "Pago por tercero".
function payTags(pay) {
  if (!pay) return "";
  return (pay.group_id ? ` <span class="chip group" title="${esc(t("grp.tag_title"))}">${esc(t("grp.tag"))}</span>` : "")
    + (isThirdParty(pay) ? ` <span class="chip third" title="${esc(t("tp.tag_title"))}">${esc(t("tp.tag"))}</span>` : "");
}

function payNameLink(name, pay) {
  const clip = (pay.receipt_path ? ` <span class="clip" aria-hidden="true">📎</span>` : "")
    + payTags(pay);
  return `<button type="button" class="name-link" data-review="${pay.id}" title="${esc(t("receipt.alt"))}">${esc(name)}${clip}</button>`;
}

/*
 * Ficha de un pago con su comprobante. Solo un admin ve Aprobar / Rechazar
 * (y la base solo se lo permite a un admin). onDone() se llama al cambiar
 * el estado.
 */
function openPaymentReview({ pay, person, country, onDone }) {
  const p = person || {};
  const cur = country ? country.currency : pay.currency;
  const fee = feeFor(p, country);
  const admin = ME.role === "admin";
  const amountWarn = Number(pay.amount) < fee
    ? `<div class="banner warn">${esc(t("rv.amount_low", { fee: fmtMoney(fee, cur) }))}</div>` : "";
  const kv = (label, value) => `<dt>${esc(t(label))}</dt><dd>${value}</dd>`;

  const { el, close } = openModal(`${p.full_name || p.email || ""} — ${fmtPeriod(pay.period)}`, `
    <div class="review-grid">
      <div>
        <p style="margin:0 0 12px">${chip(pay.status)}${payTags(pay)}</p>
        ${amountWarn}
        <dl class="kv">
          ${admin && country ? kv("common.country", esc(country.name)) : ""}
          ${kv("rv.amount", fmtMoney(pay.amount, pay.currency))}
          ${kv("rv.fee", fmtMoney(fee, cur))}
          ${kv("rv.paid_on", fmtDate(pay.paid_on))}
          ${pay.paid_on ? kv("rv.valid_until", fmtDate(validUntil(pay))) : ""}
          ${kv("rv.method", esc(methodLabel(pay.method)))}
          ${kv("rv.reference", esc(pay.reference || "—"))}
          ${kv("rv.note", esc(pay.note || "—"))}
          ${isThirdParty(pay) ? kv("tp.paid_by", `<span id="r-paid-by">${esc(t("tp.tag"))}</span>`) : ""}
          ${kv("rv.sent", fmtDate(pay.updated_at))}
          ${pay.reviewed_at ? kv("rv.reviewed", fmtDate(pay.reviewed_at)) : ""}
          ${pay.review_comment ? kv("rv.comment", esc(pay.review_comment)) : ""}
        </dl>
        ${admin ? `
        <div class="field">
          <label for="r-comment">${esc(t("rv.comment_label"))}</label>
          <textarea class="input" id="r-comment" placeholder="${esc(t("rv.comment_ph"))}"></textarea>
        </div>
        <div class="modal-foot" style="justify-content:flex-start">
          ${pay.status !== "approved" ? `<button class="btn success" id="r-approve" type="button">${esc(t("rv.approve"))}</button>` : ""}
          ${pay.status !== "rejected" ? `<button class="btn danger" id="r-reject" type="button">${esc(t("rv.reject"))}</button>` : ""}
          ${pay.status !== "pending" ? `<button class="btn ghost" id="r-reopen" type="button">${esc(t("rv.reopen"))}</button>` : ""}
        </div>` : `<div class="banner info">${esc(t("rv.only_admin"))}</div>`}
      </div>
      <div>
        <div id="r-receipt"><div class="receipt-view"></div></div>
        ${pay.receipt_path ? `<p class="sub" style="margin-top:8px">${esc(t("rv.tap_hint"))}</p>` : ""}
      </div>
    </div>
    ${pay.group_id ? `<div id="r-group" class="group-box"><p class="empty">${esc(t("receipt.loading"))}</p></div>` : ""}`, { wide: true });

  if (isThirdParty(pay)) {
    // Nombre de quien lo cargó (si este usuario puede ver ese perfil).
    sb.from("profiles").select("full_name,email").eq("id", pay.created_by).maybeSingle().then(({ data }) => {
      const span = el.querySelector("#r-paid-by");
      if (span && data) span.textContent = `${data.full_name || ""} (${data.email})`.trim();
    });
  }
  if (pay.group_id) {
    loadGroupInto(el, pay, admin, () => { close(); if (onDone) onDone(); });
  } else {
    renderReceipt(el.querySelector("#r-receipt .receipt-view"), pay.receipt_path);
  }
  if (!admin) return;

  const setStatus = async (status) => {
    const comment = el.querySelector("#r-comment").value.trim();
    if (status === "rejected" && !comment) {
      toast(t("rv.need_reason"), true);
      el.querySelector("#r-comment").focus();
      return;
    }
    const update = { status };
    if (comment || status === "approved") update.review_comment = comment || null;
    const { error } = await sb.from("payments").update(update).eq("id", pay.id);
    if (error) return toast(errMsg(error), true);
    close();
    toast(t({ approved: "rv.approved_toast", rejected: "rv.rejected_toast", pending: "rv.reopened_toast" }[status]));
    if (onDone) await onDone();
  };

  el.querySelector("#r-approve")?.addEventListener("click", () => setStatus("approved"));
  el.querySelector("#r-reject")?.addEventListener("click", () => setStatus("rejected"));
  el.querySelector("#r-reopen")?.addEventListener("click", () => setStatus("pending"));
}

/*
 * Detalle de un pago grupal dentro de la ficha de un pago: todos sus
 * comprobantes, observaciones, y a qué instructores (usuario y email)
 * corresponde. El admin puede aprobar todos los pendientes del grupo juntos.
 */
async function loadGroupInto(el, pay, admin, onApproved) {
  const box = el.querySelector("#r-group");
  const [{ data: group, error }, { data: items, error: e2 }] = await Promise.all([
    sb.from("payment_groups").select("*").eq("id", pay.group_id).maybeSingle(),
    sb.from("payments").select("*, instructor:profiles!payments_instructor_id_fkey(full_name,email,country_id,role)")
      .eq("group_id", pay.group_id).order("period"),
  ]);
  if (error || e2 || !group) {
    box.innerHTML = `<p class="empty">${esc(errMsg(error || e2))}</p>`;
    renderReceipt(el.querySelector("#r-receipt .receipt-view"), pay.receipt_path);
    return;
  }
  const paths = group.receipt_paths && group.receipt_paths.length ? group.receipt_paths : [pay.receipt_path].filter(Boolean);
  renderReceipts(el.querySelector("#r-receipt"), paths);
  const pending = items.filter((x) => x.status === "pending");
  const people = new Set(items.map((x) => x.instructor_id)).size;
  const multi = !group.country_id;
  const cName = (x) => ((COUNTRY_INDEX.get((x.instructor || {}).country_id) || {}).name || "—");
  box.innerHTML = `
    <h3>${esc(t("grp.box_title"))}</h3>
    <p class="sub">${esc(t("grp.box_sub", { people, total: fmtMoney(group.total_amount, group.currency), date: fmtDate(group.paid_on) }))}
      ${group.reference ? ` · ${esc(t("rv.reference"))}: ${esc(group.reference)}` : ""}</p>
    ${group.note ? `<div class="banner info" style="white-space:pre-wrap">${esc(group.note)}</div>` : ""}
    <div class="table-wrap"><table>
      <thead><tr><th>${esc(t("col.instructor"))}</th><th>${esc(t("common.email"))}</th>${multi ? `<th>${esc(t("common.country"))}</th>` : ""}<th>${esc(t("col.month"))}</th>
        <th class="num">${esc(t("col.amount"))}</th><th>${esc(t("col.status"))}</th><th>${esc(t("grp.col_note"))}</th></tr></thead>
      <tbody>${items.map((x) => `<tr${x.id === pay.id ? ' class="current"' : ""}>
        <td><strong>${esc((x.instructor || {}).full_name || "—")}</strong>${(x.instructor || {}).role === "director" ? `<div class="sub">${esc(t("dir.director_tag"))}</div>` : ""}</td>
        <td dir="ltr">${esc((x.instructor || {}).email || "")}</td>${multi ? `<td>${esc(cName(x))}</td>` : ""}
        <td>${esc(fmtPeriod(x.period))}</td>
        <td class="num">${fmtMoney(x.amount, x.currency)}</td>
        <td>${chip(x.status)}</td>
        <td>${esc(x.note || "")}</td></tr>`).join("")}</tbody>
    </table></div>
    ${admin && pending.length > 1 ? `<div class="modal-foot" style="justify-content:flex-start">
      <button class="btn success" id="g-approve-all" type="button">${esc(t("grp.approve_all", { n: pending.length }))}</button></div>` : ""}`;
  box.querySelector("#g-approve-all")?.addEventListener("click", async () => {
    const { error: e3 } = await sb.from("payments").update({ status: "approved" })
      .eq("group_id", pay.group_id).eq("status", "pending");
    if (e3) return toast(errMsg(e3), true);
    toast(t("grp.approved_all", { n: pending.length }));
    onApproved();
  });
}

/*
 * Pago grupal: un director (o admin) registra un solo pago que cubre a
 * varios instructores de un país, por uno o más meses, con uno o más
 * comprobantes y observaciones. Se crea un payment_group y una fila de
 * payments por instructor y mes (unidas por group_id). Lo cargado por un
 * director queda pendiente hasta que un admin lo apruebe.
 */
async function openGroupPayment(ctx) {
  const admin = ME.role === "admin";
  const countryById = (id) => ctx.countries.find((c) => c.id === id) || COUNTRY_INDEX.get(id) || null;
  // country = null: el admin paga por personas de varios países (los de la
  // vista actual: todos, una región o un país).
  let country = ctx.country || null;
  const countryPick = admin
    ? `<div class="field"><label for="g-country">${esc(t("common.country"))}</label>
        <select class="input" id="g-country"><option value="">${esc(t("grp.multi_country"))}</option>
        ${ctx.countries.map((c) => `<option value="${c.id}" ${country && c.id === country.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>`
    : "";
  const { el, close } = openModal(t("grp.title"), `
    <form id="g-form" novalidate>
      <div class="banner info">${esc(t(admin ? "grp.intro_admin" : "grp.intro"))}</div>
      ${countryPick}
      <div class="grid-2">
        <div class="field">
          <label for="g-month">${esc(t("grp.from_month"))}</label>
          <select class="input" id="g-month">${monthSelectOptions(ctx.period)}</select>
        </div>
        <div class="field">
          <label for="g-count">${esc(t("grp.months"))}</label>
          <select class="input" id="g-count">${[...Array(12)].map((_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="g-date">${esc(t("man.date"))}</label>
          <input class="input" id="g-date" type="date" value="${todayISO()}" max="${todayISO()}" />
        </div>
        <div class="field">
          <label for="g-method">${esc(t("man.method"))}</label>
          <select class="input" id="g-method">${methodOptions("paypal")}</select>
        </div>
      </div>
      <div class="field">
        <label for="g-ref">${esc(t("grp.reference"))}</label>
        <input class="input" id="g-ref" />
      </div>
      <div class="field">
        <label>${esc(t("grp.who"))}</label>
        <div class="row" style="margin-bottom:8px">
          <input class="input" id="g-search" placeholder="${esc(t("grp.search_ph"))}" style="flex:1;min-width:160px" />
          <button type="button" class="btn ghost sm" id="g-all">${esc(t("grp.select_all"))}</button>
          <button type="button" class="btn ghost sm" id="g-none">${esc(t("grp.select_none"))}</button>
        </div>
        <div class="table-wrap group-pick"><table>
          <thead><tr><th></th><th>${esc(t("col.instructor"))}</th><th>${esc(t("grp.col_months"))}</th>
            <th class="num">${esc(t("grp.col_amount"))}</th><th>${esc(t("grp.col_note"))}</th></tr></thead>
          <tbody id="g-body"></tbody>
        </table></div>
      </div>
      <div class="field">
        <label for="g-files">${esc(t("grp.files"))}</label>
        ${fileField("g-files", { multiple: true })}
      </div>
      <div class="field">
        <label for="g-note">${esc(t("grp.note"))}</label>
        <textarea class="input" id="g-note" placeholder="${esc(t("grp.note_ph"))}"></textarea>
      </div>
      <p class="group-total" id="g-total"></p>
      <div class="modal-foot">
        <button type="button" class="btn ghost" id="g-cancel">${esc(t("common.cancel"))}</button>
        <button type="submit" class="btn ${admin ? "success" : "primary"}" id="g-submit">${esc(t(admin ? "grp.submit_admin" : "grp.submit"))}</button>
      </div>
    </form>`, { wide: true });

  const q = (sel) => el.querySelector(sel);
  let existing = [];   // pagos ya cargados de esas personas en esos meses
  const picked = new Map(); // id -> { amount, note }

  // Personas que se pueden incluir: instructores activos del país y, si es
  // un director, él mismo (su propia cuota).
  // Personas que se pueden incluir: instructores y directores activos (del
  // país elegido, o de todos los de la vista si el admin eligió varios) y,
  // si es un director, él mismo (su propia cuota).
  const candidates = () => {
    const list = ctx.people.filter((p) => p.id !== ME.id && p.active && ["instructor", "director"].includes(p.role)
      && (country ? p.country_id === country.id : ctx.countries.some((c) => c.id === p.country_id)));
    if (ME.role === "director" && country && ME.country_id === country.id) list.unshift(ME);
    return list;
  };
  const countryOfP = (p) => countryById(p.country_id) || country;
  const curOf = (p) => (countryOfP(p) || {}).currency || "USD";
  const periods = () => {
    const from = `${q("#g-month").value}-01`;
    return [...Array(Number(q("#g-count").value))].map((_, i) => addMonths(from, i));
  };
  // Meses de una persona que todavía se pueden pagar (sin pago, o rechazado).
  const openPeriods = (p) => periods().filter((per) => {
    const pay = existing.find((x) => x.instructor_id === p.id && x.period === per);
    return (!pay || pay.status === "rejected") && per >= startMonthFor(p) && (!p.end_month || per <= p.end_month);
  });

  async function loadExisting() {
    const ids = candidates().map((p) => p.id);
    const ps = periods();
    existing = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await sb.from("payments").select("id,instructor_id,period,status")
        .in("instructor_id", ids.slice(i, i + 100)).gte("period", ps[0]).lte("period", ps[ps.length - 1]);
      if (error) return toast(errMsg(error), true);
      existing.push(...data);
    }
  }

  function renderTotal() {
    let total = 0, rows = 0, people = 0;
    const byCur = {};
    const countries = new Set();
    picked.forEach((v, id) => {
      const p = candidates().find((x) => x.id === id);
      if (!p) return;
      const n = openPeriods(p).length;
      if (!n) return;
      const sub = n * (Number(v.amount) || 0);
      people++; rows += n; total += sub;
      byCur[curOf(p)] = (byCur[curOf(p)] || 0) + sub;
      countries.add(p.country_id);
    });
    const totalTxt = Object.entries(byCur).map(([c, a]) => fmtMoney(a, c)).join(" + ");
    q("#g-total").innerHTML = people
      ? esc(t("grp.total", { people, months: rows, total: totalTxt }))
        + (countries.size > 1 ? ` <span class="sub">· ${esc(t("grp.n_countries", { n: countries.size }))}</span>` : "")
      : `<span class="sub">${esc(t("grp.none_selected"))}</span>`;
    return { total, rows, people, countries: [...countries], currencies: Object.keys(byCur) };
  }

  function renderPeople() {
    const term = q("#g-search").value.trim().toLowerCase();
    const list = candidates().filter((p) => !term
      || `${p.full_name} ${p.email} ${(countryOfP(p) || {}).name || ""}`.toLowerCase().includes(term));
    if (!list.length) {
      q("#g-body").innerHTML = `<tr><td colspan="5" class="empty">${esc(t("grp.no_people"))}</td></tr>`;
    } else {
      q("#g-body").innerHTML = list.map((p) => {
        const open = openPeriods(p);
        const total = periods().length;
        const sel = picked.has(p.id);
        const v = picked.get(p.id) || { amount: feeFor(p, countryOfP(p)), note: "" };
        const tags = [p.role === "director" ? t("dir.director_tag") : "", !country ? (countryOfP(p) || {}).name : ""].filter(Boolean);
        const monthsTxt = open.length === total ? t("grp.all_months", { n: total })
          : open.length ? t("grp.some_months", { n: open.length, total }) : t("grp.already_paid");
        return `<tr data-pid="${p.id}" class="${open.length ? "" : "muted"}">
          <td><input type="checkbox" data-pick="${p.id}" ${sel && open.length ? "checked" : ""} ${open.length ? "" : "disabled"} /></td>
          <td><strong>${esc(p.full_name || "—")}${p.id === ME.id ? ` (${esc(t("grp.me"))})` : ""}</strong><div class="sub"><span dir="ltr">${esc(p.email)}</span>${tags.length ? " · " + esc(tags.join(" · ")) : ""}</div></td>
          <td class="sub">${esc(monthsTxt)}</td>
          <td class="num"><input class="input sm" type="number" min="0.01" step="0.01" data-amount="${p.id}" value="${esc(v.amount)}" style="width:90px" ${open.length ? "" : "disabled"} /></td>
          <td><input class="input sm" data-note="${p.id}" value="${esc(v.note)}" placeholder="${esc(t("grp.row_note_ph"))}" ${open.length ? "" : "disabled"} /></td>
        </tr>`;
      }).join("");
    }
    renderTotal();
  }

  async function reload() {
    q("#g-body").innerHTML = `<tr><td colspan="5" class="empty">${esc(t("inst.loading"))}</td></tr>`;
    await loadExisting();
    renderPeople();
  }

  q("#g-country")?.addEventListener("change", (e) => {
    country = e.target.value ? countryById(e.target.value) : null;
    picked.clear();
    reload();
  });
  q("#g-month").addEventListener("change", reload);
  q("#g-count").addEventListener("change", reload);
  q("#g-search").addEventListener("input", renderPeople);
  q("#g-all").addEventListener("click", () => {
    q("#g-body").querySelectorAll("[data-pick]:not(:disabled)").forEach((c) => {
      const id = c.dataset.pick;
      picked.set(id, { amount: q(`[data-amount="${id}"]`).value, note: q(`[data-note="${id}"]`).value });
    });
    renderPeople();
  });
  q("#g-none").addEventListener("click", () => { picked.clear(); renderPeople(); });
  q("#g-body").addEventListener("change", (e) => {
    const id = e.target.dataset.pick;
    if (id) {
      if (e.target.checked) picked.set(id, { amount: q(`[data-amount="${id}"]`).value, note: q(`[data-note="${id}"]`).value });
      else picked.delete(id);
      renderTotal();
    }
  });
  q("#g-body").addEventListener("input", (e) => {
    const id = e.target.dataset.amount || e.target.dataset.note;
    if (!id) return;
    if (e.target.dataset.amount && !picked.has(id)) {
      picked.set(id, { amount: "", note: "" });
      q(`[data-pick="${id}"]`).checked = true;
    }
    const v = picked.get(id);
    if (!v) return;
    if (e.target.dataset.amount) v.amount = e.target.value; else v.note = e.target.value;
    renderTotal();
  });
  q("#g-cancel").addEventListener("click", close);

  q("#g-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { total, people, countries, currencies } = renderTotal();
    if (!people) return toast(t("grp.none_selected"), true);
    for (const [id, v] of picked) {
      const p = candidates().find((x) => x.id === id);
      if (p && openPeriods(p).length && !(Number(v.amount) > 0)) return toast(t("grp.err_amount", { name: p.full_name || p.email }), true);
    }
    const files = [...q("#g-files").files];
    if (!files.length) return toast(t("grp.err_files"), true);
    for (const f of files) {
      const v = validateReceipt(f);
      if (v) return toast(`${f.name}: ${v}`, true);
    }
    const btn = q("#g-submit");
    btn.disabled = true;
    btn.textContent = t("grp.saving");
    const groupId = crypto.randomUUID();
    let saved = false;
    try {
      const { error: e1 } = await sb.from("payment_groups").insert({
        id: groupId,
        // Un solo país, o null si el admin incluyó personas de varios.
        country_id: countries.length === 1 ? countries[0] : null,
        paid_on: q("#g-date").value || todayISO(),
        method: q("#g-method").value,
        reference: q("#g-ref").value.trim() || null,
        note: q("#g-note").value.trim() || null,
        total_amount: total,
        currency: currencies[0] || "USD",
        created_by: ME.id,
      });
      if (e1) throw e1;
      const paths = [];
      for (let i = 0; i < files.length; i++) paths.push(await uploadGroupReceipt(groupId, files[i], i));
      const { error: e2 } = await sb.from("payment_groups").update({ receipt_paths: paths }).eq("id", groupId);
      if (e2) throw e2;

      const base = {
        paid_on: q("#g-date").value || todayISO(),
        method: q("#g-method").value,
        reference: q("#g-ref").value.trim() || null,
        receipt_path: paths[0],
        group_id: groupId,
        status: admin ? "approved" : "pending",
      };
      const inserts = [];
      const updates = [];
      picked.forEach((v, id) => {
        const p = candidates().find((x) => x.id === id);
        if (!p) return;
        openPeriods(p).forEach((period) => {
          const row = { ...base, currency: curOf(p), instructor_id: id, period, amount: Number(v.amount), note: v.note.trim() || null };
          const old = existing.find((x) => x.instructor_id === id && x.period === period);
          if (old) updates.push([old.id, row]); else inserts.push(row);
        });
      });
      if (inserts.length) {
        const { error: e3 } = await sb.from("payments").insert(inserts);
        if (e3) throw e3;
        saved = true;
      }
      for (const [oldId, row] of updates) {
        const { error: e4 } = await sb.from("payments").update(row).eq("id", oldId);
        if (e4) throw e4;
      }
      close();
      toast(t(admin ? "grp.done_admin" : "grp.done", { n: inserts.length + updates.length }));
      if (ctx.onDone) await ctx.onDone();
    } catch (err) {
      // Si no se llegó a cargar ningún pago, se borra el grupo vacío.
      if (!saved) await sb.from("payment_groups").delete().eq("id", groupId);
      toast(errMsg(err), true);
      btn.disabled = false;
      btn.textContent = t(admin ? "grp.submit_admin" : "grp.submit");
    }
  });

  await reload();
}


/*
 * Pago por tercero: un director (o admin) registra el pago de OTRA persona
 * (instructor o director), por uno o más meses, con su comprobante. Queda
 * pendiente si lo carga un director; aprobado si lo carga un admin.
 */
async function openThirdPartyPayment(ctx) {
  const admin = ME.role === "admin";
  const countryOfP = (p) => COUNTRY_INDEX.get(p.country_id) || ctx.country || null;
  const people = ctx.people
    .filter((p) => p.id !== ME.id && p.active && ["instructor", "director"].includes(p.role)
      && (ctx.country ? p.country_id === ctx.country.id : ctx.countries.some((c) => c.id === p.country_id)))
    .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
  const label = (p) => `${p.full_name || "—"} — ${p.email}${p.role === "director" ? " · " + t("dir.director_tag") : ""}${admin ? " · " + ((countryOfP(p) || {}).name || "") : ""}`;

  const { el, close } = openModal(t("tp.form_title"), `
    <form id="t-form" novalidate>
      <div class="banner info">${esc(t(admin ? "tp.intro_admin" : "tp.intro"))}</div>
      <div class="field">
        <label for="t-person">${esc(t("tp.who"))}</label>
        <input class="input" id="t-search" placeholder="${esc(t("grp.search_ph"))}" style="margin-bottom:6px" />
        <select class="input" id="t-person" size="6"></select>
        <p class="sub" id="t-status" style="margin:6px 0 0"></p>
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="t-month">${esc(t("grp.from_month"))}</label>
          <select class="input" id="t-month">${monthSelectOptions(ctx.period)}</select>
        </div>
        <div class="field">
          <label for="t-count">${esc(t("grp.months"))}</label>
          <select class="input" id="t-count">${[...Array(12)].map((_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="t-amount">${esc(t("grp.col_amount"))}</label>
          <input class="input" id="t-amount" type="number" min="0.01" step="0.01" />
        </div>
        <div class="field">
          <label for="t-date">${esc(t("man.date"))}</label>
          <input class="input" id="t-date" type="date" value="${todayISO()}" max="${todayISO()}" />
        </div>
        <div class="field">
          <label for="t-method">${esc(t("man.method"))}</label>
          <select class="input" id="t-method">${methodOptions("paypal")}</select>
        </div>
        <div class="field">
          <label for="t-ref">${esc(t("grp.reference"))}</label>
          <input class="input" id="t-ref" />
        </div>
      </div>
      <div class="field">
        <label for="t-file">${esc(t("tp.file"))}</label>
        ${fileField("t-file")}
      </div>
      <div class="field">
        <label for="t-note">${esc(t("grp.note"))}</label>
        <textarea class="input" id="t-note" placeholder="${esc(t("tp.note_ph"))}"></textarea>
      </div>
      <p class="group-total" id="t-total"></p>
      <div class="modal-foot">
        <button type="button" class="btn ghost" id="t-cancel">${esc(t("common.cancel"))}</button>
        <button type="submit" class="btn ${admin ? "success" : "primary"}" id="t-submit">${esc(t(admin ? "grp.submit_admin" : "grp.submit"))}</button>
      </div>
    </form>`, { wide: true });

  const q = (sel) => el.querySelector(sel);
  let existing = [];
  const selected = () => people.find((p) => p.id === q("#t-person").value) || null;
  const periods = () => {
    const from = `${q("#t-month").value}-01`;
    return [...Array(Number(q("#t-count").value))].map((_, i) => addMonths(from, i));
  };
  const openPeriods = (p) => periods().filter((per) => {
    const pay = existing.find((x) => x.period === per);
    return (!pay || pay.status === "rejected") && per >= startMonthFor(p) && (!p.end_month || per <= p.end_month);
  });

  function renderList() {
    const term = q("#t-search").value.trim().toLowerCase();
    const cur = q("#t-person").value;
    const list = people.filter((p) => !term || label(p).toLowerCase().includes(term));
    q("#t-person").innerHTML = list.length
      ? list.map((p) => `<option value="${p.id}" ${p.id === cur ? "selected" : ""}>${esc(label(p))}</option>`).join("")
      : `<option value="" disabled>${esc(t("grp.no_people"))}</option>`;
  }

  function renderStatus() {
    const p = selected();
    if (!p) {
      q("#t-status").textContent = t("tp.pick_person");
      q("#t-total").textContent = "";
      return 0;
    }
    const open = openPeriods(p);
    const total = periods().length;
    q("#t-status").textContent = open.length === total ? t("grp.all_months", { n: total })
      : open.length ? t("grp.some_months", { n: open.length, total }) : t("grp.already_paid");
    const amount = Number(q("#t-amount").value) || 0;
    const cur = (countryOfP(p) || {}).currency || "USD";
    q("#t-total").textContent = open.length
      ? t("grp.total", { people: 1, months: open.length, total: fmtMoney(amount * open.length, cur) }) : "";
    return open.length;
  }

  async function loadExisting() {
    const p = selected();
    existing = [];
    if (!p) return renderStatus();
    const ps = periods();
    const { data, error } = await sb.from("payments").select("id,period,status")
      .eq("instructor_id", p.id).gte("period", ps[0]).lte("period", ps[ps.length - 1]);
    if (error) toast(errMsg(error), true);
    existing = data || [];
    renderStatus();
  }

  q("#t-search").addEventListener("input", () => {
    renderList();
    if (!q("#t-person").value && q("#t-person").options.length === 1 && q("#t-person").options[0].value) {
      q("#t-person").value = q("#t-person").options[0].value;
      q("#t-person").dispatchEvent(new Event("change"));
    }
  });
  q("#t-person").addEventListener("change", () => {
    const p = selected();
    if (p) q("#t-amount").value = feeFor(p, countryOfP(p)) || "";
    loadExisting();
  });
  q("#t-month").addEventListener("change", loadExisting);
  q("#t-count").addEventListener("change", loadExisting);
  q("#t-amount").addEventListener("input", renderStatus);
  q("#t-cancel").addEventListener("click", close);

  q("#t-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p = selected();
    if (!p) return toast(t("tp.pick_person"), true);
    const open = openPeriods(p);
    if (!open.length) return toast(t("grp.already_paid"), true);
    const amount = Number(q("#t-amount").value);
    if (!(amount > 0)) return toast(t("inst.err_amount"), true);
    const file = q("#t-file").files[0];
    if (!admin && !file) return toast(t("grp.err_files"), true);
    if (file) {
      const v = validateReceipt(file);
      if (v) return toast(v, true);
    }
    const btn = q("#t-submit");
    btn.disabled = true;
    btn.textContent = t("grp.saving");
    try {
      const receipt_path = file ? await uploadReceipt(p.id, open[0], file) : null;
      const base = {
        instructor_id: p.id,
        amount,
        currency: (countryOfP(p) || {}).currency || "USD",
        paid_on: q("#t-date").value || todayISO(),
        method: q("#t-method").value,
        reference: q("#t-ref").value.trim() || null,
        note: q("#t-note").value.trim() || null,
        receipt_path,
        status: admin ? "approved" : "pending",
      };
      const inserts = open.filter((per) => !existing.some((x) => x.period === per)).map((period) => ({ ...base, period }));
      if (inserts.length) {
        const { error } = await sb.from("payments").insert(inserts);
        if (error) throw error;
      }
      for (const old of existing.filter((x) => x.status === "rejected" && open.includes(x.period))) {
        const { error } = await sb.from("payments").update({ ...base, period: old.period }).eq("id", old.id);
        if (error) throw error;
      }
      close();
      toast(t(admin ? "tp.done_admin" : "tp.done", { name: p.full_name || p.email, n: open.length }));
      if (ctx.onDone) await ctx.onDone();
    } catch (err) {
      toast(errMsg(err), true);
      btn.disabled = false;
      btn.textContent = t(admin ? "grp.submit_admin" : "grp.submit");
    }
  });

  renderList();
  renderStatus();
}

/* ---------- UI ---------- */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/*
 * Mensaje de error traducido. Orden: código de la Netlify Function,
 * hint "ikmf:<código>" de los triggers, códigos de Postgres / Auth
 * conocidos y, si no, el texto original.
 */
function errMsg(e) {
  if (!e) return t("err.generic");
  const has = (key) => DICT.es[key] !== undefined;
  if (e.code && has(`err.${e.code}`)) return t(`err.${e.code}`);
  if (typeof e.hint === "string" && e.hint.startsWith("ikmf:") && has(`err.${e.hint.slice(5)}`)) {
    return t(`err.${e.hint.slice(5)}`);
  }
  if (e.code === "23505") return t("err.duplicate_period");
  if (e.code === "42501") return t("err.forbidden");
  const msg = e.message || e.error_description || String(e);
  if (/row-level security/i.test(msg)) return t("err.forbidden");
  if (/banned/i.test(msg)) return t("login.banned");
  if (/invalid login credentials/i.test(msg)) return t("login.invalid");
  if (/email not confirmed/i.test(msg)) return t("login.not_confirmed");
  if (/already registered|already exists/i.test(msg)) return t("err.email_exists");
  return msg;
}

let toastTimer = null;
function toast(msg, isError) {
  document.querySelectorAll(".toast").forEach((x) => x.remove());
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), isError ? 6000 : 3000);
}

/*
 * Abre un modal. `html` es el contenido del cuerpo. Devuelve el elemento
 * del modal y una función para cerrarlo.
 */
function openModal(title, html, { wide } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="modal-close" aria-label="${esc(t("common.close"))}">×</button>
      </div>
      <div class="modal-body">${html}</div>
    </div>`;
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(backdrop);
  return { el: backdrop.querySelector(".modal"), close };
}

/* ---------- Exportar (CSV / Excel / PDF) ---------- */

// Las librerías de Excel y PDF están en vendor/ y se cargan solo al usarlas.
const loadedScripts = {};
function loadScriptOnce(src) {
  if (!loadedScripts[src]) {
    loadedScripts[src] = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error(src));
      document.head.appendChild(el);
    });
  }
  return loadedScripts[src];
}

// Botones "Exportar: Excel · PDF · CSV" para una sección (`scope`).
function exportButtons(scope) {
  return `<div class="export-group"><span class="sub">${esc(t("exp.label"))}</span>
    <button type="button" class="btn ghost sm" data-export="${scope}:xlsx">Excel</button>
    <button type="button" class="btn ghost sm" data-export="${scope}:pdf">PDF</button>
    <button type="button" class="btn ghost sm" data-export="${scope}:csv">CSV</button></div>`;
}

/*
 * Arma las filas con build() y las descarga en el formato pedido. Para PDF
 * con la interfaz en hebreo, las filas se arman en inglés (las fuentes
 * estándar del PDF no tienen caracteres hebreos).
 */
async function runExport(format, filename, build) {
  const pdfInEnglish = format === "pdf" && getLang() === "he";
  let data;
  if (pdfInEnglish) LANG_OVERRIDE = "en";
  try {
    data = build(); // { title, rows }
  } finally {
    LANG_OVERRIDE = null;
  }
  try {
    if (format === "csv") return downloadCSV(`${filename}.csv`, data.rows);
    toast(t("exp.generating"));
    if (format === "xlsx") {
      await loadScriptOnce("vendor/xlsx-0.18.5.full.min.js");
      const ws = XLSX.utils.aoa_to_sheet(data.rows);
      ws["!cols"] = data.rows[0].map((_, i) => ({
        wch: Math.min(45, Math.max(...data.rows.map((r) => String(r[i] ?? "").length)) + 2),
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, data.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
      XLSX.writeFile(wb, `${filename}.xlsx`);
    } else if (format === "pdf") {
      await loadScriptOnce("vendor/jspdf-2.5.2.umd.min.js");
      await loadScriptOnce("vendor/jspdf-autotable-3.8.4.min.js");
      const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      doc.setFontSize(14);
      doc.text(data.title, 40, 40);
      doc.setFontSize(9);
      doc.setTextColor(110);
      if (pdfInEnglish) LANG_OVERRIDE = "en";
      try {
        doc.text(`IKMF · ${t("exp.generated", { date: fmtDate(new Date().toISOString()) })}`, 40, 56);
      } finally {
        LANG_OVERRIDE = null;
      }
      doc.autoTable({
        head: [data.rows[0].map(String)],
        body: data.rows.slice(1).map((r) => r.map((v) => (v === null || v === undefined ? "" : String(v)))),
        startY: 68,
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [200, 16, 46] },
        alternateRowStyles: { fillColor: [245, 246, 248] },
      });
      doc.save(`${filename}.pdf`);
    }
  } catch (e) {
    toast(t("exp.error", { msg: errMsg(e) }), true);
  }
}

// Estado de la cuenta como texto (para exportar).
function accountLabel(profile) {
  const st = accountState(profile);
  return st === "left"
    ? t("account.left_since", { month: fmtPeriod(addMonths(profile.end_month, 1)) })
    : t(`account.${st}`);
}

function downloadCSV(filename, rows) {
  const csv = rows
    .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
