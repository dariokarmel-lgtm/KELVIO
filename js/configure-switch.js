/* Alta y edición de un switch. */

const isNew = getParam("new") === "1";
const editId = getParam("id");
let mode = getParam("mode") || (editId && getSwitch(editId) ? getSwitch(editId).mode : "legado");
let working = null; // objeto de trabajo (no persiste hasta Guardar)

const DEFAULT_MESSAGE = {
  legado: "Estoy bien, no se preocupen. Si reciben esto es porque no pude confirmar a tiempo.",
  sesion: "No confirmé mi check-in a tiempo. Esta es mi última ubicación conocida.",
};

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
    id: "s" + Math.random().toString(36).slice(2, 8),
    mode,
    name: mode === "legado" ? "Mi chequeo" : "Mi sesión",
    intervalMs: mode === "legado" ? 7 * DAY : 90 * MIN,
    graceMs: 24 * HOUR,
    alarmMs: 90 * 1000,
    nextDue: Date.now() + (mode === "legado" ? 7 * DAY : 90 * MIN),
    recipients: [],
    verifierId: null,
    message: DEFAULT_MESSAGE[mode],
    channels: mode === "legado" ? { email: true, sms: false, call: false } : { email: true, sms: true, call: false },
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
  qs("#header-title").textContent = isNew ? "Configurar switch" : `Editar · ${working.name}`;
  qs("#back-link").href = isNew ? "create-switch.html" : `checkin.html?id=${working.id}`;

  const recipients = getRecipients();
  const iv = intervalToNumberUnit(working.intervalMs);
  const unitOptions = mode === "legado"
    ? [["days", "días"], ["weeks", "semanas"]]
    : [["minutes", "minutos"], ["hours", "horas"]];

  qs("#main").innerHTML = `
    <p class="eyebrow">${isNew ? "Paso 2 de 2" : "Editando"} · ${mode === "legado" ? "Modo Legado" : "Modo Sesión"}</p>

    <div class="field">
      <label for="f-name">Nombre del switch</label>
      <input class="input" id="f-name" value="${escapeHtml(working.name)}" placeholder="Ej: Chequeo semanal" />
    </div>

    <div class="field">
      <label>Intervalo de check-in</label>
      <div class="flex gap-8">
        <input class="input" style="flex:1;" type="number" min="1" id="f-interval-n" value="${iv.n}" />
        <select class="select" style="flex:1;" id="f-interval-unit">
          ${unitOptions.map(([v, l]) => `<option value="${v}" ${v === iv.unit ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <p class="hint">Cada cuánto te vamos a pedir que confirmes que estás bien.</p>
    </div>

    <div class="field">
      <label>Destinatarios</label>
      ${recipients.length === 0 ? `<p class="text-sm muted">Todavía no tenés destinatarios. <a href="recipients.html">Agregá uno primero →</a></p>` : `
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
      <p class="hint"><a href="recipients.html">Gestionar destinatarios →</a></p>
    </div>

    ${mode === "legado" ? `
    <div class="field" id="verifier-field">
      <label>Verificador</label>
      <select class="select" id="f-verifier">
        <option value="">Sin verificador (no recomendado)</option>
        ${working.recipients.map((id) => getRecipient(id)).filter(Boolean).map((r) => `
          <option value="${r.id}" ${working.verifierId === r.id ? "selected" : ""}>${r.name}</option>
        `).join("")}
      </select>
      <p class="hint">Antes de avisar a todos, le preguntamos a esta persona si sabe algo de vos. Ayuda a evitar falsas alarmas.</p>
    </div>` : ""}

    <div class="field">
      <label for="f-message">Mensaje que se envía</label>
      <textarea class="textarea" id="f-message">${escapeHtml(working.message)}</textarea>
    </div>

    <div class="field">
      <label>Canal de aviso</label>
      <label class="checkbox-row"><input type="checkbox" checked disabled /> <span class="flex-1">Email</span> <span class="badge badge-gray">Siempre activo</span></label>
      ${mode === "sesion" ? `
        <label class="checkbox-row"><input type="checkbox" id="f-sms" ${working.channels.sms ? "checked" : ""} /> <span class="flex-1">SMS</span></label>
        <label class="checkbox-row"><input type="checkbox" id="f-call" ${working.channels.call ? "checked" : ""} /> <span class="flex-1">Llamada automática</span></label>
      ` : ""}
    </div>

    ${mode === "sesion" ? `
    <div class="field">
      <div class="checkbox-row" style="border-bottom:none;">
        <span class="flex-1"><label for="f-location" style="margin:0;">Compartir ubicación en el aviso</label></span>
        <span class="toggle"><input type="checkbox" id="f-location" ${working.location ? "checked" : ""} /><span class="track"></span></span>
      </div>
    </div>` : ""}

    ${isNew ? `
      <div class="card">
        <div class="card-row">
          <span style="font-size:20px;">⏱️</span>
          <div class="flex-1">
            <div style="font-weight:700; font-size:14px;">Escalamiento</div>
            <div class="text-sm muted">Guardá el switch primero — después podés ajustar ${mode === "legado" ? "el período de gracia y los recordatorios" : "la duración de la alarma final"}.</div>
          </div>
        </div>
      </div>
    ` : `
      <a class="card card-tap" href="escalation.html?id=${working.id}">
        <div class="card-row">
          <span style="font-size:20px;">⏱️</span>
          <div class="flex-1">
            <div style="font-weight:700; font-size:14px;">Escalamiento</div>
            <div class="text-sm muted">${mode === "legado" ? "Período de gracia y recordatorios" : "Duración de la alarma final"}</div>
          </div>
          <span class="muted">›</span>
        </div>
      </a>
    `}

    <button class="btn btn-primary mt-16" id="save-btn">Guardar switch</button>

    ${!isNew ? `
    <div class="section-title" style="color:var(--color-red);">Zona crítica</div>
    <div class="demo-banner" style="border-color:var(--color-red); color:var(--color-red); background:var(--color-red-bg);">
      Apagar o borrar un switch requiere confirmación extra a propósito — para que no sea algo que se haga "sin querer" o bajo presión.
    </div>
    <button class="btn btn-outline mt-8" id="off-btn" style="border-color:var(--color-red); color:var(--color-red);">
      ${working.off ? "Reactivar switch" : "Apagar switch"}
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
    const call = qs("#f-call");
    const location = qs("#f-location");
    if (sms) working.channels.sms = sms.checked;
    if (call) working.channels.call = call.checked;
    if (location) working.location = location.checked;
  }
}

function toggleOff() {
  const msg = working.off
    ? "¿Reactivar este switch?"
    : "Vas a apagar este switch: no se va a avisar a nadie hasta que lo reactives.\n\nEscribí OK para confirmar.";
  if (working.off) {
    if (!confirm(msg)) return;
    working.off = false;
  } else {
    const typed = prompt(msg);
    if (typed !== "OK" && typed !== "ok") {
      showToast("Cambio cancelado");
      return;
    }
    working.off = true;
  }
  saveSwitch(working);
  addHistory({ switchId: working.id, type: "config", note: working.off ? "Switch apagado" : "Switch reactivado" });
  render();
  showToast(working.off ? "Switch apagado" : "Switch reactivado");
}

function save() {
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
    working.channels = { email: true, sms: false, call: false };
  } else {
    working.channels = {
      email: true,
      sms: qs("#f-sms") ? qs("#f-sms").checked : working.channels.sms,
      call: qs("#f-call") ? qs("#f-call").checked : working.channels.call,
    };
    working.location = qs("#f-location") ? qs("#f-location").checked : working.location;
  }

  if (working.recipients.length === 0) {
    if (!confirm("No elegiste ningún destinatario todavía. ¿Guardar igual?")) return;
  }

  saveSwitch(working);
  addHistory({ switchId: working.id, type: isNew ? "created" : "config", note: isNew ? "Switch creado" : "Configuración actualizada" });
  location.href = `checkin.html?id=${working.id}`;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

initWorking();
render();
