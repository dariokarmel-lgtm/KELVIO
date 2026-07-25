/* Configuración de escalamiento: período de gracia / duración de alarma y recordatorios. */

const escId = getParam("id");
let sw = getSwitch(escId);

const DEFAULT_REMINDERS_LEGADO = [
  { id: "push", label: "Notificación push inmediata al vencer", enabled: true },
  { id: "sms6", label: "SMS de recordatorio a las 6 horas", enabled: true },
  { id: "call12", label: "Llamada automática a las 12 horas", enabled: false },
  { id: "email20", label: "Email urgente a las 20 horas", enabled: true },
];

function ensureDefaults() {
  if (!sw) return;
  if (sw.mode === "legado" && !sw.reminders) sw.reminders = JSON.parse(JSON.stringify(DEFAULT_REMINDERS_LEGADO));
  if (sw.mode === "sesion" && sw.panicVisible === undefined) sw.panicVisible = true;
}

function render() {
  if (!sw) {
    qs("#main").innerHTML = `<div class="empty-state"><span class="icon">🛟</span><p>Switch no encontrado.</p></div>`;
    return;
  }
  qs("#back-link").href = `configure-switch.html?id=${sw.id}`;

  if (sw.mode === "legado") {
    qs("#main").innerHTML = `
      <p class="eyebrow">${sw.name} · Modo Legado</p>
      <p class="text-sm muted">En Modo Legado priorizamos evitar falsas alarmas: hay tiempo y recordatorios escalados antes de avisar de verdad.</p>

      <div class="field mt-16">
        <label>Período de gracia</label>
        <select class="select" id="f-grace">
          <option value="${24 * HOUR}" ${sw.graceMs === 24 * HOUR ? "selected" : ""}>24 horas</option>
          <option value="${48 * HOUR}" ${sw.graceMs === 48 * HOUR ? "selected" : ""}>48 horas</option>
        </select>
        <p class="hint">Tiempo desde que vence el check-in hasta que se envía el aviso final.</p>
      </div>

      <div class="section-title">Recordatorios durante la gracia</div>
      <div class="card" style="padding:6px 14px;">
        ${sw.reminders.map((r) => `
          <div class="checkbox-row">
            <span class="flex-1">${r.label}</span>
            <span class="toggle"><input type="checkbox" data-reminder="${r.id}" ${r.enabled ? "checked" : ""} /><span class="track"></span></span>
          </div>
        `).join("")}
      </div>

      <button class="btn btn-primary mt-16" id="save-btn">Guardar</button>
    `;
  } else {
    qs("#main").innerHTML = `
      <p class="eyebrow">${sw.name} · Modo Sesión</p>
      <p class="text-sm muted">En Modo Sesión priorizamos velocidad: preferimos una falsa alarma antes que llegar tarde.</p>

      <div class="field mt-16">
        <label>Duración de la alarma final</label>
        <select class="select" id="f-alarm">
          <option value="60000" ${sw.alarmMs === 60000 ? "selected" : ""}>60 segundos</option>
          <option value="90000" ${sw.alarmMs === 90000 ? "selected" : ""}>90 segundos</option>
          <option value="120000" ${sw.alarmMs === 120000 ? "selected" : ""}>120 segundos</option>
        </select>
        <p class="hint">Cuando vence el check-in, tenés esta ventana para cancelar antes de que se envíe el aviso.</p>
      </div>

      <div class="checkbox-row">
        <span class="flex-1"><label style="margin:0;">Botón de pánico visible en la pantalla de check-in</label></span>
        <span class="toggle"><input type="checkbox" id="f-panic" ${sw.panicVisible ? "checked" : ""} /><span class="track"></span></span>
      </div>
      <p class="hint mt-8">Deja avisar al instante, sin esperar a que venza el contador.</p>

      <button class="btn btn-primary mt-16" id="save-btn">Guardar</button>
    `;
  }

  qs("#save-btn").onclick = save;
}

function save() {
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
  saveSwitch(sw);
  addHistory({ switchId: sw.id, type: "config", note: "Escalamiento actualizado" });
  showToast("Escalamiento guardado");
  location.href = `configure-switch.html?id=${sw.id}`;
}

ensureDefaults();
render();
