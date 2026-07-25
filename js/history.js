/* Log de actividad — refuerza confianza mostrando que el sistema funciona. */

let filterSwitch = "all";

const TYPE_META = {
  created: { icon: "🆕", label: "Switch creado" },
  checkin: { icon: "✅", label: "Check-in" },
  invite: { icon: "✉️", label: "Invitación" },
  invite_response: { icon: "👥", label: "Respuesta de destinatario" },
  config: { icon: "⚙️", label: "Cambio de configuración" },
  trigger_manual: { icon: "🚨", label: "Botón de pánico" },
  trigger_sim: { icon: "🧪", label: "Simulación (Modo Prueba)" },
};

function render() {
  const switches = getSwitches();
  const entries = getHistory(filterSwitch === "all" ? null : filterSwitch);

  qs("#main").innerHTML = `
    <div class="field">
      <select class="select" id="f-filter">
        <option value="all" ${filterSwitch === "all" ? "selected" : ""}>Todos los switches</option>
        ${switches.map((s) => `<option value="${s.id}" ${filterSwitch === s.id ? "selected" : ""}>${s.name}</option>`).join("")}
      </select>
    </div>

    ${entries.length === 0 ? `
      <div class="empty-state">
        <span class="icon">🕘</span>
        <p>Todavía no hay actividad para mostrar.</p>
      </div>
    ` : entries.map(rowHtml).join("")}
  `;

  qs("#f-filter").onchange = (e) => {
    filterSwitch = e.target.value;
    render();
  };
}

function rowHtml(h) {
  const meta = TYPE_META[h.type] || { icon: "•", label: h.type };
  const sw = h.switchId ? getSwitch(h.switchId) : null;
  const isSim = h.type === "trigger_sim";
  return `
    <div class="card-row" style="padding:10px 0; border-bottom:1px solid var(--color-border);">
      <span style="font-size:18px;">${meta.icon}</span>
      <div class="flex-1">
        <div style="font-size:13.5px; font-weight:600;">${h.note}</div>
        <div class="text-sm muted">${formatDate(h.ts)}${sw ? " · " + sw.name : ""}${isSim ? " · simulado, nada real" : ""}</div>
      </div>
    </div>
  `;
}

render();
