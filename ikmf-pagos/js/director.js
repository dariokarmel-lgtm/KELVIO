/*
 * Panel de país (director / admin): pagos del mes, comprobantes por
 * validar y gestión de instructores. Un director solo ve su país (RLS);
 * un admin elige el país con el selector.
 */

const state = {
  countries: [],
  country: null,
  people: [],     // perfiles del país que este usuario puede administrar
  payments: [],   // pagos de esos perfiles
  period: currentPeriod(),
  tab: "month",
};

function $(id) { return document.getElementById(id); }

function person(id) {
  return state.people.find((p) => p.id === id);
}

function paymentOf(personId, period) {
  return state.payments.find((p) => p.instructor_id === personId && p.period === period);
}

function currency() {
  return state.country ? state.country.currency : "USD";
}

// ¿Se le cobra `period` a esta persona? (alta, no pendiente, no de baja para ese mes)
function billable(p, period) {
  if (p.start_month > period) return false;
  if (p.end_month) return period <= p.end_month;
  return p.active;
}

// Meses vencidos (anteriores al actual) sin pago aprobado ni en revisión.
function dueMonths(p) {
  if (!p.active && !p.end_month) return []; // pendiente de activación
  let last = addMonths(currentPeriod(), -1);
  if (p.end_month && p.end_month < last) last = p.end_month;
  if (p.start_month > last) return [];
  return periodsBetween(p.start_month, last).filter((period) => {
    const pay = paymentOf(p.id, period);
    return !pay || pay.status === "rejected";
  });
}

/* ---------- Carga de datos ---------- */

async function loadCountries() {
  const { data, error } = await sb.from("countries").select("*").order("name");
  if (error) throw error;
  state.countries = ME.role === "admin" ? data : data.filter((c) => c.id === ME.country_id);
}

async function loadCountryData() {
  if (!state.country) {
    state.people = [];
    state.payments = [];
    return;
  }
  const { data: people, error } = await sb
    .from("profiles")
    .select("*")
    .eq("country_id", state.country.id)
    .neq("role", "admin")
    .neq("id", ME.id)
    .order("full_name");
  if (error) throw error;
  state.people = people;

  const ids = people.map((p) => p.id);
  const all = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error: e2 } = await sb.from("payments").select("*").in("instructor_id", ids.slice(i, i + 100));
    if (e2) throw e2;
    all.push(...data);
  }
  state.payments = all;
}

async function refresh() {
  try {
    await loadCountryData();
  } catch (e) {
    toast(errMsg(e), true);
  }
  renderAll();
}

/* ---------- Render ---------- */

function renderAll() {
  $("title").textContent = state.country ? `Panel — ${state.country.name}` : "Panel de país";
  $("default-fee").textContent = state.country ? fmtMoney(state.country.default_fee, currency()) : "—";

  const pendingCount = state.payments.filter((p) => p.status === "pending").length;
  $("pending-badge").textContent = pendingCount;
  $("pending-badge").classList.toggle("hidden", !pendingCount);
  const inactiveCount = state.people.filter((p) => accountState(p) === "pending").length;
  $("inactive-badge").textContent = inactiveCount;
  $("inactive-badge").classList.toggle("hidden", !inactiveCount);

  renderMonth();
  renderPending();
  renderInstructors();
}

function renderMonth() {
  const period = state.period;
  $("month-input").value = period.slice(0, 7);
  const isCurrentOrFuture = period >= currentPeriod();

  const rows = state.people
    .filter((p) => billable(p, period) || paymentOf(p.id, period))
    .map((p) => ({ p, pay: paymentOf(p.id, period) }));

  const counts = { approved: 0, pending: 0, rejected: 0, missing: 0 };
  let collected = 0, expected = 0;
  rows.forEach(({ p, pay }) => {
    if (billable(p, period)) expected += feeFor(p, state.country);
    if (!pay) counts.missing++;
    else counts[pay.status]++;
    if (pay && pay.status === "approved") collected += Number(pay.amount);
  });

  $("month-stats").innerHTML = `
    <div class="stat"><div class="label">Instructores</div><div class="value">${rows.length}</div></div>
    <div class="stat green"><div class="label">Aprobados</div><div class="value">${counts.approved}</div></div>
    <div class="stat yellow"><div class="label">Por validar</div><div class="value">${counts.pending}</div></div>
    <div class="stat red"><div class="label">${isCurrentOrFuture ? "Sin pagar aún" : "Adeudan"}</div><div class="value">${counts.missing + counts.rejected}</div></div>
    <div class="stat green"><div class="label">Recaudado</div><div class="value">${fmtMoney(collected, currency())}</div></div>
    <div class="stat"><div class="label">Esperado</div><div class="value">${fmtMoney(expected, currency())}</div></div>`;

  const order = { pending: 0, rejected: 1, due: 2, upcoming: 2, approved: 3 };
  rows.sort((a, b) => order[monthStatus(a.pay, period)] - order[monthStatus(b.pay, period)]
    || (a.p.full_name || "").localeCompare(b.p.full_name || ""));

  $("month-body").innerHTML = rows.map(({ p, pay }) => {
    const status = monthStatus(pay, period);
    const due = dueMonths(p).length;
    let actions = "";
    if (pay) {
      actions = `<button class="btn sm ${pay.status === "pending" ? "primary" : "ghost"}" data-review="${pay.id}">${pay.status === "pending" ? "Validar" : "Ver"}</button>`;
    } else {
      actions = `<button class="btn sm ghost" data-manual="${p.id}" data-period="${period}">Registrar pago</button>`;
    }
    return `<tr>
      <td><strong>${esc(p.full_name || "(sin nombre)")}</strong><div class="sub">${esc(p.email)}${p.role === "director" ? " · Director" : ""}</div></td>
      <td>${chip(status)}</td>
      <td class="num">${fmtMoney(feeFor(p, state.country), currency())}</td>
      <td class="num">${pay ? fmtMoney(pay.amount, pay.currency) : "—"}</td>
      <td>${pay ? fmtDate(pay.paid_on) : "—"}</td>
      <td class="num">${due ? `<span style="color:var(--color-red);font-weight:700">${due}</span>` : "0"}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">${state.country ? "No hay instructores a cobrar este mes." : "Elegí un país."}</td></tr>`;
}

function renderPending() {
  const list = state.payments
    .filter((p) => p.status === "pending")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  $("pending-body").innerHTML = list.map((pay) => {
    const p = person(pay.instructor_id) || {};
    return `<tr>
      <td><strong>${esc(p.full_name || p.email || "—")}</strong></td>
      <td>${fmtPeriod(pay.period)}</td>
      <td class="num">${fmtMoney(pay.amount, pay.currency)}</td>
      <td>${fmtDate(pay.paid_on)}</td>
      <td>${esc(pay.method || "—")}</td>
      <td>${fmtDate(pay.updated_at)}</td>
      <td class="actions"><button class="btn sm primary" data-review="${pay.id}">Validar</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">No hay comprobantes pendientes. 🎉</td></tr>`;
}

// Lo que puede hacer el usuario actual sobre una persona del listado.
function canManagePerson(p) {
  return ME.role === "admin" || p.role === "instructor";
}

function renderInstructors() {
  const showLeft = $("show-left").checked;
  const order = { pending: 0, active: 1, left: 2 };
  const list = state.people
    .filter((p) => showLeft || accountState(p) !== "left")
    .sort((a, b) => order[accountState(a)] - order[accountState(b)]
      || (a.full_name || "").localeCompare(b.full_name || ""));

  $("instructors-body").innerHTML = list.map((p) => {
    const due = dueMonths(p);
    const st = accountState(p);
    let actions = "";
    if (canManagePerson(p)) {
      if (st === "pending") actions += `<button class="btn sm success" data-activate="${p.id}">Activar</button> `;
      actions += `<button class="btn sm ghost" data-edit-user="${p.id}">Editar</button> `;
      actions += st === "left"
        ? `<button class="btn sm ghost" data-activate="${p.id}">Reactivar</button>`
        : `<button class="btn sm ghost" data-deactivate="${p.id}">Dar de baja</button>`;
    }
    return `<tr>
      <td><strong>${esc(p.full_name || "(sin nombre)")}</strong>
        <div class="sub">${p.role === "director" ? "Director · " : ""}Registrado ${fmtDate(p.created_at)}</div></td>
      <td>${esc(p.email)}<div class="sub">${esc(p.phone || "")}</div></td>
      <td>${accountChip(p)}</td>
      <td class="num">${fmtMoney(feeFor(p, state.country), currency())}${p.monthly_fee === null ? '<div class="sub">del país</div>' : ""}</td>
      <td>${fmtPeriod(p.start_month)}</td>
      <td class="num">${due.length
        ? `<span style="color:var(--color-red);font-weight:700">${due.length} · ${fmtMoney(due.length * feeFor(p, state.country), currency())}</span>`
        : "Al día"}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">${state.country ? "No hay instructores para mostrar." : "Elegí un país."}</td></tr>`;
}

function openPersonForm(p) {
  openUserForm({
    user: p,
    roles: ME.role === "admin" ? ["instructor", "director"] : null,
    countries: null,
    country: state.country,
    onSaved: refresh,
  });
}

/* ---------- Acciones ---------- */

function openReview(paymentId) {
  const pay = state.payments.find((p) => p.id === paymentId);
  const p = person(pay.instructor_id) || {};
  const fee = feeFor(p, state.country);
  const amountWarn = Number(pay.amount) < fee
    ? `<div class="banner warn">El monto es menor a la cuota (${fmtMoney(fee, currency())}).</div>` : "";

  const { el, close } = openModal(`${p.full_name || p.email} — ${fmtPeriod(pay.period)}`, `
    <div class="review-grid">
      <div>
        <p style="margin:0 0 12px">${chip(pay.status)}</p>
        ${amountWarn}
        <dl class="kv">
          <dt>Monto</dt><dd>${fmtMoney(pay.amount, pay.currency)}</dd>
          <dt>Cuota</dt><dd>${fmtMoney(fee, currency())}</dd>
          <dt>Pagado el</dt><dd>${fmtDate(pay.paid_on)}</dd>
          <dt>Medio</dt><dd>${esc(pay.method || "—")}</dd>
          <dt>Referencia</dt><dd>${esc(pay.reference || "—")}</dd>
          <dt>Nota</dt><dd>${esc(pay.note || "—")}</dd>
          <dt>Enviado</dt><dd>${fmtDate(pay.updated_at)}</dd>
          ${pay.reviewed_at ? `<dt>Revisado</dt><dd>${fmtDate(pay.reviewed_at)}</dd>` : ""}
          ${pay.review_comment ? `<dt>Comentario</dt><dd>${esc(pay.review_comment)}</dd>` : ""}
        </dl>
        <div class="field">
          <label for="r-comment">Comentario (obligatorio para rechazar)</label>
          <textarea class="input" id="r-comment" placeholder="Ej: el comprobante no se lee, falta el monto…"></textarea>
        </div>
        <div class="modal-foot" style="justify-content:flex-start">
          ${pay.status !== "approved" ? `<button class="btn success" id="r-approve" type="button">✓ Aprobar</button>` : ""}
          ${pay.status !== "rejected" ? `<button class="btn danger" id="r-reject" type="button">✕ Rechazar</button>` : ""}
          ${pay.status !== "pending" ? `<button class="btn ghost" id="r-reopen" type="button">Volver a revisión</button>` : ""}
        </div>
      </div>
      <div>
        <div class="receipt-view" id="r-receipt"></div>
        ${pay.receipt_path ? `<p class="sub" style="margin-top:8px">Tocá la imagen para abrirla en tamaño completo.</p>` : ""}
      </div>
    </div>`, { wide: true });

  renderReceipt(el.querySelector("#r-receipt"), pay.receipt_path);

  const setStatus = async (status) => {
    const comment = el.querySelector("#r-comment").value.trim();
    if (status === "rejected" && !comment) {
      toast("Escribí el motivo del rechazo para que el instructor sepa qué corregir.", true);
      el.querySelector("#r-comment").focus();
      return;
    }
    const update = { status };
    if (comment || status === "approved") update.review_comment = comment || null;
    const { error } = await sb.from("payments").update(update).eq("id", pay.id);
    if (error) return toast(errMsg(error), true);
    close();
    toast(status === "approved" ? "Pago aprobado." : status === "rejected" ? "Pago rechazado." : "Pago devuelto a revisión.");
    await refresh();
  };

  el.querySelector("#r-approve")?.addEventListener("click", () => setStatus("approved"));
  el.querySelector("#r-reject")?.addEventListener("click", () => setStatus("rejected"));
  el.querySelector("#r-reopen")?.addEventListener("click", () => setStatus("pending"));
}

// Pago registrado por el director (ej. efectivo): queda aprobado directamente.
function openManualPayment(personId, period) {
  const p = person(personId);
  const { el, close } = openModal(`Registrar pago — ${p.full_name || p.email}`, `
    <form id="m-form" novalidate>
      <div class="grid-2">
        <div class="field">
          <label>Mes</label>
          <input class="input" value="${fmtPeriod(period)}" disabled />
        </div>
        <div class="field">
          <label for="m-amount">Monto (${esc(currency())})</label>
          <input class="input" id="m-amount" type="number" min="0.01" step="0.01" value="${feeFor(p, state.country) || ""}" />
        </div>
        <div class="field">
          <label for="m-date">Fecha de pago</label>
          <input class="input" id="m-date" type="date" value="${todayISO()}" max="${todayISO()}" />
        </div>
        <div class="field">
          <label for="m-method">Medio</label>
          <select class="input" id="m-method">${methodOptions("Efectivo")}</select>
        </div>
      </div>
      <div class="field">
        <label for="m-file">Comprobante (opcional)</label>
        <input class="input" id="m-file" type="file" accept="image/*,application/pdf" />
      </div>
      <div class="field">
        <label for="m-note">Nota (opcional)</label>
        <textarea class="input" id="m-note"></textarea>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" id="m-cancel">Cancelar</button>
        <button type="submit" class="btn success" id="m-submit">Registrar como aprobado</button>
      </div>
    </form>`);

  el.querySelector("#m-cancel").addEventListener("click", close);
  el.querySelector("#m-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = Number(el.querySelector("#m-amount").value);
    if (!(amount > 0)) return toast("Ingresá un monto válido.", true);
    const file = el.querySelector("#m-file").files[0];
    if (file) {
      const v = validateReceipt(file);
      if (v) return toast(v, true);
    }
    const btn = el.querySelector("#m-submit");
    btn.disabled = true;
    try {
      const receipt_path = file ? await uploadReceipt(p.id, period, file) : null;
      const { error } = await sb.from("payments").insert({
        instructor_id: p.id,
        period,
        amount,
        currency: currency(),
        paid_on: el.querySelector("#m-date").value || todayISO(),
        method: el.querySelector("#m-method").value,
        note: el.querySelector("#m-note").value.trim() || null,
        receipt_path,
        status: "approved",
      });
      if (error) throw error;
      close();
      toast("Pago registrado.");
      await refresh();
    } catch (err) {
      toast(errMsg(err), true);
      btn.disabled = false;
    }
  });
}

function exportMonth() {
  const period = state.period;
  const rows = [["Instructor", "Email", "Mes", "Estado", "Cuota", "Monto pagado", "Moneda", "Fecha de pago", "Medio", "Referencia", "Comentario"]];
  state.people
    .filter((p) => billable(p, period) || paymentOf(p.id, period))
    .forEach((p) => {
      const pay = paymentOf(p.id, period);
      rows.push([
        p.full_name, p.email, period.slice(0, 7), STATUS_LABELS[monthStatus(pay, period)],
        feeFor(p, state.country), pay ? pay.amount : "", currency(),
        pay ? pay.paid_on : "", pay ? pay.method : "", pay ? pay.reference : "", pay ? pay.review_comment : "",
      ]);
    });
  downloadCSV(`ikmf-${state.country ? state.country.code : "pais"}-${period.slice(0, 7)}.csv`, rows);
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["month", "pending", "instructors"].forEach((t) => $(`tab-${t}`).classList.toggle("hidden", t !== tab));
}

/* ---------- Init ---------- */

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.review) openReview(t.dataset.review);
  if (t.dataset.manual) openManualPayment(t.dataset.manual, t.dataset.period);
  if (t.dataset.editUser) openPersonForm(person(t.dataset.editUser));
  if (t.dataset.deactivate) openDeactivateForm(person(t.dataset.deactivate), refresh);
  if (t.dataset.activate) reactivateUser(person(t.dataset.activate), refresh);
  if (t.dataset.tab) setTab(t.dataset.tab);
});

(async function init() {
  if (!(await requireRole(["director", "admin"]))) return;

  if (ME.role === "director" && !ME.active) {
    document.querySelector("main").innerHTML = `<div class="banner warn">Tu cuenta de director todavía no está activa. Pedile a un administrador que la active.</div>`;
    return;
  }

  try {
    await loadCountries();
  } catch (e) {
    return toast(errMsg(e), true);
  }

  const sel = $("country-select");
  if (ME.role === "admin") {
    sel.classList.remove("hidden");
    sel.innerHTML = state.countries.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    let saved = null;
    try { saved = localStorage.getItem("ikmf.country"); } catch { /* sin storage */ }
    state.country = state.countries.find((c) => c.id === saved) || state.countries[0] || null;
    if (state.country) sel.value = state.country.id;
    sel.addEventListener("change", () => {
      state.country = state.countries.find((c) => c.id === sel.value);
      try { localStorage.setItem("ikmf.country", sel.value); } catch { /* sin storage */ }
      refresh();
    });
  } else {
    state.country = state.countries[0] || null;
    if (!state.country) {
      document.querySelector("main").innerHTML = `<div class="banner warn">Tu cuenta no tiene país asignado. Pedile a un administrador que te lo asigne.</div>`;
      return;
    }
  }

  $("month-input").addEventListener("change", (e) => {
    if (e.target.value) { state.period = `${e.target.value}-01`; renderMonth(); }
  });
  $("prev-month").addEventListener("click", () => { state.period = addMonths(state.period, -1); renderMonth(); });
  $("next-month").addEventListener("click", () => { state.period = addMonths(state.period, 1); renderMonth(); });
  $("export-btn").addEventListener("click", exportMonth);
  $("show-left").addEventListener("change", renderInstructors);
  $("new-user-btn").addEventListener("click", () => openPersonForm(null));
  if (ME.role === "admin") $("new-user-btn").textContent = "+ Nuevo instructor / director";

  await refresh();
})();
