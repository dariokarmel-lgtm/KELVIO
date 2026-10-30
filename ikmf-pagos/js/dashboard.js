/*
 * Dashboard (página de inicio del admin y del director): KPIs del mes,
 * pagos por validar, alertas de falta de pago, pagos aprobados del mes y
 * resumen por país. El admin ve todos los países y puede filtrar uno; el
 * director ve solo el suyo (lo restringe RLS) y no aprueba pagos.
 */

const state = {
  countries: [],
  people: [],    // perfiles no admin de todos los países
  payments: [],  // todos los pagos
  period: currentPeriod(),
  countryId: "", // "" = todos
};

function $(id) { return document.getElementById(id); }

function isAdmin() {
  return ME.role === "admin";
}

function person(id) {
  return state.people.find((p) => p.id === id);
}

function countryById(id) {
  return state.countries.find((c) => c.id === id) || null;
}

let paymentIndex = new Map();
function paymentOf(personId, period) {
  return paymentIndex.get(`${personId}|${period}`);
}

function inFilter(p) {
  return !state.countryId || p.country_id === state.countryId;
}

function redAmount(text) {
  return `<span style="color:var(--color-red);font-weight:700">${text}</span>`;
}

/* ---------- Carga de datos ---------- */

async function load() {
  const [countries, people, payments] = await Promise.all([
    fetchAll(() => sb.from("countries").select("*").order("name")),
    fetchAll(() => sb.from("profiles").select("*").neq("role", "admin").order("full_name")),
    fetchAll(() => sb.from("payments").select("*").order("created_at")),
  ]);
  // El director solo recibe (por RLS) su país y sus instructores; sus propios
  // pagos no se cuentan acá (los aprueba un admin).
  state.countries = isAdmin() ? countries : countries.filter((c) => c.id === ME.country_id);
  state.people = isAdmin() ? people : people.filter((p) => p.id !== ME.id);
  state.payments = isAdmin() ? payments : payments.filter((p) => p.instructor_id !== ME.id);
  paymentIndex = new Map(payments.map((p) => [`${p.instructor_id}|${p.period}`, p]));
}

async function refresh() {
  try {
    await load();
  } catch (e) {
    toast(errMsg(e), true);
  }
  render();
}

/* ---------- Render ---------- */

function render() {
  const period = state.period;
  $("month-input").value = period.slice(0, 7);

  const people = state.people.filter(inFilter);
  const ids = new Set(people.map((p) => p.id));
  const payments = state.payments.filter((p) => ids.has(p.instructor_id));

  const pending = payments.filter((p) => p.status === "pending");
  const approvedMonth = payments.filter((p) => p.status === "approved" && p.period === period);
  const billablePeople = people.filter((p) => billable(p, period));
  const unpaid = billablePeople.filter((p) => {
    const pay = paymentOf(p.id, period);
    return !pay || pay.status === "rejected";
  });
  const alerts = people
    .map((p) => ({ p, due: dueMonthsFor(p, paymentOf) }))
    .filter((x) => x.due.length)
    .sort((a, b) => b.due.length - a.due.length || (a.p.full_name || "").localeCompare(b.p.full_name || ""));
  const toActivate = people.filter((p) => accountState(p) === "pending");

  renderKpis({ approvedMonth, pending, unpaid, billablePeople, alerts, toActivate });
  renderPending(pending);
  renderAlerts(alerts);
  renderPaid(approvedMonth);
  renderCountries();
}

// Pendientes que se ven ahora (para la ventana que abre la tarjeta "Por validar").
let currentPending = [];

function renderKpis({ approvedMonth, pending, unpaid, billablePeople, alerts, toActivate }) {
  currentPending = pending;
  // `kpi` hace la tarjeta tocable: abre la ventana de pendientes o lleva a su sección.
  const stat = (cls, label, value, sub, kpi) =>
    `<div class="stat ${cls}${kpi ? " clickable" : ""}"${kpi ? ` data-kpi="${kpi}" role="button" tabindex="0"` : ""}><div class="label">${esc(t(label))}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const current = state.period >= currentPeriod();
  $("kpis").innerHTML =
    stat("green", "dash.kpi_approved", approvedMonth.length, esc(t("dash.of_billable", { n: billablePeople.length })), "paid") +
    stat("green", "dash.kpi_collected", `<span style="font-size:.8em">${sumByCurrency(approvedMonth)}</span>`, "", "paid") +
    stat("yellow", "dash.kpi_pending", pending.length, pending.length ? esc(t("dash.tap_to_validate")) : "", "pending") +
    stat("red", current ? "stat.unpaid_yet" : "dash.kpi_unpaid", unpaid.length) +
    stat("red", "dash.kpi_overdue", alerts.length, "", "alerts") +
    stat("", "dash.kpi_activation", toActivate.length);
}

function personCell(p, pay) {
  const c = countryById(p.country_id);
  const name = p.full_name || p.email || t("common.no_name");
  return `${pay ? payNameLink(name, pay) : `<strong>${esc(name)}</strong>`}
    <div class="sub">${esc(c ? c.name : "—")}${p.role === "director" ? " · " + esc(t("dir.director_tag")) : ""}</div>`;
}

function renderPending(list) {
  $("pending-badge").textContent = list.length;
  $("pending-badge").classList.toggle("hidden", !list.length);
  $("pending-body").innerHTML = list.map((pay) => {
    const p = person(pay.instructor_id) || {};
    return `<tr class="row-link" data-review="${pay.id}">
      <td>${personCell(p, pay)}</td>
      <td>${fmtPeriod(pay.period)}</td>
      <td class="num">${fmtMoney(pay.amount, pay.currency)}</td>
      <td>${fmtDate(pay.updated_at)}</td>
      <td class="actions"><button class="btn sm ${isAdmin() ? "primary" : "ghost"}" data-review="${pay.id}">${esc(t(isAdmin() ? "dir.validate" : "dir.view"))}</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" class="empty">${esc(t("dir.no_pending"))}</td></tr>`;
}

function lastApproved(personId) {
  let last = null;
  state.payments.forEach((p) => {
    if (p.instructor_id === personId && p.status === "approved" && (!last || p.period > last)) last = p.period;
  });
  return last;
}

function renderAlerts(alerts) {
  $("alerts-badge").textContent = alerts.length;
  $("alerts-badge").classList.toggle("hidden", !alerts.length);
  $("alerts-body").innerHTML = alerts.map(({ p, due }) => {
    const c = countryById(p.country_id);
    const n = due.length;
    const oldest = due[due.length - 1];
    const last = lastApproved(p.id);
    return `<tr>
      <td>${personCell(p)}</td>
      <td><span class="chip ${n >= 2 ? "due" : "pending"}">${esc(t(n === 1 ? "dash.month_one" : "dash.months_n", { n }))}</span>
        <div class="sub">${esc(t("dash.since", { month: fmtPeriod(oldest) }))}</div></td>
      <td class="num">${redAmount(fmtMoney(n * feeFor(p, c), c ? c.currency : "USD"))}</td>
      <td>${last ? fmtPeriod(last) : `<span class="sub">${esc(t("dash.never_paid"))}</span>`}</td>
      <td class="actions"><a class="btn sm ghost" href="director.html?country=${encodeURIComponent(p.country_id || "")}">${esc(t("dash.view_country"))}</a></td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" class="empty">${esc(t("dash.alerts_empty"))}</td></tr>`;
}

function renderPaid(list) {
  $("paid-title").textContent = t("dash.paid_title", { month: fmtPeriod(state.period) });
  const rows = [...list].sort((a, b) => (b.reviewed_at || "").localeCompare(a.reviewed_at || ""));
  $("paid-body").innerHTML = rows.map((pay) => {
    const p = person(pay.instructor_id) || {};
    const c = countryById(p.country_id);
    return `<tr class="row-link" data-review="${pay.id}">
      <td>${payNameLink(p.full_name || p.email || "—", pay)}</td>
      <td>${esc(c ? c.name : "—")}</td>
      <td class="num">${fmtMoney(pay.amount, pay.currency)}</td>
      <td>${fmtDate(pay.paid_on)}</td>
      <td>${esc(methodLabel(pay.method))}</td>
      <td>${fmtDate(pay.reviewed_at)}</td>
      <td class="actions"><button class="btn sm ghost" data-review="${pay.id}">${esc(t("dir.view"))}</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">${esc(t("dash.paid_empty"))}</td></tr>`;
}

function renderCountries() {
  const period = state.period;
  const rows = state.countries.filter((c) => !state.countryId || c.id === state.countryId).map((c) => {
    const people = state.people.filter((p) => p.country_id === c.id);
    const billablePeople = people.filter((p) => billable(p, period));
    let approved = 0, pending = 0, unpaid = 0, collected = 0, expected = 0;
    billablePeople.forEach((p) => {
      expected += feeFor(p, c);
      const pay = paymentOf(p.id, period);
      if (!pay || pay.status === "rejected") unpaid++;
      else if (pay.status === "pending") pending++;
      else { approved++; collected += Number(pay.amount); }
    });
    return { c, total: billablePeople.length, approved, pending, unpaid, collected, expected };
  }).filter((r) => r.total || state.countryId);

  $("countries-body").innerHTML = rows.map((r) => `<tr>
      <td><strong>${esc(r.c.name)}</strong></td>
      <td class="num">${r.total}</td>
      <td class="num">${r.approved}</td>
      <td class="num">${r.pending}</td>
      <td class="num">${r.unpaid ? redAmount(r.unpaid) : "0"}</td>
      <td class="num">${fmtMoney(r.collected, r.c.currency)}</td>
      <td class="num">${fmtMoney(r.expected, r.c.currency)}</td>
      <td class="actions"><a class="btn sm ghost" href="director.html?country=${encodeURIComponent(r.c.id)}">${esc(t("dash.view_country"))}</a></td>
    </tr>`).join("") || `<tr><td colspan="8" class="empty">${esc(t("dir.no_instructors"))}</td></tr>`;
}

function exportPaid() {
  const period = state.period;
  const ids = new Set(state.people.filter(inFilter).map((p) => p.id));
  const rows = [["col.instructor", "common.email", "common.country", "col.month", "col.amount_paid",
    "col.currency", "col.payment_date", "col.method", "col.reference", "col.reviewed_on"].map((k) => t(k))];
  state.payments
    .filter((p) => ids.has(p.instructor_id) && p.status === "approved" && p.period === period)
    .forEach((pay) => {
      const p = person(pay.instructor_id) || {};
      const c = countryById(p.country_id);
      rows.push([p.full_name, p.email, c ? c.name : "", period.slice(0, 7), pay.amount, pay.currency,
        pay.paid_on, methodLabel(pay.method), pay.reference, pay.reviewed_at ? pay.reviewed_at.slice(0, 10) : ""]);
    });
  downloadCSV(`ikmf-pagos-${period.slice(0, 7)}.csv`, rows);
}

/* ---------- Init ---------- */

function openReview(paymentId) {
  const pay = state.payments.find((p) => p.id === paymentId);
  if (!pay) return;
  const p = person(pay.instructor_id) || {};
  openPaymentReview({ pay, person: p, country: countryById(p.country_id), onDone: refresh });
}

// Ventana con todos los pagos por validar; tocar uno abre su comprobante.
function openPendingModal() {
  const rows = currentPending.map((pay) => {
    const p = person(pay.instructor_id) || {};
    const c = countryById(p.country_id);
    return `<tr class="row-link" data-review="${pay.id}">
      <td>${payNameLink(p.full_name || p.email || "—", pay)}<div class="sub">${esc(c ? c.name : "—")}</div></td>
      <td>${fmtPeriod(pay.period)}</td>
      <td class="num">${fmtMoney(pay.amount, pay.currency)}</td>
      <td class="actions"><button class="btn sm ${isAdmin() ? "primary" : "ghost"}" data-review="${pay.id}">${esc(t(isAdmin() ? "dir.validate" : "dir.view"))}</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" class="empty">${esc(t("dir.no_pending"))}</td></tr>`;
  openModal(t(isAdmin() ? "dash.pending_title" : "dir.pending_title_dir"), `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>${esc(t("col.instructor"))}</th><th>${esc(t("col.month"))}</th>
        <th class="num">${esc(t("col.amount"))}</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`, { wide: true });
}

document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-review]");
  if (target) {
    // Si viene de la ventana de pendientes, se cierra y se abre el comprobante.
    target.closest(".modal-backdrop")?.remove();
    openReview(target.dataset.review);
    return;
  }
  const kpi = e.target.closest("[data-kpi]");
  if (!kpi) return;
  if (kpi.dataset.kpi === "pending") return openPendingModal();
  const section = { paid: "paid-title", alerts: "alerts-badge" }[kpi.dataset.kpi];
  $(section)?.closest(".card")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.dataset && e.target.dataset.kpi) {
    e.preventDefault();
    e.target.click();
  }
});

(async function init() {
  if (!(await requireRole(["admin", "director"]))) return;

  if (!isAdmin()) {
    if (!ME.active || !ME.country) {
      document.querySelector("main").innerHTML =
        `<div class="banner warn">${esc(t(ME.active ? "dir.no_country" : "dir.inactive_director"))}</div>`;
      return;
    }
    // Director: su país fijo, sin selector ni resumen por país.
    state.countryId = ME.country_id;
    document.querySelector('[data-i18n="dash.title"]').textContent = t("dir.title_country", { country: ME.country.name });
    document.querySelector('[data-i18n="dash.subtitle"]').textContent = t("dash.subtitle_dir");
    document.querySelector('[data-i18n="dash.pending_title"]').textContent = t("dir.pending_title_dir");
    $("country-filter").classList.add("hidden");
    $("countries-card").classList.add("hidden");
  }

  $("month-input").addEventListener("change", (e) => {
    if (e.target.value) { state.period = `${e.target.value}-01`; render(); }
  });
  $("prev-month").addEventListener("click", () => { state.period = addMonths(state.period, -1); render(); });
  $("next-month").addEventListener("click", () => { state.period = addMonths(state.period, 1); render(); });
  $("export-btn").addEventListener("click", exportPaid);

  await refresh();

  if (!isAdmin()) return;
  const sel = $("country-filter");
  sel.innerHTML = `<option value="">${esc(t("adm.all_countries"))}</option>` +
    state.countries.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  sel.addEventListener("change", () => { state.countryId = sel.value; render(); });
})();
