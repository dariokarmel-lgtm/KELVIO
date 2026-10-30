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

function renderTopbar() {
  const page = document.body.dataset.page;
  const links = [];
  if (ME.role === "admin" || ME.role === "director") links.push({ href: "dashboard.html", key: "dashboard", label: t("nav.dashboard") });
  links.push({ href: "instructor.html", key: "instructor", label: t("nav.my_payments") });
  if (ME.role === "director" || ME.role === "admin") {
    links.push({ href: "director.html", key: "director", label: t(ME.role === "admin" ? "nav.countries" : "nav.my_country") });
  }
  if (ME.role === "admin") links.push({ href: "admin.html", key: "admin", label: t("nav.admin") });

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

// ¿Se le cobra `period` a esta persona? (alta, no pendiente, no de baja para ese mes)
function billable(p, period) {
  if (p.start_month > period) return false;
  if (p.end_month) return period <= p.end_month;
  return p.active;
}

/*
 * Meses vencidos (anteriores al actual) sin pago aprobado ni en revisión.
 * `paymentOf(personId, period)` devuelve el pago de ese mes, si hay.
 */
function dueMonthsFor(p, paymentOf) {
  if (!p.active && !p.end_month) return []; // pendiente de activación
  let last = addMonths(currentPeriod(), -1);
  if (p.end_month && p.end_month < last) last = p.end_month;
  if (p.start_month > last) return [];
  return periodsBetween(p.start_month, last).filter((period) => {
    const pay = paymentOf(p.id, period);
    return !pay || pay.status === "rejected";
  });
}

/* ---------- Comprobantes ---------- */

/*
 * Selector de archivo traducido. El <input type="file"> nativo muestra su
 * botón en el idioma del navegador; acá se oculta y se usa un botón propio
 * con t(). El input sigue con el mismo id, así que .files funciona igual.
 */
function fileField(id) {
  return `<label class="file-pick">
    <input id="${id}" type="file" accept="image/*,application/pdf" />
    <span class="btn ghost sm">${esc(t("file.choose"))}</span>
    <span class="file-name">${esc(t("file.none"))}</span>
  </label>`;
}

document.addEventListener("change", (e) => {
  const input = e.target;
  if (!input.matches || !input.matches(".file-pick input[type=file]")) return;
  const name = input.closest(".file-pick").querySelector(".file-name");
  const file = input.files && input.files[0];
  name.textContent = file ? file.name : t("file.none");
  name.classList.toggle("chosen", !!file);
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

/* ---------- Revisión de un pago ---------- */

// Nombre del instructor como link: al tocarlo se abre la ficha del pago con
// el comprobante (la abre el handler de data-review de cada página).
function payNameLink(name, pay) {
  const clip = pay.receipt_path ? ` <span class="clip" aria-hidden="true">📎</span>` : "";
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
        <p style="margin:0 0 12px">${chip(pay.status)}</p>
        ${amountWarn}
        <dl class="kv">
          ${admin && country ? kv("common.country", esc(country.name)) : ""}
          ${kv("rv.amount", fmtMoney(pay.amount, pay.currency))}
          ${kv("rv.fee", fmtMoney(fee, cur))}
          ${kv("rv.paid_on", fmtDate(pay.paid_on))}
          ${kv("rv.method", esc(methodLabel(pay.method)))}
          ${kv("rv.reference", esc(pay.reference || "—"))}
          ${kv("rv.note", esc(pay.note || "—"))}
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
        <div class="receipt-view" id="r-receipt"></div>
        ${pay.receipt_path ? `<p class="sub" style="margin-top:8px">${esc(t("rv.tap_hint"))}</p>` : ""}
      </div>
    </div>`, { wide: true });

  renderReceipt(el.querySelector("#r-receipt"), pay.receipt_path);
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
