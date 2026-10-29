/*
 * Panel de país (director / admin): pagos del mes, comprobantes pendientes
 * y gestión de instructores. Un director solo ve su país (RLS) y NO aprueba
 * ni rechaza: eso lo hace únicamente un admin (lo fuerza la base). El admin
 * elige el país con el selector y ve los pendientes de todos los países.
 */

const state = {
  countries: [],
  country: null,
  people: [],         // perfiles del país que este usuario puede ver
  payments: [],       // pagos de esos perfiles
  globalPending: [],  // admin: pendientes de todos los países (con su instructor)
  period: currentPeriod(),
  tab: "month",
};

function $(id) { return document.getElementById(id); }

function isAdmin() {
  return ME.role === "admin";
}

function person(id) {
  return state.people.find((p) => p.id === id);
}

function paymentOf(personId, period) {
  return state.payments.find((p) => p.instructor_id === personId && p.period === period);
}

function countryById(id) {
  return state.countries.find((c) => c.id === id) || null;
}

function currency() {
  return state.country ? state.country.currency : "USD";
}

function pendingList() {
  return isAdmin() ? state.globalPending : state.payments.filter((p) => p.status === "pending");
}

function dueMonths(p) {
  return dueMonthsFor(p, paymentOf);
}

function redAmount(text) {
  return `<span style="color:var(--color-red);font-weight:700">${text}</span>`;
}

/* ---------- Carga de datos ---------- */

async function loadCountries() {
  const { data, error } = await sb.from("countries").select("*").order("name");
  if (error) throw error;
  state.countries = isAdmin() ? data : data.filter((c) => c.id === ME.country_id);
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

async function loadGlobalPending() {
  if (!isAdmin()) return;
  const { data, error } = await sb
    .from("payments")
    .select("*, instructor:profiles!payments_instructor_id_fkey(*)")
    .eq("status", "pending")
    .order("created_at");
  if (error) throw error;
  state.globalPending = data;
}

async function refresh() {
  try {
    await Promise.all([loadCountryData(), loadGlobalPending()]);
  } catch (e) {
    toast(errMsg(e), true);
  }
  renderAll();
}

/* ---------- Render ---------- */

function renderAll() {
  $("title").textContent = state.country ? t("dir.title_country", { country: state.country.name }) : t("dir.title");
  $("fee-note").textContent = t("dir.fee_note", { fee: state.country ? fmtMoney(state.country.default_fee, currency()) : "—" });

  const pendingCount = pendingList().length;
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

  const stat = (cls, label, value) =>
    `<div class="stat ${cls}"><div class="label">${esc(t(label))}</div><div class="value">${value}</div></div>`;
  $("month-stats").innerHTML =
    stat("", "stat.instructors", rows.length) +
    stat("green", "stat.approved", counts.approved) +
    stat("yellow", "stat.to_validate", counts.pending) +
    stat("red", isCurrentOrFuture ? "stat.unpaid_yet" : "stat.owe", counts.missing + counts.rejected) +
    stat("green", "stat.collected", fmtMoney(collected, currency())) +
    stat("", "stat.expected", fmtMoney(expected, currency()));

  const order = { pending: 0, rejected: 1, due: 2, upcoming: 2, approved: 3 };
  rows.sort((a, b) => order[monthStatus(a.pay, period)] - order[monthStatus(b.pay, period)]
    || (a.p.full_name || "").localeCompare(b.p.full_name || ""));

  $("month-body").innerHTML = rows.map(({ p, pay }) => {
    const status = monthStatus(pay, period);
    const due = dueMonths(p).length;
    let actions;
    if (pay) {
      const validate = pay.status === "pending" && isAdmin();
      actions = `<button class="btn sm ${validate ? "primary" : "ghost"}" data-review="${pay.id}">${esc(t(validate ? "dir.validate" : "dir.view"))}</button>`;
    } else {
      actions = `<button class="btn sm ghost" data-manual="${p.id}" data-period="${period}">${esc(t("dir.register"))}</button>`;
    }
    return `<tr>
      <td><strong>${esc(p.full_name || t("common.no_name"))}</strong><div class="sub">${esc(p.email)}${p.role === "director" ? " · " + esc(t("dir.director_tag")) : ""}</div></td>
      <td>${chip(status)}</td>
      <td class="num">${fmtMoney(feeFor(p, state.country), currency())}</td>
      <td class="num">${pay ? fmtMoney(pay.amount, pay.currency) : "—"}</td>
      <td>${pay ? fmtDate(pay.paid_on) : "—"}</td>
      <td class="num">${due ? redAmount(due) : "0"}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">${esc(t(state.country ? "dir.no_rows_month" : "dir.choose_country"))}</td></tr>`;
}

function renderPending() {
  const admin = isAdmin();
  $("pending-title").textContent = t(admin ? "dir.pending_title_admin" : "dir.pending_title_dir");
  $("pending-note").innerHTML = admin ? "" : `<div class="banner info">${esc(t("dir.pending_note_dir"))}</div>`;
  document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", !admin));

  const list = [...pendingList()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  $("pending-body").innerHTML = list.map((pay) => {
    const p = pay.instructor || person(pay.instructor_id) || {};
    const c = countryById(p.country_id);
    return `<tr>
      <td><strong>${esc(p.full_name || p.email || "—")}</strong></td>
      ${admin ? `<td>${esc(c ? c.name : "—")}</td>` : ""}
      <td>${fmtPeriod(pay.period)}</td>
      <td class="num">${fmtMoney(pay.amount, pay.currency)}</td>
      <td>${fmtDate(pay.paid_on)}</td>
      <td>${esc(methodLabel(pay.method))}</td>
      <td>${fmtDate(pay.updated_at)}</td>
      <td class="actions"><button class="btn sm ${admin ? "primary" : "ghost"}" data-review="${pay.id}">${esc(t(admin ? "dir.validate" : "dir.view"))}</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="${admin ? 8 : 7}" class="empty">${esc(t("dir.no_pending"))}</td></tr>`;
}

// Lo que puede hacer el usuario actual sobre una persona del listado.
function canManagePerson(p) {
  return isAdmin() || p.role === "instructor";
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
      if (st === "pending") actions += `<button class="btn sm success" data-activate="${p.id}">${esc(t("user.activate"))}</button> `;
      actions += `<button class="btn sm ghost" data-edit-user="${p.id}">${esc(t("common.edit"))}</button> `;
      actions += st === "left"
        ? `<button class="btn sm ghost" data-activate="${p.id}">${esc(t("user.reactivate"))}</button>`
        : `<button class="btn sm ghost" data-deactivate="${p.id}">${esc(t("user.deactivate"))}</button>`;
    }
    return `<tr>
      <td><strong>${esc(p.full_name || t("common.no_name"))}</strong>
        <div class="sub">${p.role === "director" ? esc(t("dir.director_tag")) + " · " : ""}${esc(t("dir.registered", { date: fmtDate(p.created_at) }))}</div></td>
      <td><span dir="ltr">${esc(p.email)}</span><div class="sub" dir="ltr">${esc(p.phone || "")}</div></td>
      <td>${accountChip(p)}</td>
      <td class="num">${fmtMoney(feeFor(p, state.country), currency())}${p.monthly_fee === null ? `<div class="sub">${esc(t("dir.country_fee"))}</div>` : ""}</td>
      <td>${fmtPeriod(p.start_month)}</td>
      <td class="num">${due.length
        ? redAmount(`${due.length} · ${fmtMoney(due.length * feeFor(p, state.country), currency())}`)
        : esc(t("dir.up_to_date"))}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">${esc(t(state.country ? "dir.no_instructors" : "dir.choose_country"))}</td></tr>`;
}

function openPersonForm(p) {
  openUserForm({
    user: p,
    roles: isAdmin() ? ["instructor", "director"] : null,
    countries: null,
    country: state.country,
    onSaved: refresh,
  });
}

/* ---------- Acciones ---------- */

function openReview(paymentId) {
  const pay = state.payments.find((p) => p.id === paymentId) || state.globalPending.find((p) => p.id === paymentId);
  if (!pay) return;
  const p = pay.instructor || person(pay.instructor_id) || {};
  openPaymentReview({ pay, person: p, country: countryById(p.country_id) || state.country, onDone: refresh });
}

/*
 * Pago cargado en nombre de un instructor (ej. efectivo). Si lo carga un
 * admin queda aprobado; si lo carga un director queda pendiente hasta que
 * un admin lo apruebe.
 */
function openManualPayment(personId, period) {
  const p = person(personId);
  const admin = isAdmin();
  const { el, close } = openModal(t("man.title", { name: p.full_name || p.email }), `
    <form id="m-form" novalidate>
      ${admin ? "" : `<div class="banner info">${esc(t("man.pending_note"))}</div>`}
      <div class="grid-2">
        <div class="field">
          <label>${esc(t("man.month"))}</label>
          <input class="input" value="${fmtPeriod(period)}" disabled />
        </div>
        <div class="field">
          <label for="m-amount">${esc(t("man.amount", { cur: currency() }))}</label>
          <input class="input" id="m-amount" type="number" min="0.01" step="0.01" value="${feeFor(p, state.country) || ""}" />
        </div>
        <div class="field">
          <label for="m-date">${esc(t("man.date"))}</label>
          <input class="input" id="m-date" type="date" value="${todayISO()}" max="${todayISO()}" />
        </div>
        <div class="field">
          <label for="m-method">${esc(t("man.method"))}</label>
          <select class="input" id="m-method">${methodOptions("cash")}</select>
        </div>
      </div>
      <div class="field">
        <label for="m-file">${esc(t("man.file"))}</label>
        <input class="input" id="m-file" type="file" accept="image/*,application/pdf" />
      </div>
      <div class="field">
        <label for="m-note">${esc(t("man.note"))}</label>
        <textarea class="input" id="m-note"></textarea>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" id="m-cancel">${esc(t("common.cancel"))}</button>
        <button type="submit" class="btn ${admin ? "success" : "primary"}" id="m-submit">${esc(t(admin ? "man.submit" : "man.submit_pending"))}</button>
      </div>
    </form>`);

  el.querySelector("#m-cancel").addEventListener("click", close);
  el.querySelector("#m-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = Number(el.querySelector("#m-amount").value);
    if (!(amount > 0)) return toast(t("inst.err_amount"), true);
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
        status: admin ? "approved" : "pending",
      });
      if (error) throw error;
      close();
      toast(t(admin ? "man.done" : "man.done_pending"));
      await refresh();
    } catch (err) {
      toast(errMsg(err), true);
      btn.disabled = false;
    }
  });
}

function exportMonth() {
  const period = state.period;
  const rows = [[
    "col.instructor", "common.email", "col.month", "col.status", "col.fee", "col.amount_paid",
    "col.currency", "col.payment_date", "col.method", "col.reference", "col.comment",
  ].map((k) => t(k))];
  state.people
    .filter((p) => billable(p, period) || paymentOf(p.id, period))
    .forEach((p) => {
      const pay = paymentOf(p.id, period);
      rows.push([
        p.full_name, p.email, period.slice(0, 7), statusLabel(monthStatus(pay, period)),
        feeFor(p, state.country), pay ? pay.amount : "", currency(),
        pay ? pay.paid_on : "", pay ? methodLabel(pay.method) : "", pay ? pay.reference : "", pay ? pay.review_comment : "",
      ]);
    });
  downloadCSV(`ikmf-${state.country ? state.country.code : "country"}-${period.slice(0, 7)}.csv`, rows);
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["month", "pending", "instructors"].forEach((x) => $(`tab-${x}`).classList.toggle("hidden", x !== tab));
}

/* ---------- Init ---------- */

document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.review) openReview(b.dataset.review);
  if (b.dataset.manual) openManualPayment(b.dataset.manual, b.dataset.period);
  if (b.dataset.editUser) openPersonForm(person(b.dataset.editUser));
  if (b.dataset.deactivate) openDeactivateForm(person(b.dataset.deactivate), refresh);
  if (b.dataset.activate) reactivateUser(person(b.dataset.activate), refresh);
  if (b.dataset.tab) setTab(b.dataset.tab);
});

(async function init() {
  if (!(await requireRole(["director", "admin"]))) return;

  const main = document.querySelector("main");
  if (ME.role === "director" && !ME.active) {
    main.innerHTML = `<div class="banner warn">${esc(t("dir.inactive_director"))}</div>`;
    return;
  }

  $("subtitle").textContent = t(isAdmin() ? "dir.subtitle" : "dir.subtitle_dir");
  $("tabs").querySelector('[data-tab="pending"] [data-i18n]').textContent = t(isAdmin() ? "dir.tab_pending" : "dir.tab_pending_dir");

  try {
    await loadCountries();
  } catch (e) {
    return toast(errMsg(e), true);
  }

  const sel = $("country-select");
  if (isAdmin()) {
    sel.classList.remove("hidden");
    sel.innerHTML = state.countries.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    let saved = new URLSearchParams(location.search).get("country");
    if (!saved) {
      try { saved = localStorage.getItem("ikmf.country"); } catch { /* sin storage */ }
    }
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
      main.innerHTML = `<div class="banner warn">${esc(t("dir.no_country"))}</div>`;
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
  if (isAdmin()) $("new-user-btn").textContent = t("dir.new_instr_or_dir");

  await refresh();
})();
