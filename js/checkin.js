/* Pantalla de Check-in — la más crítica del producto. */

let CURRENT_SWITCH_ID = getParam("id");
let tickTimer = null;
let lastStatus = null;

function loadCurrentSwitch() {
  const sw = getSwitch(CURRENT_SWITCH_ID);
  if (!sw) {
    // Sin id válido, caemos al primer switch disponible para que el link nunca rompa.
    const first = getSwitches()[0];
    if (first) {
      CURRENT_SWITCH_ID = first.id;
      return first;
    }
  }
  return sw;
}

function ringStyle(sw, status) {
  const now = Date.now();
  let pct;
  if (status === "off" || status === "triggered") {
    pct = 100;
  } else if (status === "active") {
    const elapsed = sw.intervalMs - (sw.nextDue - now);
    pct = Math.min(100, Math.max(0, (elapsed / sw.intervalMs) * 100));
  } else {
    // grace / alarm: llenamos el anillo a medida que se acerca el envío
    const windowMs = sw.mode === "legado" ? (sw.graceMs || 24 * 60 * 60 * 1000) : (sw.alarmMs || 90000);
    const elapsed = now - sw.nextDue;
    pct = Math.min(100, Math.max(0, (elapsed / windowMs) * 100));
  }
  const color = status === "active" ? "var(--color-green)" : status === "grace" ? "var(--color-yellow)" : "var(--color-red)";
  return `background: conic-gradient(${color} ${pct}%, var(--color-border) 0); `;
}

function gearHandler(e) {
  e.preventDefault();
  requireCriticalAuth(() => {
    location.href = `configure-switch.html?id=${CURRENT_SWITCH_ID}`;
  });
}

function render() {
  const sw = loadCurrentSwitch();
  const main = qs("#main");
  if (!sw) {
    main.innerHTML = `<div class="empty-state"><span class="icon">🛟</span><p>${t("checkin.no_switches")}</p>
      <a class="btn btn-primary" style="width:auto;display:inline-flex;" href="create-switch.html">${t("common.create_switch_btn")}</a></div>`;
    return;
  }

  qs("#sw-name").textContent = sw.name;
  qs("#gear-link").onclick = gearHandler;

  const status = switchStatus(sw);
  lastStatus = status;
  const meta = statusMeta(status);
  const names = recipientNames(sw) || t("checkin.default_recipients");
  const isSesion = sw.mode === "sesion";
  const locationSuffix = sw.location ? t("checkin.location_suffix") : "";
  const bigBtnLabel = isSesion ? t("checkin.btn_cuidame") : t("checkin.btn_legado");

  // Overlay de alarma / disparo (Modo Sesión vencido, o gatillado manualmente)
  const overlay = qs("#alarm-overlay");
  if (isSesion && (status === "alarm" || status === "triggered")) {
    renderAlarmOverlay(sw, status);
  } else {
    overlay.innerHTML = "";
  }

  let stageHtml = "";
  let bottomExtra = "";

  if (status === "triggered" && sw.mode === "legado") {
    stageHtml = `
      <div class="card text-center" style="padding:28px 18px;">
        <div style="font-size:40px;">🚨</div>
        <h2 style="margin:10px 0 4px;">${t("checkin.triggered_title")}</h2>
        <p class="text-sm muted">${t("checkin.triggered_body", { names })}</p>
      </div>`;
    bottomExtra = `<button class="btn btn-green mt-16" id="checkin-btn-triggered">${bigBtnLabel}</button>`;
  } else if (status !== "off") {
    const dateSuffix = sw.mode === "legado" ? " (" + formatDate(sw.nextDue).split(" · ")[0] + ")" : "";
    stageHtml = `
      <div class="checkin-stage">
        <div class="ring" id="ring" style="${ringStyle(sw, status)}">
          <button class="big-btn" style="background:${isSesion ? "var(--color-primary)" : "var(--color-green)"};" id="checkin-btn">
            <span class="icon">✅</span>
            <span>${bigBtnLabel}</span>
            <span class="sub">${t("checkin.btn_sub")}</span>
          </button>
        </div>
      </div>
      <div class="contract-box">
        ${t("checkin.contract", { time: `<b>${formatClock(sw.nextDue)}${dateSuffix}</b>`, date: "", names: `<b>${names}</b>`, location: locationSuffix })}
      </div>`;

    if (status === "grace" && sw.verifierId) {
      const verifier = getRecipient(sw.verifierId);
      stageHtml += `
        <div class="warn-banner mt-16">
          ⏳ ${t("checkin.verifier_wait", { verifier: `<b>${verifier ? verifier.name : t("checkin.default_verifier")}</b>` })}
        </div>`;
    }

    if (isSesion) {
      bottomExtra = `
        <button class="btn btn-red mt-16" id="panic-btn">${t("checkin.btn_panic")}</button>`;
    }
  } else {
    stageHtml = `<div class="empty-state"><span class="icon">⏸️</span><p>${t("checkin.off_message")}</p></div>`;
  }

  main.innerHTML = `
    <div class="status-strip" style="background:${status === "active" ? "var(--color-green-bg)" : status === "grace" ? "var(--color-yellow-bg)" : status === "off" ? "var(--color-surface)" : "var(--color-red-bg)"}; color:${status === "active" ? "var(--color-green)" : status === "grace" ? "var(--color-yellow)" : status === "off" ? "var(--color-text-muted)" : "var(--color-red)"};">
      <span><span class="dot ${meta.dot}"></span> &nbsp;${meta.label}</span>
      <span>${modeLabel(sw.mode)}</span>
    </div>
    ${stageHtml}
    ${bottomExtra}
  `;

  const btn = qs("#checkin-btn");
  if (btn) btn.onclick = () => handleCheckin(sw);
  const btnTriggered = qs("#checkin-btn-triggered");
  if (btnTriggered) btnTriggered.onclick = () => handleCheckin(sw);
  const panicBtn = qs("#panic-btn");
  if (panicBtn) panicBtn.onclick = () => handlePanic(sw);
}

function renderAlarmOverlay(sw, status) {
  const overlay = qs("#alarm-overlay");
  const alarmMs = sw.alarmMs || 90000;
  const remaining = status === "alarm" ? Math.max(0, sw.nextDue + alarmMs - Date.now()) : 0;
  const names = recipientNames(sw) || t("checkin.default_recipients");
  const locationSuffix = sw.location ? t("checkin.location_suffix") : "";

  if (status === "triggered") {
    overlay.innerHTML = `
      <div class="alarm-screen">
        <h2>${t("checkin.alarm_triggered_title")}</h2>
        <p>${t("checkin.alarm_triggered_body", { names, location: locationSuffix })}</p>
        <button class="cancel-btn" id="alarm-checkin-btn">${t("checkin.btn_cuidame")}</button>
      </div>`;
    qs("#alarm-checkin-btn", overlay).onclick = () => handleCheckin(sw);
    return;
  }

  const secs = Math.ceil(remaining / 1000);
  overlay.innerHTML = `
    <div class="alarm-screen">
      <h2>${t("checkin.alarm_countdown_title")}</h2>
      <div class="countdown" id="alarm-countdown">${secs}</div>
      <p>${t("checkin.alarm_countdown_body", { names: `<b>${names}</b>`, location: locationSuffix })}</p>
      <button class="cancel-btn" id="alarm-cancel">${t("checkin.btn_cancel_caps")}</button>
    </div>`;
  const cancelBtn = qs("#alarm-cancel");
  if (cancelBtn) cancelBtn.onclick = () => handleCheckin(sw);
}

async function handleCheckin(sw) {
  await doCheckin(sw.id);
  qs("#alarm-overlay").innerHTML = "";
  if (navigator.vibrate) navigator.vibrate(30);
  render();
  showToast(sw.mode === "legado" ? t("checkin.toast_legado") : t("checkin.toast_cuidame"));
}

async function handlePanic(sw) {
  const ok = confirm(t("checkin.panic_confirm"));
  if (!ok) return;
  showToast(t("home.toast_sending"));
  try {
    await callFunction("send-alert", { switchId: sw.id });
  } catch (e) {
    console.error(e);
    showToast(t("home.toast_alert_error"));
    return;
  }
  await loadAll();
  render();
}

function tick() {
  const sw = loadCurrentSwitch();
  if (!sw) return;
  const status = switchStatus(sw);

  // Si cambió el estado (ej: activo -> gracia -> disparado), reconstruimos todo.
  if (status !== lastStatus) {
    render();
    return;
  }

  // Si no, solo refrescamos los números que avanzan con el tiempo — sin
  // tocar el resto del DOM para no perder foco ni "parpadear" los botones.
  const ring = qs("#ring");
  if (ring) ring.setAttribute("style", ringStyle(sw, status));

  const countdown = qs("#alarm-countdown");
  if (countdown) {
    const remaining = Math.max(0, sw.nextDue + (sw.alarmMs || 90000) - Date.now());
    countdown.textContent = Math.ceil(remaining / 1000);
  }
}

(async function boot() {
  const session = await requireSession();
  if (!session) return;
  await loadAll();
  render();
  tickTimer = setInterval(tick, 1000);
})();
