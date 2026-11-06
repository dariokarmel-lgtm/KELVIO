/*
 * Panel de país (director / admin): pagos del mes, comprobantes pendientes
 * y gestión de instructores. Un director solo ve su país (RLS) y NO aprueba
 * ni rechaza: eso lo hace únicamente un admin (lo fuerza la base). El admin
 * ve todos los países juntos por defecto y puede filtrar uno con el selector.
 */

const state = {
  countries: [],
  country: null,      // null = todos los países o una región (solo admin)
  region: null,       // admin: región elegida en el selector (con country = null)
  people: [],         // perfiles que este usuario puede ver (del país o de todos)
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

// Vista de varios países (todos o una región): cada fila muestra su país.
function allCountries() {
  return isAdmin() && !state.country;
}

// ¿Esta persona entra en la región elegida? (sin región elegida, todas)
function inRegion(p) {
  if (!state.region) return true;
  const c = countryById(p && p.country_id);
  return !!c && c.region === state.region;
}

// País de una persona (en la vista "todos" cada fila tiene el suyo).
function countryOf(p) {
  return countryById(p.country_id) || state.country;
}

function currencyOf(p) {
  const c = countryOf(p);
  return c ? c.currency : "USD";
}

function pendingList() {
  if (!isAdmin()) return state.payments.filter((p) => p.status === "pending");
  return state.globalPending.filter((pay) => state.country
    ? pay.instructor && pay.instructor.country_id === state.country.id
    : inRegion(pay.instructor));
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
  registerCountries(data);
}

async function loadCountryData() {
  if (!state.country && !isAdmin()) {
    state.people = [];
    state.payments = [];
    return;
  }
  const people = await fetchAll(() => {
    let q = sb.from("profiles").select("*").neq("role", "admin").neq("id", ME.id).order("full_name");
    if (state.country) q = q.eq("country_id", state.country.id);
    return q;
  });
  state.people = people.filter(inRegion);

  if (allCountries()) {
    // Admin, todos los países o una región: RLS ya deja ver todo; se
    // excluyen los pagos del admin y los de fuera de la región.
    const ids = new Set(state.people.map((p) => p.id));
    state.payments = (await fetchAll(() => sb.from("payments").select("*").order("created_at")))
      .filter((p) => ids.has(p.instructor_id));
    return;
  }
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
  $("title").textContent = state.country
    ? t("dir.title_country", { country: state.country.name })
    : state.region
      ? t("dir.title_country", { country: regionLabel(state.region) })
      : t(allCountries() ? "dir.title_all" : "dir.title");
  $("fee-note").textContent = state.country
    ? t("dir.fee_note", { fee: fmtMoney(state.country.default_fee, state.country.currency) })
    : t("dir.fee_note_all");

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
  $("month-input").innerHTML = monthSelectOptions(period);
  const isCurrentOrFuture = period >= currentPeriod();

  const rows = state.people
    .filter((p) => billable(p, period) || paymentOf(p.id, period))
    .map((p) => ({ p, pay: paymentOf(p.id, period) }));

  registerPayments(state.payments);
  const counts = { approved: 0, pending: 0, rejected: 0, missing: 0, covered: 0 };
  const collected = [], expected = [];
  rows.forEach(({ p, pay }) => {
    if (billable(p, period)) expected.push({ amount: feeFor(p, countryOf(p)), currency: currencyOf(p) });
    if (!monthSettled(p.id, period, pay)) counts.missing++;
    else if (pay && pay.status !== "rejected") counts[pay.status]++;
    else counts.covered++;
    if (pay && pay.status === "approved") collected.push(pay);
  });
  const money = (items) => `<span style="font-size:${allCountries() ? ".7em" : "1em"}">${sumByCurrency(items)}</span>`;

  const stat = (cls, label, value) =>
    `<div class="stat ${cls}"><div class="label">${esc(t(label))}</div><div class="value">${value}</div></div>`;
  $("month-stats").innerHTML =
    stat("", "stat.instructors", rows.length) +
    stat("green", "stat.approved", counts.approved + counts.covered) +
    stat("yellow", "stat.to_validate", counts.pending) +
    stat("red", isCurrentOrFuture ? "stat.unpaid_yet" : "stat.owe", counts.missing) +
    stat("green", "stat.collected", money(collected)) +
    stat("", "stat.expected", money(expected));

  const order = { pending: 0, rejected: 1, due: 2, upcoming: 2, covered: 3, approved: 3 };
  rows.sort((a, b) => order[monthStatus(a.pay, period, a.p.id)] - order[monthStatus(b.pay, period, b.p.id)]
    || (a.p.full_name || "").localeCompare(b.p.full_name || ""));

  $("month-body").innerHTML = rows.map(({ p, pay }) => {
    const status = monthStatus(pay, period, p.id);
    const due = dueMonths(p).length;
    let actions;
    if (pay) {
      const validate = pay.status === "pending" && isAdmin();
      actions = `<button class="btn sm ${validate ? "primary" : "ghost"}" data-review="${pay.id}">${esc(t(validate ? "dir.validate" : "dir.view"))}</button>`;
    } else {
      actions = `<button class="btn sm ghost" data-manual="${p.id}" data-period="${period}">${esc(t("dir.register"))}</button>`;
    }
    return `<tr${pay ? ` class="row-link" data-review="${pay.id}"` : ""}>
      <td>${pay ? payNameLink(p.full_name || t("common.no_name"), pay) : `<strong>${esc(p.full_name || t("common.no_name"))}</strong>`}<div class="sub">${countryTag(p)}${esc(p.email)}${p.role === "director" ? " · " + esc(t("dir.director_tag")) : ""}</div></td>
      <td>${chip(status)}</td>
      <td class="num">${fmtMoney(feeFor(p, countryOf(p)), currencyOf(p))}</td>
      <td class="num">${pay ? fmtMoney(pay.amount, pay.currency) : "—"}</td>
      <td>${pay ? fmtDate(pay.paid_on) : "—"}</td>
      <td class="num">${due ? redAmount(due) : "0"}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">${esc(t(state.country || allCountries() ? "dir.no_rows_month" : "dir.choose_country"))}</td></tr>`;
}

// En la vista de todos los países, cada fila muestra su país.
function countryTag(p) {
  if (!allCountries()) return "";
  const c = countryById(p.country_id);
  return `<strong>${esc(c ? c.name : "—")}</strong> · `;
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
    return `<tr class="row-link" data-review="${pay.id}">
      <td>${payNameLink(p.full_name || p.email || "—", pay)}</td>
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
      if (st !== "left") actions += ` <button class="btn sm ghost" data-resend="${p.id}">${esc(t("user.resend"))}</button>`;
    }
    return `<tr>
      <td><strong>${esc(p.full_name || t("common.no_name"))}</strong>
        <div class="sub">${countryTag(p)}${p.role === "director" ? esc(t("dir.director_tag")) + " · " : ""}${esc(t("dir.registered", { date: fmtDate(p.created_at) }))}</div></td>
      <td><span dir="ltr">${esc(p.email)}</span><div class="sub" dir="ltr">${esc(p.phone || "")}</div></td>
      <td>${accountChip(p)}</td>
      <td class="num">${fmtMoney(feeFor(p, countryOf(p)), currencyOf(p))}${p.monthly_fee === null ? `<div class="sub">${esc(t("dir.country_fee"))}</div>` : ""}</td>
      <td>${fmtPeriod(startMonthFor(p))}</td>
      <td class="num">${due.length
        ? redAmount(`${due.length} · ${fmtMoney(due.length * feeFor(p, countryOf(p)), currencyOf(p))}`)
        : esc(t("dir.up_to_date"))}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">${esc(t(state.country || allCountries() ? "dir.no_instructors" : "dir.choose_country"))}</td></tr>`;
}

// El admin elige el país en el formulario (por defecto, el filtrado); el
// director siempre da de alta en su país.
function openPersonForm(p) {
  openUserForm({
    user: p,
    roles: isAdmin() ? ["instructor", "director"] : null,
    countries: isAdmin() ? state.countries : null,
    country: state.country,
    onSaved: refresh,
  });
}

/* ---------- Acciones ---------- */

function openReview(paymentId) {
  const pay = state.payments.find((p) => p.id === paymentId) || state.globalPending.find((p) => p.id === paymentId);
  if (!pay) return;
  const p = pay.instructor || person(pay.instructor_id) || {};
  openPaymentReview({ pay, person: p, country: countryOf(p), onDone: refresh });
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
          <label for="m-amount">${esc(t("man.amount", { cur: currencyOf(p) }))}</label>
          <input class="input" id="m-amount" type="number" min="0.01" step="0.01" value="${feeFor(p, countryOf(p)) || ""}" />
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
        ${fileField("m-file")}
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
        currency: currencyOf(p),
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

/*
 * Pago grupal: un director (o admin) registra un solo pago que cubre a
 * varios instructores de un país, por uno o más meses, con uno o más
 * comprobantes y observaciones. Se crea un payment_group y una fila de
 * payments por instructor y mes (unidas por group_id). Lo cargado por un
 * director queda pendiente hasta que un admin lo apruebe.
 */
async function openGroupPayment() {
  const admin = isAdmin();
  let country = state.country || (admin ? null : state.countries[0]);
  const countryPick = admin && !state.country
    ? `<div class="field"><label for="g-country">${esc(t("common.country"))}</label>
        <select class="input" id="g-country"><option value="">${esc(t("grp.pick_country"))}</option>
        ${state.countries.filter(inRegion).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>`
    : "";
  const { el, close } = openModal(t("grp.title"), `
    <form id="g-form" novalidate>
      <div class="banner info">${esc(t(admin ? "grp.intro_admin" : "grp.intro"))}</div>
      ${countryPick}
      <div class="grid-2">
        <div class="field">
          <label for="g-month">${esc(t("grp.from_month"))}</label>
          <select class="input" id="g-month">${monthSelectOptions(state.period)}</select>
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
          <select class="input" id="g-method">${methodOptions("transfer")}</select>
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
  const candidates = () => {
    if (!country) return [];
    const list = state.people.filter((p) => p.country_id === country.id && p.active && p.role === "instructor");
    if (ME.role === "director" && ME.country_id === country.id) list.unshift(ME);
    return list;
  };
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
    picked.forEach((v, id) => {
      const p = candidates().find((x) => x.id === id);
      if (!p) return;
      const n = openPeriods(p).length;
      if (!n) return;
      people++; rows += n; total += n * (Number(v.amount) || 0);
    });
    const cur = country ? country.currency : "USD";
    q("#g-total").innerHTML = people
      ? esc(t("grp.total", { people, months: rows, total: fmtMoney(total, cur) }))
      : `<span class="sub">${esc(t(country ? "grp.none_selected" : "grp.pick_country"))}</span>`;
    return { total, rows, people };
  }

  function renderPeople() {
    const term = q("#g-search").value.trim().toLowerCase();
    const list = candidates().filter((p) => !term || `${p.full_name} ${p.email}`.toLowerCase().includes(term));
    if (!country) {
      q("#g-body").innerHTML = `<tr><td colspan="5" class="empty">${esc(t("grp.pick_country"))}</td></tr>`;
    } else if (!list.length) {
      q("#g-body").innerHTML = `<tr><td colspan="5" class="empty">${esc(t("grp.no_people"))}</td></tr>`;
    } else {
      q("#g-body").innerHTML = list.map((p) => {
        const open = openPeriods(p);
        const total = periods().length;
        const sel = picked.has(p.id);
        const v = picked.get(p.id) || { amount: feeFor(p, country), note: "" };
        const monthsTxt = open.length === total ? t("grp.all_months", { n: total })
          : open.length ? t("grp.some_months", { n: open.length, total }) : t("grp.already_paid");
        return `<tr data-pid="${p.id}" class="${open.length ? "" : "muted"}">
          <td><input type="checkbox" data-pick="${p.id}" ${sel && open.length ? "checked" : ""} ${open.length ? "" : "disabled"} /></td>
          <td><strong>${esc(p.full_name || "—")}${p.id === ME.id ? ` (${esc(t("grp.me"))})` : ""}</strong><div class="sub" dir="ltr">${esc(p.email)}</div></td>
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
    country = countryById(e.target.value);
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
    if (!country) return toast(t("grp.pick_country"), true);
    const { total, people } = renderTotal();
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
        country_id: country.id,
        paid_on: q("#g-date").value || todayISO(),
        method: q("#g-method").value,
        reference: q("#g-ref").value.trim() || null,
        note: q("#g-note").value.trim() || null,
        total_amount: total,
        currency: country.currency,
        created_by: ME.id,
      });
      if (e1) throw e1;
      const paths = [];
      for (let i = 0; i < files.length; i++) paths.push(await uploadGroupReceipt(groupId, files[i], i));
      const { error: e2 } = await sb.from("payment_groups").update({ receipt_paths: paths }).eq("id", groupId);
      if (e2) throw e2;

      const base = {
        currency: country.currency,
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
          const row = { ...base, instructor_id: id, period, amount: Number(v.amount), note: v.note.trim() || null };
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
      await refresh();
    } catch (err) {
      // Si no se llegó a cargar ningún pago, se borra el grupo vacío.
      if (!saved) await sb.from("payment_groups").delete().eq("id", groupId);
      toast(errMsg(err), true);
      btn.disabled = false;
      btn.textContent = t(admin ? "grp.submit_admin" : "grp.submit");
    }
  });

  if (country) await reload(); else renderPeople();
}

// Nombre de archivo y título según el filtro (país, región o todos).
function exportScopeName() {
  if (state.country) return { code: state.country.code, label: state.country.name };
  if (state.region) return { code: state.region, label: regionLabel(state.region) };
  return { code: "all", label: t("adm.all_countries") };
}

function monthRows() {
  const period = state.period;
  const rows = [[
    "col.instructor", "common.email", "common.country", "col.month", "col.status", "col.fee", "col.amount_paid",
    "col.currency", "col.payment_date", "col.method", "col.reference", "col.comment",
  ].map((k) => t(k))];
  state.people
    .filter((p) => billable(p, period) || paymentOf(p.id, period))
    .forEach((p) => {
      const pay = paymentOf(p.id, period);
      rows.push([
        p.full_name, p.email, (countryOf(p) || {}).name || "", fmtPeriod(period), statusLabel(monthStatus(pay, period, p.id)),
        feeFor(p, countryOf(p)), pay ? Number(pay.amount) : "", currencyOf(p),
        pay ? pay.paid_on : "", pay ? methodLabel(pay.method) : "", pay ? pay.reference : "", pay ? pay.review_comment : "",
      ]);
    });
  return { title: `${t("exp.month_title")} — ${fmtPeriod(period)} — ${exportScopeName().label}`, rows };
}

function pendingRows() {
  const rows = [[
    "col.instructor", "common.email", "common.country", "col.month", "col.amount", "col.currency",
    "col.paid_on", "col.method", "col.reference", "col.sent",
  ].map((k) => t(k))];
  [...pendingList()].sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach((pay) => {
    const p = pay.instructor || person(pay.instructor_id) || {};
    const c = countryById(p.country_id);
    rows.push([p.full_name || "", p.email || "", c ? c.name : "", fmtPeriod(pay.period), Number(pay.amount), pay.currency,
      pay.paid_on, methodLabel(pay.method), pay.reference || "", fmtDate(pay.updated_at)]);
  });
  return { title: `${t("exp.pending_title")} — ${exportScopeName().label}`, rows };
}

function instructorRows() {
  const showLeft = $("show-left").checked;
  const rows = [[
    "col.instructor", "common.email", "common.phone", "common.country", "common.role", "col.status", "col.fee",
    "col.currency", "col.start", "col.due_months", "col.debt", "rv.valid_until",
  ].map((k) => t(k))];
  state.people
    .filter((p) => showLeft || accountState(p) !== "left")
    .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""))
    .forEach((p) => {
      const due = dueMonths(p).length;
      const fee = feeFor(p, countryOf(p));
      const until = coverageEnd(p.id);
      rows.push([p.full_name || "", p.email, p.phone || "", (countryOf(p) || {}).name || "", roleLabel(p.role), accountLabel(p),
        fee, currencyOf(p), fmtPeriod(startMonthFor(p)), due, due * fee, until ? fmtDate(until) : ""]);
    });
  return { title: `${t("exp.instructors_title")} — ${exportScopeName().label}`, rows };
}

function exportScope(scope, format) {
  const builders = { month: monthRows, pending: pendingRows, instructors: instructorRows };
  const suffix = scope === "month" ? `-${state.period.slice(0, 7)}` : `-${todayISO()}`;
  runExport(format, `ikmf-${scope}-${exportScopeName().code}${suffix}`, builders[scope]);
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["month", "pending", "instructors"].forEach((x) => $(`tab-${x}`).classList.toggle("hidden", x !== tab));
}

/* ---------- Init ---------- */

document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) {
    // Tocar cualquier parte de la fila de un pago abre su comprobante.
    const row = e.target.closest("tr[data-review]");
    if (row) openReview(row.dataset.review);
    return;
  }
  if (b.dataset.export) {
    const [scope, format] = b.dataset.export.split(":");
    return exportScope(scope, format);
  }
  if (b.dataset.review) openReview(b.dataset.review);
  if (b.dataset.manual) openManualPayment(b.dataset.manual, b.dataset.period);
  if (b.dataset.editUser) openPersonForm(person(b.dataset.editUser));
  if (b.dataset.deactivate) openDeactivateForm(person(b.dataset.deactivate), refresh);
  if (b.dataset.activate) reactivateUser(person(b.dataset.activate), refresh);
  if (b.dataset.resend) resendAccess(person(b.dataset.resend));
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
    // Por defecto, todos los países. Se puede elegir una región o un país;
    // ?country=<id> o ?region=<región> (p. ej. desde el dashboard) lo preselecciona.
    const applyFilter = (value) => {
      state.region = value && value.startsWith("r:") ? value.slice(2) : null;
      state.country = state.region ? null : state.countries.find((c) => c.id === value) || null;
    };
    const params = new URLSearchParams(location.search);
    applyFilter(params.get("region") ? `r:${params.get("region")}` : params.get("country") || "");
    const current = state.region ? `r:${state.region}` : state.country ? state.country.id : "";
    sel.innerHTML = regionCountryOptions(state.countries, current);
    sel.addEventListener("change", () => {
      applyFilter(sel.value);
      const qs = state.region ? `?region=${state.region}` : state.country ? `?country=${state.country.id}` : "";
      history.replaceState(null, "", qs || location.pathname);
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
  $("exp-month").innerHTML = exportButtons("month");
  $("exp-pending").innerHTML = exportButtons("pending");
  $("exp-instructors").innerHTML = exportButtons("instructors");
  $("show-left").addEventListener("change", renderInstructors);
  $("new-user-btn").addEventListener("click", () => openPersonForm(null));
  $("group-btn").addEventListener("click", openGroupPayment);
  if (isAdmin()) $("new-user-btn").textContent = t("dir.new_instr_or_dir");

  await refresh();
})();
