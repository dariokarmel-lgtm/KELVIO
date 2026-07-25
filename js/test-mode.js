/* Modo Prueba — simula el flujo de disparo completo sin enviar nada real. */

let selectedId = getParam("id") || (getSwitches()[0] && getSwitches()[0].id) || null;
let running = false;
let step = 0;

function stepsFor(sw) {
  if (sw.mode === "legado") {
    const names = recipientNames(sw) || "tus destinatarios";
    const verifier = sw.verifierId ? getRecipient(sw.verifierId) : null;
    return [
      { title: "Vence el intervalo", desc: `No llegó el check-in de "${sw.name}" a tiempo.` },
      { title: "Empieza el período de gracia", desc: `${sw.graceMs === 48 * HOUR ? "48" : "24"} horas con recordatorios escalados (push, SMS, email).` },
      verifier
        ? { title: `Se consulta a ${verifier.name}`, desc: "Le preguntamos si sabe algo de vos, antes de avisar a los demás." }
        : { title: "Sin verificador configurado", desc: "Se pasa directo al aviso final (recomendamos sumar un verificador)." },
      { title: "Se decide avisar", desc: "No hubo respuesta que confirme que estás bien." },
      { title: "Mensaje enviado (simulado)", desc: `Se avisó a ${names} por email.`, final: true },
    ];
  }
  const names = recipientNames(sw) || "tus destinatarios";
  return [
    { title: "Vence el check-in", desc: `No se confirmó "${sw.name}" a tiempo.` },
    { title: "Alarma inmediata", desc: `Countdown de ${Math.round((sw.alarmMs || 90000) / 1000)} segundos, sonido fuerte, pantalla roja.` },
    { title: "Sin respuesta al countdown", desc: "El usuario no canceló a tiempo." },
    { title: "Disparo automático (simulado)", desc: `Se envió ubicación + mensaje a ${names} por ${channelList(sw)}.`, final: true },
  ];
}

function channelList(sw) {
  const list = ["email"];
  if (sw.channels?.sms) list.push("SMS");
  if (sw.channels?.call) list.push("llamada");
  return list.join(", ");
}

function render() {
  const switches = getSwitches();
  if (switches.length === 0) {
    qs("#main").innerHTML = `<div class="empty-state"><span class="icon">🛟</span><p>Creá un switch primero para poder probarlo.</p></div>`;
    return;
  }
  const sw = getSwitch(selectedId) || switches[0];
  selectedId = sw.id;
  const steps = stepsFor(sw);

  qs("#main").innerHTML = `
    <div class="demo-banner">
      <strong>Modo Prueba</strong> Simulá una alerta paso a paso para ver cómo funciona. No se envía nada real a tus contactos.
    </div>

    <div class="field">
      <label>Switch a probar</label>
      <select class="select" id="f-switch" ${running ? "disabled" : ""}>
        ${switches.map((s) => `<option value="${s.id}" ${s.id === sw.id ? "selected" : ""}>${s.name} (${s.mode === "legado" ? "Legado" : "Sesión"})</option>`).join("")}
      </select>
    </div>

    ${!running ? `
      <button class="btn btn-primary mt-16" id="start-btn">▶ Simular disparo</button>
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
        <button class="btn btn-primary mt-16" id="next-btn">Siguiente paso →</button>
      ` : `
        <div class="card text-center mt-16">
          <div style="font-size:32px;">✅</div>
          <p style="font-weight:700; margin:8px 0 4px;">Simulación terminada</p>
          <p class="text-sm muted">Esto fue una simulación. No se envió nada real a tus contactos.</p>
        </div>
        <button class="btn btn-secondary mt-16" id="restart-btn">Volver a probar</button>
      `}
    `}
  `;

  const sel = qs("#f-switch");
  if (sel) sel.onchange = (e) => { selectedId = e.target.value; render(); };
  const startBtn = qs("#start-btn");
  if (startBtn) startBtn.onclick = () => {
    running = true;
    step = 0;
    addHistory({ switchId: sw.id, type: "trigger_sim", note: `Simulación de disparo iniciada (${sw.name})` });
    render();
  };
  const nextBtn = qs("#next-btn");
  if (nextBtn) nextBtn.onclick = () => { step++; render(); };
  const restartBtn = qs("#restart-btn");
  if (restartBtn) restartBtn.onclick = () => { running = false; step = 0; render(); };
}

render();
