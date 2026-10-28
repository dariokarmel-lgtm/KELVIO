/*
 * Pantalla del instructor: estado mes por mes de sus cuotas y carga de
 * pagos con comprobante. Cualquier carga o corrección queda "En revisión"
 * hasta que un admin la aprueba (lo fuerza la base, no el JS).
 */

let payments = []; // pagos propios

function $(id) { return document.getElementById(id); }

function paymentFor(period) {
  return payments.find((p) => p.period === period);
}

function myFee() {
  return feeFor(ME, ME.country);
}

function myCurrency() {
  return ME.country ? ME.country.currency : "USD";
}

async function loadPayments() {
  const { data, error } = await sb
    .from("payments")
    .select("*")
    .eq("instructor_id", ME.id)
    .order("period", { ascending: false });
  if (error) throw error;
  payments = data;
}

function render() {
  const fee = myFee();
  $("fee-line").textContent = ME.country
    ? t("inst.fee_line", { country: ME.country.name, fee: fmtMoney(fee, myCurrency()), month: fmtPeriod(ME.start_month) })
    : t("inst.no_country");

  const banner = $("banner");
  let warn = "";
  if (ME.end_month) warn = t("inst.banner_left", { month: fmtPeriod(addMonths(ME.end_month, 1)) });
  else if (!ME.country) warn = t("inst.banner_no_country");
  else if (!ME.active) warn = t("inst.banner_pending", { country: ME.country.name });
  banner.innerHTML = warn ? `<div class="banner warn">${esc(warn)}</div>` : "";
  $("new-payment-btn").disabled = !ME.active;

  // Meses desde el inicio hasta el actual, más cualquier pago adelantado.
  const now = currentPeriod();
  const lastBillable = ME.end_month && ME.end_month < now ? ME.end_month : now;
  const lastPeriod = payments.reduce((max, p) => (p.period > max ? p.period : max), lastBillable);
  const periods = periodsBetween(ME.start_month, lastPeriod);
  payments.forEach((p) => { if (!periods.includes(p.period)) periods.push(p.period); });
  periods.sort().reverse();

  let approved = 0, pending = 0, due = 0, paidTotal = 0;
  const rows = periods.map((period) => {
    const p = paymentFor(period);
    const status = monthStatus(p, period);
    if (status === "approved") { approved++; paidTotal += Number(p.amount); }
    if (status === "pending") pending++;
    if (status === "due" || status === "rejected") due++;

    let detail = "";
    if (p) {
      detail = [p.method ? methodLabel(p.method) : "", p.reference].filter(Boolean).map(esc).join(" · ");
      if (p.status === "rejected" && p.review_comment) {
        detail += `<div class="sub" style="color:var(--color-red)">${esc(t("inst.reason", { text: p.review_comment }))}</div>`;
      } else if (p.status === "approved" && p.reviewed_at) {
        detail += `<div class="sub">${esc(t("inst.validated_on", { date: fmtDate(p.reviewed_at) }))}</div>`;
      }
    }

    let actions = "";
    if (p && p.receipt_path) {
      actions += `<button class="btn sm ghost" data-receipt="${esc(p.receipt_path)}">${esc(t("inst.view_receipt"))}</button> `;
    }
    if (ME.active) {
      if (!p) actions += `<button class="btn sm primary" data-pay="${period}">${esc(t("inst.pay"))}</button>`;
      else if (p.status === "rejected") actions += `<button class="btn sm primary" data-edit="${p.id}">${esc(t("inst.resend"))}</button>`;
      else if (p.status === "pending") actions += `<button class="btn sm ghost" data-edit="${p.id}">${esc(t("common.edit"))}</button>`;
    }

    return `<tr>
      <td><strong>${fmtPeriod(period)}</strong></td>
      <td>${chip(status)}</td>
      <td class="num">${p ? fmtMoney(p.amount, p.currency) : `<span class="sub">${fmtMoney(fee, myCurrency())}</span>`}</td>
      <td>${p ? fmtDate(p.paid_on) : "—"}</td>
      <td>${detail || '<span class="sub">—</span>'}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  });

  $("months-body").innerHTML = rows.join("") || `<tr><td colspan="6" class="empty">${esc(t("inst.no_months"))}</td></tr>`;

  $("stats").innerHTML = `
    <div class="stat green"><div class="label">${esc(t("stat.approved_months"))}</div><div class="value">${approved}</div></div>
    <div class="stat yellow"><div class="label">${esc(t("stat.in_review"))}</div><div class="value">${pending}</div></div>
    <div class="stat red"><div class="label">${esc(t("stat.owed_months"))}</div><div class="value">${due}</div></div>
    <div class="stat red"><div class="label">${esc(t("stat.est_debt"))}</div><div class="value">${fmtMoney(due * fee, myCurrency())}</div></div>
    <div class="stat"><div class="label">${esc(t("stat.total_paid"))}</div><div class="value">${fmtMoney(paidTotal, myCurrency())}</div></div>`;
}

/*
 * Formulario de carga / corrección. `existing` es el pago a editar
 * (pendiente o rechazado); si no, `period` preselecciona el mes.
 */
function openPaymentForm({ existing, period } = {}) {
  const now = currentPeriod();
  // Meses elegibles: desde el inicio hasta 3 meses adelantados, sin pago cargado.
  const options = periodsBetween(ME.start_month, addMonths(now, 3))
    .filter((p) => !paymentFor(p) || (existing && existing.period === p));
  const selected = existing ? existing.period : period || options.find((p) => p <= now && !paymentFor(p)) || now;

  if (!existing && options.length === 0) {
    toast(t("inst.no_pending_months"));
    return;
  }

  const submitLabel = t(existing ? "inst.submit_fix" : "inst.submit_new");
  const { el, close } = openModal(existing ? t("inst.form_title_fix", { month: fmtPeriod(existing.period) }) : t("inst.form_title_new"), `
    ${existing && existing.status === "rejected" && existing.review_comment
      ? `<div class="banner error">${esc(t("inst.rejected", { text: existing.review_comment }))}</div>` : ""}
    <form id="pay-form" novalidate>
      <div class="grid-2">
        <div class="field">
          <label for="p-period">${esc(t("inst.f_month"))}</label>
          <select class="input" id="p-period" ${existing ? "disabled" : ""}>
            ${options.map((p) => `<option value="${p}" ${p === selected ? "selected" : ""}>${fmtPeriod(p)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="p-amount">${esc(t("inst.f_amount", { cur: myCurrency() }))}</label>
          <input class="input" id="p-amount" type="number" min="0.01" step="0.01" value="${existing ? existing.amount : myFee() || ""}" required />
        </div>
        <div class="field">
          <label for="p-date">${esc(t("inst.f_date"))}</label>
          <input class="input" id="p-date" type="date" value="${existing ? existing.paid_on : todayISO()}" max="${todayISO()}" required />
        </div>
        <div class="field">
          <label for="p-method">${esc(t("inst.f_method"))}</label>
          <select class="input" id="p-method">${methodOptions(existing ? existing.method : "transfer")}</select>
        </div>
      </div>
      <div class="field">
        <label for="p-ref">${esc(t("inst.f_ref"))}</label>
        <input class="input" id="p-ref" value="${esc(existing ? existing.reference : "")}" />
      </div>
      <div class="field">
        <label for="p-file">${esc(t("inst.f_file"))}</label>
        <input class="input" id="p-file" type="file" accept="image/*,application/pdf" />
        ${existing && existing.receipt_path ? `<span class="sub">${esc(t("inst.f_file_keep"))}</span>` : ""}
      </div>
      <div class="field">
        <label for="p-note">${esc(t("inst.f_note"))}</label>
        <textarea class="input" id="p-note">${esc(existing ? existing.note : "")}</textarea>
      </div>
      <div id="form-error"></div>
      <div class="modal-foot">
        ${existing && existing.status === "pending" ? `<button type="button" class="btn ghost push-start" id="p-delete">${esc(t("common.delete"))}</button>` : ""}
        <button type="button" class="btn ghost" id="p-cancel">${esc(t("common.cancel"))}</button>
        <button type="submit" class="btn primary" id="p-submit">${esc(submitLabel)}</button>
      </div>
    </form>`);

  el.querySelector("#p-cancel").addEventListener("click", close);

  const del = el.querySelector("#p-delete");
  if (del) {
    del.addEventListener("click", async () => {
      if (!confirm(t("inst.confirm_delete"))) return;
      const { error } = await sb.from("payments").delete().eq("id", existing.id);
      if (error) return toast(errMsg(error), true);
      close();
      toast(t("inst.deleted"));
      await refresh();
    });
  }

  el.querySelector("#pay-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = el.querySelector("#form-error");
    const showErr = (m) => { errBox.innerHTML = `<div class="banner error">${esc(m)}</div>`; };
    errBox.innerHTML = "";

    const periodVal = existing ? existing.period : el.querySelector("#p-period").value;
    const amount = Number(el.querySelector("#p-amount").value);
    const paidOn = el.querySelector("#p-date").value;
    const file = el.querySelector("#p-file").files[0];

    if (!(amount > 0)) return showErr(t("inst.err_amount"));
    if (!paidOn) return showErr(t("inst.err_date"));
    if (file || !existing || !existing.receipt_path) {
      const v = validateReceipt(file);
      if (v) return showErr(v);
    }

    const btn = el.querySelector("#p-submit");
    btn.disabled = true;
    btn.textContent = t("inst.sending");
    try {
      const receipt_path = file ? await uploadReceipt(ME.id, periodVal, file) : existing.receipt_path;
      const row = {
        amount,
        currency: myCurrency(),
        paid_on: paidOn,
        method: el.querySelector("#p-method").value,
        reference: el.querySelector("#p-ref").value.trim() || null,
        note: el.querySelector("#p-note").value.trim() || null,
        receipt_path,
      };
      const { error } = existing
        ? await sb.from("payments").update(row).eq("id", existing.id)
        : await sb.from("payments").insert({ ...row, instructor_id: ME.id, period: periodVal });
      if (error) throw error;
      close();
      toast(t("inst.sent"));
      await refresh();
    } catch (err) {
      showErr(errMsg(err));
      btn.disabled = false;
      btn.textContent = submitLabel;
    }
  });
}

async function refresh() {
  await loadPayments();
  render();
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.receipt) openReceipt(b.dataset.receipt);
  if (b.dataset.pay) openPaymentForm({ period: b.dataset.pay });
  if (b.dataset.edit) openPaymentForm({ existing: payments.find((p) => p.id === b.dataset.edit) });
});

(async function init() {
  if (!(await requireRole())) return;
  $("new-payment-btn").addEventListener("click", () => openPaymentForm());
  try {
    await refresh();
  } catch (e) {
    toast(errMsg(e), true);
  }
})();
