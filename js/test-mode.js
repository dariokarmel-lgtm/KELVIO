/* Modo Prueba — simula el flujo de disparo completo sin enviar nada real. */

let selectedId = getParam("id") || null;
let running = false;
let step = 0;

function stepsFor(sw) {
  if (sw.mode === "legado") {
    const names = recipientNames(sw) || t("checkin.default_recipients");
    const verifier = sw.verifierId ? getRecipient(sw.verifierId) : null;
    return [
      { title: t("testmode.step1_legado_title"), desc: t("testmode.step1_legado_desc", { name: sw.name }) },
      { title: t("testmode.step2_legado_title"), desc: t("testmode.step2_legado_desc", { hours: sw.graceMs === 48 * HOUR ? "48" : "24" }) },
      verifier
        ? { title: t("testmode.step3_verifier_title", { verifier: verifier.name }), desc: t("testmode.step3_verifier_desc") }
        : { title: t("testmode.step3_noverifier_title"), desc: t("testmode.step3_noverifier_desc") },
      { title: t("testmode.step4_legado_title"), desc: t("testmode.step4_legado_desc") },
      { title: t("testmode.step5_legado_title"), desc: t("testmode.step5_legado_desc", { names }), final: true },
    ];
  }
  const names = recipientNames(sw) || t("checkin.default_recipients");
  return [
    { title: t("testmode.step1_cuidame_title"), desc: t("testmode.step1_cuidame_desc", { name: sw.name }) },
    { title: t("testmode.step2_cuidame_title"), desc: t("testmode.step2_cuidame_desc", { secs: Math.round((sw.alarmMs || 90000) / 1000) }) },
    { title: t("testmode.step3_cuidame_title"), desc: t("testmode.step3_cuidame_desc") },
    { title: t("testmode.step4_cuidame_title"), desc: t("testmode.step4_cuidame_desc", { names, channels: channelList(sw) }), final: true },
  ];
}

function channelList(sw) {
  const list = [t("testmode.channel_email")];
  if (sw.channels?.sms) list.push(t("testmode.channel_sms"));
  if (sw.channels?.whatsapp) list.push(t("common.whatsapp"));
  if (sw.channels?.call) list.push(t("testmode.channel_call"));
  return list.join(", ");
}

function render() {
  const switches = getSwitches();
  if (switches.length === 0) {
    qs("#main").innerHTML = `<div class="empty-state"><span class="icon">🛟</span><p>${t("testmode.no_switches")}</p></div>`;
    return;
  }
  const sw = getSwitch(selectedId) || switches[0];
  selectedId = sw.id;
  const steps = stepsFor(sw);

  qs("#main").innerHTML = `
    <div class="demo-banner">
      <strong>${t("testmode.banner_label")}</strong> ${t("testmode.banner")}
    </div>

    <div class="field">
      <label>${t("testmode.select_label")}</label>
      <select class="select" id="f-switch" ${running ? "disabled" : ""}>
        ${switches.map((s) => `<option value="${s.id}" ${s.id === sw.id ? "selected" : ""}>${s.name} (${modeLabel(s.mode)})</option>`).join("")}
      </select>
    </div>

    ${!running ? `
      <button class="btn btn-primary mt-16" id="start-btn">${t("testmode.start_btn")}</button>
    ` : `
      <div class="timeline mt-16">
        ${steps.map((s, i) => `
          <div class="timeline-item ${i < step ? "done" : i === step ? "active" : "pending-step"}">
            <p class="t-title">${s.title}</p>
            <p class="t-desc">${s.desc}</p>
          </div>
        `).join("")}
      </div>
      ${step < steps.length - 1 ? `
        <button class="btn btn-primary mt-16" id="next-btn">${t("testmode.next_btn")}</button>
      ` : `
        <div class="card text-center mt-16">
          <div style="font-size:32px;">✅</div>
          <p style="font-weight:700; margin:8px 0 4px;">${t("testmode.done_title")}</p>
          <p class="text-sm muted">${t("testmode.done_body")}</p>
        </div>
        <button class="btn btn-secondary mt-16" id="restart-btn">${t("testmode.restart_btn")}</button>
      `}
    `}
  `;

  const sel = qs("#f-switch");
  if (sel) sel.onchange = (e) => { selectedId = e.target.value; render(); };
  const startBtn = qs("#start-btn");
  if (startBtn) startBtn.onclick = async () => {
    running = true;
    step = 0;
    await addHistory({ switchId: sw.id, type: "trigger_sim", note: t("testmode.history_started", { name: sw.name }) });
    render();
  };
  const nextBtn = qs("#next-btn");
  if (nextBtn) nextBtn.onclick = () => { step++; render(); };
  const restartBtn = qs("#restart-btn");
  if (restartBtn) restartBtn.onclick = () => { running = false; step = 0; render(); };
}

(async function boot() {
  const session = await requireSession();
  if (!session) return;
  await loadAll();
  if (!selectedId) {
    const first = getSwitches()[0];
    if (first) selectedId = first.id;
  }
  render();
})();
