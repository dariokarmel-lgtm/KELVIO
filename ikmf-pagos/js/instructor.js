/*
 * Pantalla del instructor: estado mes por mes de sus cuotas y carga de
 * pagos con comprobante. Cualquier carga o corrección queda "En revisión"
 * hasta que el director del país la aprueba (lo fuerza la base, no el JS).
 */

let payments = []; // pagos propios

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
    ? `${ME.country.name} · Cuota mensual: ${fmtMoney(fee, myCurrency())} · Desde ${fmtPeriod(ME.start_month)}`
    : "Sin país asignado";

  const banner = $("banner");
  if (!ME.country) {
    banner.innerHTML = `<div class="banner warn">Tu cuenta no tiene país asignado. Contactá a un administrador.</div>`;
  } else if (!ME.active) {
    banner.innerHTML = `<div class="banner warn">Tu cuenta está <strong>pendiente de activación</strong>. El director de ${esc(ME.country.name)} tiene que activarla antes de que puedas cargar pagos.</div>`;
  } else {
    banner.innerHTML = "";
  }
  $("new-payment-btn").disabled = !ME.active;

  // Meses desde el inicio hasta el actual, más cualquier pago adelantado.
  const now = currentPeriod();
  const lastPeriod = payments.reduce((max, p) => (p.period > max ? p.period : max), now);
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
      detail = [p.method, p.reference].filter(Boolean).map(esc).join(" · ");
      if (p.status === "rejected" && p.review_comment) {
        detail += `<div class="sub" style="color:var(--color-red)">Motivo: ${esc(p.review_comment)}</div>`;
      } else if (p.status === "approved" && p.reviewed_at) {
        detail += `<div class="sub">Validado el ${fmtDate(p.reviewed_at)}</div>`;
      }
    }

    let actions = "";
    if (p && p.receipt_path) {
      actions += `<button class="btn sm ghost" data-receipt="${esc(p.receipt_path)}">Ver comprobante</button> `;
    }
    if (ME.active) {
      if (!p) actions += `<button class="btn sm primary" data-pay="${period}">Cargar pago</button>`;
      else if (p.status === "rejected") actions += `<button class="btn sm primary" data-edit="${p.id}">Volver a enviar</button>`;
      else if (p.status === "pending") actions += `<button class="btn sm ghost" data-edit="${p.id}">Editar</button>`;
    }

    return `<tr>
      <td><strong>${fmtPeriod(period)}</strong></td>
      <td>${chip(status)}</td>
      <td class="num">${p ? fmtMoney(p.amount, p.currency) : `<span class="sub">${fmtMoney(myFee(), myCurrency())}</span>`}</td>
      <td>${p ? fmtDate(p.paid_on) : "—"}</td>
      <td>${detail || '<span class="sub">—</span>'}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  });

  $("months-body").innerHTML = rows.join("") || `<tr><td colspan="6" class="empty">Todavía no hay meses para mostrar.</td></tr>`;

  $("stats").innerHTML = `
    <div class="stat green"><div class="label">Meses aprobados</div><div class="value">${approved}</div></div>
    <div class="stat yellow"><div class="label">En revisión</div><div class="value">${pending}</div></div>
    <div class="stat red"><div class="label">Adeudados</div><div class="value">${due}</div></div>
    <div class="stat red"><div class="label">Deuda estimada</div><div class="value">${fmtMoney(due * fee, myCurrency())}</div></div>
    <div class="stat"><div class="label">Total pagado</div><div class="value">${fmtMoney(paidTotal, myCurrency())}</div></div>`;
}

function $(id) { return document.getElementById(id); }

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
    toast("No tenés meses pendientes de carga.");
    return;
  }

  const { el, close } = openModal(existing ? `Corregir pago — ${fmtPeriod(existing.period)}` : "Cargar pago", `
    ${existing && existing.status === "rejected" && existing.review_comment
      ? `<div class="banner error">Rechazado: ${esc(existing.review_comment)}</div>` : ""}
    <form id="pay-form" novalidate>
      <div class="grid-2">
        <div class="field">
          <label for="p-period">Mes que pagás</label>
          <select class="input" id="p-period" ${existing ? "disabled" : ""}>
            ${options.map((p) => `<option value="${p}" ${p === selected ? "selected" : ""}>${fmtPeriod(p)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="p-amount">Monto (${esc(myCurrency())})</label>
          <input class="input" id="p-amount" type="number" min="0.01" step="0.01" value="${existing ? existing.amount : myFee() || ""}" required />
        </div>
        <div class="field">
          <label for="p-date">Fecha de pago</label>
          <input class="input" id="p-date" type="date" value="${existing ? existing.paid_on : todayISO()}" max="${todayISO()}" required />
        </div>
        <div class="field">
          <label for="p-method">Medio de pago</label>
          <select class="input" id="p-method">${methodOptions(existing ? existing.method : "Transferencia")}</select>
        </div>
      </div>
      <div class="field">
        <label for="p-ref">N° de operación / referencia (opcional)</label>
        <input class="input" id="p-ref" value="${esc(existing ? existing.reference : "")}" />
      </div>
      <div class="field">
        <label for="p-file">Comprobante (imagen o PDF, máx. 5 MB)${existing && existing.receipt_path ? " — dejalo vacío para mantener el actual" : ""}</label>
        <input class="input" id="p-file" type="file" accept="image/*,application/pdf" />
      </div>
      <div class="field">
        <label for="p-note">Nota para el director (opcional)</label>
        <textarea class="input" id="p-note">${esc(existing ? existing.note : "")}</textarea>
      </div>
      <div id="form-error"></div>
      <div class="modal-foot">
        ${existing && existing.status === "pending" ? `<button type="button" class="btn ghost" id="p-delete" style="margin-right:auto">Eliminar</button>` : ""}
        <button type="button" class="btn ghost" id="p-cancel">Cancelar</button>
        <button type="submit" class="btn primary" id="p-submit">${existing ? "Enviar a revisión" : "Enviar pago"}</button>
      </div>
    </form>`);

  el.querySelector("#p-cancel").addEventListener("click", close);

  const del = el.querySelector("#p-delete");
  if (del) {
    del.addEventListener("click", async () => {
      if (!confirm("¿Eliminar este pago cargado?")) return;
      const { error } = await sb.from("payments").delete().eq("id", existing.id);
      if (error) return toast(errMsg(error), true);
      close();
      toast("Pago eliminado.");
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

    if (!(amount > 0)) return showErr("Ingresá un monto válido.");
    if (!paidOn) return showErr("Indicá la fecha de pago.");
    if (file || !existing || !existing.receipt_path) {
      const v = validateReceipt(file);
      if (v) return showErr(v);
    }

    const btn = el.querySelector("#p-submit");
    btn.disabled = true;
    btn.textContent = "Enviando…";
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
      toast("Pago enviado. Queda en revisión hasta que el director lo valide.");
      await refresh();
    } catch (err) {
      showErr(errMsg(err));
      btn.disabled = false;
      btn.textContent = existing ? "Enviar a revisión" : "Enviar pago";
    }
  });
}

async function refresh() {
  await loadPayments();
  render();
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.receipt) openReceipt(t.dataset.receipt);
  if (t.dataset.pay) openPaymentForm({ period: t.dataset.pay });
  if (t.dataset.edit) openPaymentForm({ existing: payments.find((p) => p.id === t.dataset.edit) });
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
