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
  const ok = confirm(
    "Estás por entrar a Configuración crítica (destinatarios, intervalo, apagar el switch).\n\n" +
    "Por seguridad te pedimos confirmar de nuevo. ¿Continuar?"
  );
  if (ok) location.href = `configure-switch.html?id=${CURRENT_SWITCH_ID}`;
}

function render() {
  const sw = loadCurrentSwitch();
  const main = qs("#main");
  if (!sw) {
    main.innerHTML = `<div class="empty-state"><span class="icon">🛟</span><p>No tenés switches todavía.</p>
      <a class="btn btn-primary" style="width:auto;display:inline-flex;" href="create-switch.html">+ Crear switch</a></div>`;
    return;
  }

  qs("#sw-name").textContent = sw.name;
  qs("#gear-link").onclick = gearHandler;

  const status = switchStatus(sw);
  lastStatus = status;
  const meta = statusMeta(status);
  const names = recipientNames(sw) || "tus destinatarios";
  const isSesion = sw.mode === "sesion";

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
        <h2 style="margin:10px 0 4px;">Mensaje enviado (simulado)</h2>
        <p class="text-sm muted">Se avisó a ${names} porque no hubo confirmación dentro del período de gracia.</p>
      </div>`;
    bottomExtra = `<button class="btn btn-outline mt-16" onclick="resetSwitchDemo()">Reiniciar switch (demo)</button>`;
  } else if (status !== "off") {
    stageHtml = `
      <div class="checkin-stage">
        <div class="ring" id="ring" style="${ringStyle(sw, status)}">
          <button class="big-btn" style="background:${isSesion ? "var(--color-primary)" : "var(--color-green)"};" id="checkin-btn">
            <span class="icon">✅</span>
            <span>${isSesion ? "LLEGUÉ BIEN" : "ESTOY BIEN"}</span>
            <span class="sub">Tocá para confirmar</span>
          </button>
        </div>
      </div>
      <div class="contract-box">
        Si no tocás este botón antes de las <b>${formatClock(sw.nextDue)}${sw.mode === "legado" ? " (" + formatDate(sw.nextDue).split(" · ")[0] + ")" : ""}</b>,
        avisamos a <b>${names}</b>${sw.location ? " con tu última ubicación" : ""}.
      </div>`;

    if (status === "grace" && sw.verifierId) {
      const verifier = getRecipient(sw.verifierId);
      stageHtml += `
        <div class="warn-banner mt-16">
          ⏳ Antes de avisar, le preguntamos a <b>${verifier ? verifier.name : "tu verificador"}</b> si sabe algo de vos.
          Esperando respuesta…
        </div>`;
    }

    if (isSesion) {
      bottomExtra = `
        <button class="btn btn-red mt-16" id="panic-btn">🚨 Botón de pánico — avisar ahora</button>`;
    }
  } else {
    stageHtml = `<div class="empty-state"><span class="icon">⏸️</span><p>Este switch está apagado.</p></div>`;
  }

  main.innerHTML = `
    <div class="status-strip" style="background:${status === "active" ? "var(--color-green-bg)" : status === "grace" ? "var(--color-yellow-bg)" : status === "off" ? "var(--color-surface)" : "var(--color-red-bg)"}; color:${status === "active" ? "var(--color-green)" : status === "grace" ? "var(--color-yellow)" : status === "off" ? "var(--color-text-muted)" : "var(--color-red)"};">
      <span><span class="dot ${meta.dot}"></span> &nbsp;${meta.label}</span>
      <span>${sw.mode === "legado" ? "Modo Legado" : "Modo Sesión"}</span>
    </div>
    ${stageHtml}
    ${bottomExtra}
    <div class="demo-banner mt-16">
      <strong>DEMO</strong> Controles solo para probar el prototipo:
      <div class="btn-block-group mt-8">
        <button class="btn btn-outline btn-sm" onclick="simulateExpire()">Simular vencimiento ahora</button>
        <button class="btn btn-outline btn-sm" onclick="resetSwitchDemo()">Reiniciar check-in (volver a estado activo)</button>
      </div>
    </div>
  `;

  const btn = qs("#checkin-btn");
  if (btn) btn.onclick = () => handleCheckin(sw);
  const panicBtn = qs("#panic-btn");
  if (panicBtn) panicBtn.onclick = () => handlePanic(sw);
}

function renderAlarmOverlay(sw, status) {
  const overlay = qs("#alarm-overlay");
  const alarmMs = sw.alarmMs || 90000;
  const remaining = status === "alarm" ? Math.max(0, sw.nextDue + alarmMs - Date.now()) : 0;

  if (status === "triggered") {
    overlay.innerHTML = `
      <div class="alarm-screen">
        <h2>🚨 Alerta enviada (simulado)</h2>
        <p>Se avisó a ${recipientNames(sw) || "tus contactos"}${sw.location ? " con tu última ubicación" : ""}. No se envió nada real — esto es un prototipo.</p>
        <button class="cancel-btn" onclick="resetSwitchDemo()">REINICIAR (DEMO)</button>
      </div>`;
    return;
  }

  const secs = Math.ceil(remaining / 1000);
  overlay.innerHTML = `
    <div class="alarm-screen">
      <h2>🚨 Enviando alerta en…</h2>
      <div class="countdown" id="alarm-countdown">${secs}</div>
      <p>No confirmaste a tiempo. Vamos a avisar a <b>${recipientNames(sw) || "tus contactos"}</b>${sw.location ? " con tu ubicación" : ""}.</p>
      <button class="cancel-btn" id="alarm-cancel">CANCELAR</button>
      <a class="panic-link" href="#" onclick="event.preventDefault()">Esto es un prototipo — no se enviará nada real</a>
    </div>`;
  const cancelBtn = qs("#alarm-cancel");
  if (cancelBtn) cancelBtn.onclick = () => handleCheckin(sw);
}

function handleCheckin(sw) {
  doCheckin(sw.id);
  qs("#alarm-overlay").innerHTML = "";
  if (navigator.vibrate) navigator.vibrate(30);
  render();
  showToast(sw.mode === "legado" ? "Listo. Nos vemos pronto 👋" : "¡Bien! Contador reiniciado ✅");
}

function handlePanic(sw) {
  const ok = confirm("¿Avisar a tus contactos ahora mismo, sin esperar? (Botón de pánico)");
  if (!ok) return;
  sw.nextDue = Date.now() - ((sw.alarmMs || 90000) + 1000);
  saveSwitch(sw);
  addHistory({ switchId: sw.id, type: "trigger_manual", note: "Botón de pánico activado por el usuario" });
  render();
}

function simulateExpire() {
  const sw = loadCurrentSwitch();
  if (!sw) return;
  sw.nextDue = Date.now() - 1000;
  saveSwitch(sw);
  render();
}

function resetSwitchDemo() {
  const sw = loadCurrentSwitch();
  if (!sw) return;
  sw.nextDue = Date.now() + sw.intervalMs;
  saveSwitch(sw);
  addHistory({ switchId: sw.id, type: "checkin", note: "Check-in confirmado (reinicio demo)" });
  render();
  showToast("Switch reiniciado");
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

render();
tickTimer = setInterval(tick, 1000);
