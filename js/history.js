/* Log de actividad — refuerza confianza mostrando que el sistema funciona. */

let filterSwitch = "all";

function typeMeta(type) {
  const map = {
    created: { icon: "🆕", key: "history.type_created" },
    checkin: { icon: "✅", key: "history.type_checkin" },
    invite: { icon: "✉️", key: "history.type_invite" },
    invite_response: { icon: "👥", key: "history.type_invite_response" },
    config: { icon: "⚙️", key: "history.type_config" },
    trigger_manual: { icon: "🚨", key: "history.type_trigger_manual" },
    trigger_sim: { icon: "🧪", key: "history.type_trigger_sim" },
  };
  const m = map[type];
  return m ? { icon: m.icon, label: t(m.key) } : { icon: "•", label: type };
}

function render() {
  const switches = getSwitches();
  const entries = getHistory(filterSwitch === "all" ? null : filterSwitch);

  qs("#main").innerHTML = `
    <div class="field">
      <select class="select" id="f-filter">
        <option value="all" ${filterSwitch === "all" ? "selected" : ""}>${t("history.filter_all")}</option>
        ${switches.map((s) => `<option value="${s.id}" ${filterSwitch === s.id ? "selected" : ""}>${s.name}</option>`).join("")}
      </select>
    </div>

    ${entries.length === 0 ? `
      <div class="empty-state">
        <span class="icon">🕘</span>
        <p>${t("history.empty")}</p>
      </div>
    ` : entries.map(rowHtml).join("")}
  `;

  qs("#f-filter").onchange = (e) => {
    filterSwitch = e.target.value;
    render();
  };
}

function rowHtml(h) {
  const meta = typeMeta(h.type);
  const sw = h.switchId ? getSwitch(h.switchId) : null;
  const isSim = h.type === "trigger_sim";
  return `
    <div class="card-row" style="padding:10px 0; border-bottom:1px solid var(--color-border);">
      <span style="font-size:18px;">${meta.icon}</span>
      <div class="flex-1">
        <div style="font-size:13.5px; font-weight:600;">${h.note}</div>
        <div class="text-sm muted">${formatDate(h.ts)}${sw ? " · " + sw.name : ""}${isSim ? t("history.simulated_suffix") : ""}</div>
      </div>
    </div>
  `;
}

render();
