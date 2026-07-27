/* Alta y edición de un switch. */

const isNew = getParam("new") === "1";
const editId = getParam("id");
let mode = getParam("mode") || "legado";
let working = null; // objeto de trabajo (no persiste hasta Guardar)

function defaultMessage(m) {
  return m === "legado" ? t("configure.default_message_legado") : t("configure.default_message_cuidame");
}

function initWorking() {
  if (!isNew && editId) {
    const existing = getSwitch(editId);
    if (existing) {
      working = JSON.parse(JSON.stringify(existing));
      mode = working.mode;
      return;
    }
  }
  // Nuevo switch con valores por defecto según el modo.
  working = {
    id: crypto.randomUUID(),
    mode,
    name: mode === "legado" ? t("configure.default_name_legado") : t("configure.default_name_cuidame"),
    intervalMs: mode === "legado" ? 7 * DAY : 90 * MIN,
    graceMs: 24 * HOUR,
    alarmMs: 90 * 1000,
    nextDue: Date.now() + (mode === "legado" ? 7 * DAY : 90 * MIN),
    recipients: [],
    verifierId: null,
    message: defaultMessage(mode),
    channels: mode === "legado"
      ? { email: true, sms: false, whatsapp: false, call: false }
      : { email: true, sms: true, whatsapp: false, call: false },
    location: mode === "sesion",
    off: false,
  };
}

function intervalToNumberUnit(ms) {
  if (mode === "legado") {
    if (ms % (7 * DAY) === 0) return { n: ms / (7 * DAY), unit: "weeks" };
    return { n: Math.round(ms / DAY), unit: "days" };
  }
  if (ms % HOUR === 0) return { n: ms / HOUR, unit: "hours" };
  return { n: Math.round(ms / MIN), unit: "minutes" };
}

function numberUnitToInterval(n, unit) {
  const map = { days: DAY, weeks: 7 * DAY, minutes: MIN, hours: HOUR };
  return Math.max(1, n) * map[unit];
}

function render() {
  qs("#header-title").textContent = isNew ? t("configure.title") : `${t("configure.editing")} · ${working.name}`;
  qs("#back-link").href = isNew ? "create-switch.html" : `checkin.html?id=${working.id}`;

  const recipients = getRecipients();
  const iv = intervalToNumberUnit(working.intervalMs);
  const unitOptions = mode === "legado"
    ? [["days", t("configure.unit_days")], ["weeks", t("configure.unit_weeks")]]
    : [["minutes", t("configure.unit_minutes")], ["hours", t("configure.unit_hours")]];

  qs("#main").innerHTML = `
    <p class="eyebrow">${isNew ? t("configure.step2") : t("configure.editing")} · ${modeLabel(mode)}</p>

    <div class="field">
      <label for="f-name">${t("configure.name_label")}</label>
      <input class="input" id="f-name" value="${escapeHtml(working.name)}" placeholder="${t("configure.name_placeholder")}" />
    </div>

    <div class="field">
      <label>${t("configure.interval_label")}</label>
      <div class="flex gap-8">
        <input class="input" style="flex:1;" type="number" min="1" id="f-interval-n" value="${iv.n}" />
        <select class="select" style="flex:1;" id="f-interval-unit">
          ${unitOptions.map(([v, l]) => `<option value="${v}" ${v === iv.unit ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <p class="hint">${t("configure.interval_hint")}</p>
    </div>

    <div class="field">
      <label>${t("configure.recipients_label")}</label>
      ${recipients.length === 0 ? `<p class="text-sm muted">${t("configure.no_recipients")} <a href="recipients.html">${t("configure.add_first")}</a></p>` : `
      <div class="card" style="padding:6px 14px;">
        ${recipients.map((r) => `
          <label class="checkbox-row">
            <input type="checkbox" data-recipient="${r.id}" ${working.recipients.includes(r.id) ? "checked" : ""} />
            <span class="avatar" style="width:32px;height:32px;font-size:12px;">${initials(r.name)}</span>
            <span class="flex-1">${r.name}</span>
            <span class="badge ${recipientStatusMeta(r.status).badge}">${recipientStatusMeta(r.status).icon}</span>
          </label>
        `).join("")}
      </div>`}
      <p class="hint"><a href="recipients.html">${t("common.manage_recipients")}</a></p>
    </div>

    ${mode === "legado" ? `
    <div class="field" id="verifier-field">
      <label>${t("configure.verifier_label")}</label>
      <select class="select" id="f-verifier">
        <option value="">${t("configure.no_verifier")}</option>
        ${working.recipients.map((id) => getRecipient(id)).filter(Boolean).map((r) => `
          <option value="${r.id}" ${working.verifierId === r.id ? "selected" : ""}>${r.name}</option>
        `).join("")}
      </select>
      <p class="hint">${t("configure.verifier_hint")}</p>
    </div>` : ""}

    <div class="field">
      <label for="f-message">${t("configure.message_label")}</label>
      <textarea class="textarea" id="f-message">${escapeHtml(working.message)}</textarea>
    </div>

    <div class="field">
      <label>${t("configure.channel_label")}</label>
      <label class="checkbox-row"><input type="checkbox" checked disabled /> <span class="flex-1">${t("common.email")}</span> <span class="badge badge-gray">${t("common.always_on")}</span></label>
      ${mode === "sesion" ? `
        <label class="checkbox-row"><input type="checkbox" id="f-sms" ${working.channels.sms ? "checked" : ""} /> <span class="flex-1">${t("common.sms")}</span></label>
        <label class="checkbox-row"><input type="checkbox" id="f-whatsapp" ${working.channels.whatsapp ? "checked" : ""} /> <span class="flex-1">${t("common.whatsapp")}</span></label>
        <label class="checkbox-row"><input type="checkbox" id="f-call" ${working.channels.call ? "checked" : ""} disabled /> <span class="flex-1">${t("common.call")}</span> <span class="badge badge-gray">${t("configure.call_soon")}</span></label>
      ` : ""}
    </div>

    ${mode === "sesion" ? `
    <div class="field">
      <div class="checkbox-row" style="border-bottom:none;">
        <span class="flex-1"><label for="f-location" style="margin:0;">${t("configure.location_label")}</label></span>
        <span class="toggle"><input type="checkbox" id="f-location" ${working.location ? "checked" : ""} /><span class="track"></span></span>
      </div>
    </div>` : ""}

    ${isNew ? `
      <div class="card">
        <div class="card-row">
          <span style="font-size:20px;">⏱️</span>
          <div class="flex-1">
            <div style="font-weight:700; font-size:14px;">${t("configure.escalation_title")}</div>
            <div class="text-sm muted">${t("configure.escalation_new_hint", { what: mode === "legado" ? t("configure.escalation_what_legado") : t("configure.escalation_what_cuidame") })}</div>
          </div>
        </div>
      </div>
    ` : `
      <a class="card card-tap" href="escalation.html?id=${working.id}">
        <div class="card-row">
          <span style="font-size:20px;">⏱️</span>
          <div class="flex-1">
            <div style="font-weight:700; font-size:14px;">${t("configure.escalation_title")}</div>
            <div class="text-sm muted">${mode === "legado" ? t("configure.escalation_hint_legado") : t("configure.escalation_hint_cuidame")}</div>
          </div>
          <span class="muted">›</span>
        </div>
      </a>
    `}

    <button class="btn btn-primary mt-16" id="save-btn">${t("configure.save_btn")}</button>

    ${!isNew ? `
    <div class="section-title" style="color:var(--color-red);">${t("configure.critical_zone")}</div>
    <div class="demo-banner" style="border-color:var(--color-red); color:var(--color-red); background:var(--color-red-bg);">
      ${t("configure.critical_zone_note")}
    </div>
    <button class="btn btn-outline mt-8" id="off-btn" style="border-color:var(--color-red); color:var(--color-red);">
      ${working.off ? t("configure.turn_on") : t("configure.turn_off")}
    </button>
    ` : ""}
  `;

  qs("#save-btn").onclick = save;
  const offBtn = qs("#off-btn");
  if (offBtn) offBtn.onclick = toggleOff;

  qsa("input[data-recipient]").forEach((cb) => {
    cb.onchange = () => {
      syncFormToWorking();
      const id = cb.dataset.recipient;
      if (cb.checked) working.recipients.push(id);
      else working.recipients = working.recipients.filter((r) => r !== id);
      render();
    };
  });
}

// Antes de un re-render parcial (ej: tildar un destinatario), guardamos lo que
// el usuario ya tipeó en los demás campos para no perderlo.
function syncFormToWorking() {
  const name = qs("#f-name");
  if (name) working.name = name.value;
  const message = qs("#f-message");
  if (message) working.message = message.value;
  const ivN = qs("#f-interval-n");
  const ivUnit = qs("#f-interval-unit");
  if (ivN && ivUnit) working.intervalMs = numberUnitToInterval(parseInt(ivN.value, 10) || 1, ivUnit.value);
  if (mode === "legado") {
    const verifier = qs("#f-verifier");
    if (verifier) working.verifierId = verifier.value || null;
  } else {
    const sms = qs("#f-sms");
    const whatsapp = qs("#f-whatsapp");
    const location = qs("#f-location");
    if (sms) working.channels.sms = sms.checked;
    if (whatsapp) working.channels.whatsapp = whatsapp.checked;
    if (location) working.location = location.checked;
  }
}

async function toggleOff() {
  const msg = working.off ? t("configure.confirm_turn_on") : t("configure.confirm_turn_off");
  if (working.off) {
    if (!confirm(msg)) return;
    working.off = false;
  } else {
    const typed = prompt(msg);
    if (typed !== "OK" && typed !== "ok") {
      showToast(t("configure.toast_change_cancelled"));
      return;
    }
    working.off = true;
  }
  await saveSwitch(working);
  await addHistory({ switchId: working.id, type: "config", note: working.off ? t("configure.history_off") : t("configure.history_on") });
  render();
  showToast(working.off ? t("configure.toast_off") : t("configure.toast_on"));
}

async function save() {
  working.name = qs("#f-name").value.trim() || working.name;
  const n = parseInt(qs("#f-interval-n").value, 10) || 1;
  const unit = qs("#f-interval-unit").value;
  const newIntervalMs = numberUnitToInterval(n, unit);
  if (newIntervalMs !== working.intervalMs && isNew) {
    working.nextDue = Date.now() + newIntervalMs;
  }
  working.intervalMs = newIntervalMs;
  working.message = qs("#f-message").value.trim() || working.message;

  if (mode === "legado") {
    const verifierSel = qs("#f-verifier");
    working.verifierId = verifierSel ? (verifierSel.value || null) : null;
    working.channels = { email: true, sms: false, whatsapp: false, call: false };
  } else {
    working.channels = {
      email: true,
      sms: qs("#f-sms") ? qs("#f-sms").checked : working.channels.sms,
      whatsapp: qs("#f-whatsapp") ? qs("#f-whatsapp").checked : working.channels.whatsapp,
      call: false,
    };
    working.location = qs("#f-location") ? qs("#f-location").checked : working.location;
  }

  if (working.recipients.length === 0) {
    if (!confirm(t("configure.confirm_no_recipients"))) return;
  }

  const saveBtn = qs("#save-btn");
  saveBtn.disabled = true;
  try {
    await saveSwitch(working);
    await addHistory({ switchId: working.id, type: isNew ? "created" : "config", note: isNew ? t("configure.history_created") : t("configure.history_updated") });
    location.href = `checkin.html?id=${working.id}`;
  } catch (e) {
    console.error(e);
    saveBtn.disabled = false;
    showToast(t("home.toast_alert_error"));
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

(async function boot() {
  const session = await requireSession();
  if (!session) return;
  await loadAll();
  if (editId) {
    const existing = getSwitch(editId);
    if (existing) mode = existing.mode;
  }
  initWorking();
  render();
})();
