/* Configuración de escalamiento: período de gracia / duración de alarma y recordatorios. */

const escId = getParam("id");
let sw = null;

function defaultRemindersLegado() {
  return [
    { id: "push", label: t("escalation.reminder_push"), enabled: true },
    { id: "sms6", label: t("escalation.reminder_sms6"), enabled: true },
    { id: "call12", label: t("escalation.reminder_call12"), enabled: false },
    { id: "email20", label: t("escalation.reminder_email20"), enabled: true },
  ];
}

function ensureDefaults() {
  if (!sw) return;
  if (sw.mode === "legado" && !sw.reminders) sw.reminders = defaultRemindersLegado();
  if (sw.mode === "sesion" && sw.panicVisible === undefined) sw.panicVisible = true;
}

function render() {
  if (!sw) {
    qs("#main").innerHTML = `<div class="empty-state"><span class="icon">🛟</span><p>${t("common.switch_not_found")}</p></div>`;
    return;
  }
  qs("#back-link").href = `configure-switch.html?id=${sw.id}`;

  if (sw.mode === "legado") {
    qs("#main").innerHTML = `
      <p class="eyebrow">${sw.name} · ${t("common.mode_legado")}</p>
      <p class="text-sm muted">${t("escalation.legado_intro")}</p>

      <div class="field mt-16">
        <label>${t("escalation.grace_label")}</label>
        <select class="select" id="f-grace">
          <option value="${24 * HOUR}" ${sw.graceMs === 24 * HOUR ? "selected" : ""}>${t("escalation.hours_24")}</option>
          <option value="${48 * HOUR}" ${sw.graceMs === 48 * HOUR ? "selected" : ""}>${t("escalation.hours_48")}</option>
        </select>
        <p class="hint">${t("escalation.grace_hint")}</p>
      </div>

      <div class="section-title">${t("escalation.reminders_title")}</div>
      <div class="card" style="padding:6px 14px;">
        ${sw.reminders.map((r) => `
          <div class="checkbox-row">
            <span class="flex-1">${r.label}</span>
            <span class="toggle"><input type="checkbox" data-reminder="${r.id}" ${r.enabled ? "checked" : ""} /><span class="track"></span></span>
          </div>
        `).join("")}
      </div>

      <button class="btn btn-primary mt-16" id="save-btn">${t("common.save")}</button>
    `;
  } else {
    qs("#main").innerHTML = `
      <p class="eyebrow">${sw.name} · ${t("common.mode_cuidame")}</p>
      <p class="text-sm muted">${t("escalation.cuidame_intro")}</p>

      <div class="field mt-16">
        <label>${t("escalation.alarm_duration_label")}</label>
        <select class="select" id="f-alarm">
          <option value="60000" ${sw.alarmMs === 60000 ? "selected" : ""}>${t("escalation.seconds_60")}</option>
          <option value="90000" ${sw.alarmMs === 90000 ? "selected" : ""}>${t("escalation.seconds_90")}</option>
          <option value="120000" ${sw.alarmMs === 120000 ? "selected" : ""}>${t("escalation.seconds_120")}</option>
        </select>
        <p class="hint">${t("escalation.alarm_duration_hint")}</p>
      </div>

      <div class="checkbox-row">
        <span class="flex-1"><label style="margin:0;">${t("escalation.panic_visible_label")}</label></span>
        <span class="toggle"><input type="checkbox" id="f-panic" ${sw.panicVisible ? "checked" : ""} /><span class="track"></span></span>
      </div>
      <p class="hint mt-8">${t("escalation.panic_visible_hint")}</p>

      <button class="btn btn-primary mt-16" id="save-btn">${t("common.save")}</button>
    `;
  }

  qs("#save-btn").onclick = save;
}

async function save() {
  if (sw.mode === "legado") {
    sw.graceMs = parseInt(qs("#f-grace").value, 10);
    sw.reminders.forEach((r) => {
      const cb = qs(`input[data-reminder="${r.id}"]`);
      if (cb) r.enabled = cb.checked;
    });
  } else {
    sw.alarmMs = parseInt(qs("#f-alarm").value, 10);
    sw.panicVisible = qs("#f-panic").checked;
  }
  await saveSwitch(sw);
  await addHistory({ switchId: sw.id, type: "config", note: t("escalation.history_updated") });
  showToast(t("escalation.toast_saved"));
  location.href = `configure-switch.html?id=${sw.id}`;
}

(async function boot() {
  const session = await requireSession();
  if (!session) return;
  await loadAll();
  sw = getSwitch(escId);
  ensureDefaults();
  render();
})();
