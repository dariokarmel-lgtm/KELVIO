/*
 * Helpers compartidos por todas las páginas: cliente Supabase, sesión,
 * perfil del usuario, navegación, formato de fechas/montos, comprobantes.
 */

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const ROLE_LABELS = { instructor: "Instructor", director: "Director de país", admin: "Administrador" };
const STATUS_LABELS = {
  approved: "Aprobado",
  pending: "En revisión",
  rejected: "Rechazado",
  due: "Adeuda",
  upcoming: "A pagar",
  inactive: "Inactivo",
};
const PAYMENT_METHODS = ["Transferencia", "Depósito", "Mercado Pago", "PayPal", "Efectivo", "Otro"];
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

function homeFor(profile) {
  return profile.role === "instructor" ? "instructor.html" : "director.html";
}

async function signOut() {
  await sb.auth.signOut();
  location.href = "index.html";
}

function renderTopbar() {
  const page = document.body.dataset.page;
  const links = [{ href: "instructor.html", key: "instructor", label: "Mis pagos" }];
  if (ME.role === "director" || ME.role === "admin") {
    links.push({ href: "director.html", key: "director", label: ME.role === "admin" ? "Países" : "Mi país" });
  }
  if (ME.role === "admin") links.push({ href: "admin.html", key: "admin", label: "Administración" });

  const bar = document.createElement("header");
  bar.className = "topbar";
  bar.innerHTML = `
    <div class="topbar-inner">
      <div class="brand"><span class="brand-mark">IK</span> IKMF Pagos</div>
      <nav class="nav">
        ${links.map((l) => `<a href="${l.href}" class="${l.key === page ? "active" : ""}">${l.label}</a>`).join("")}
      </nav>
      <div class="user-box">
        <span>${esc(ME.full_name || ME.email)} · ${ROLE_LABELS[ME.role]}${ME.country ? " · " + esc(ME.country.name) : ""}</span>
        <button type="button" id="logout-btn">Salir</button>
      </div>
    </div>`;
  document.body.prepend(bar);
  bar.querySelector("#logout-btn").addEventListener("click", signOut);
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

// Lista de períodos desde `from` hasta `to` inclusive, del más nuevo al más viejo.
function periodsBetween(from, to) {
  const out = [];
  for (let p = to; p >= from; p = addMonths(p, -1)) out.push(p);
  return out;
}

function fmtPeriod(period) {
  const [y, m] = period.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString("es", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(iso + "T00:00:00") : new Date(iso);
  return d.toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ---------- Montos ---------- */

function fmtMoney(amount, currency) {
  if (amount === null || amount === undefined || amount === "") return "—";
  try {
    return new Intl.NumberFormat("es", { style: "currency", currency: currency || "USD" }).format(amount);
  } catch {
    return `${Number(amount).toFixed(2)} ${currency || ""}`;
  }
}

// Cuota que le corresponde a un instructor: la propia o la por defecto del país.
function feeFor(profile, country) {
  if (profile.monthly_fee !== null && profile.monthly_fee !== undefined) return Number(profile.monthly_fee);
  return country ? Number(country.default_fee) : 0;
}

/*
 * Estado de un mes para un instructor. `payment` puede ser undefined.
 * Un mes sin pago aprobado ni en revisión cuenta como deuda, salvo el mes
 * en curso, que se muestra como "A pagar".
 */
function monthStatus(payment, period) {
  if (payment) return payment.status;
  return period >= currentPeriod() ? "upcoming" : "due";
}

function chip(status) {
  return `<span class="chip ${status}">${STATUS_LABELS[status]}</span>`;
}

/* ---------- Comprobantes ---------- */

function validateReceipt(file) {
  if (!file) return "Elegí el archivo del comprobante.";
  if (file.size > MAX_RECEIPT_BYTES) return "El comprobante no puede pesar más de 5 MB.";
  if (file.type && !RECEIPT_TYPES.includes(file.type)) return "Formato no permitido. Subí una imagen (JPG, PNG, WEBP, HEIC) o un PDF.";
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
    container.innerHTML = `<p class="empty">Pago registrado sin comprobante.</p>`;
    return;
  }
  container.innerHTML = `<p class="empty">Cargando comprobante…</p>`;
  try {
    const url = await receiptUrl(path);
    if (/\.pdf$/i.test(path)) {
      container.innerHTML = `<iframe src="${url}" title="Comprobante"></iframe>`;
    } else if (/\.heic$/i.test(path)) {
      container.innerHTML = `<p class="empty">Formato HEIC: <a href="${url}" target="_blank" rel="noopener">descargar comprobante</a></p>`;
    } else {
      container.innerHTML = `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Comprobante" /></a>`;
    }
  } catch (e) {
    container.innerHTML = `<p class="empty">No se pudo cargar el comprobante: ${esc(errMsg(e))}</p>`;
  }
}

/* ---------- UI ---------- */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function errMsg(e) {
  return (e && (e.message || e.error_description)) || String(e);
}

let toastTimer = null;
function toast(msg, isError) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
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
        <button type="button" class="modal-close" aria-label="Cerrar">×</button>
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

function methodOptions(selected) {
  return PAYMENT_METHODS.map((m) => `<option ${m === selected ? "selected" : ""}>${m}</option>`).join("");
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
