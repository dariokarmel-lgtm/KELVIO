/* Cuenta, plan, biometría y duress code. */

function render() {
  const acc = getAccount();

  qs("#main").innerHTML = `
    <div class="section-title">Cuenta</div>
    <div class="card">
      <div class="card-row">
        <span style="font-size:18px;">📱</span>
        <span class="flex-1">${acc.phone}</span>
        <span class="badge ${acc.phoneVerified ? "badge-green" : "badge-yellow"}">${acc.phoneVerified ? "Verificado" : "Pendiente"}</span>
      </div>
      <div class="card-row mt-8">
        <span style="font-size:18px;">✉️</span>
        <span class="flex-1">${acc.email}</span>
        <span class="badge ${acc.emailVerified ? "badge-green" : "badge-yellow"}">${acc.emailVerified ? "Verificado" : "Pendiente"}</span>
      </div>
      <p class="hint mt-8">Teléfono y email son los canales por los que se dispara una alerta — por eso pedimos verificarlos.</p>
    </div>

    <div class="section-title">Plan</div>
    <div class="card">
      <div class="card-row">
        <span class="flex-1">
          <div style="font-weight:700;">${acc.plan === "free" ? "Gratuito" : "Pro"}</div>
          <div class="text-sm muted">${acc.plan === "free" ? "1 switch · 1 destinatario · intervalo fijo" : "Switches ilimitados · ubicación en vivo · SMS/llamada"}</div>
        </span>
        <span class="badge badge-primary">${acc.plan === "free" ? "Free" : "Pro"}</span>
      </div>
      ${acc.plan === "free" ? `<button class="btn btn-primary mt-16" onclick="showToast('Pantalla de planes — pendiente de diseño')">Actualizar a Pro</button>` : ""}
    </div>

    <div class="section-title">Seguridad</div>
    <div class="card">
      <div class="checkbox-row" style="border-bottom:none;">
        <span class="flex-1">
          <label style="margin:0; display:block;">Biometría</label>
          <span class="hint" style="margin:2px 0 0;">Confirma que sos vos físicamente quien hace el check-in — no agrega fricción al botón.</span>
        </span>
        <span class="toggle"><input type="checkbox" id="f-bio" ${acc.biometric ? "checked" : ""} /><span class="track"></span></span>
      </div>
    </div>

    <div class="card" id="duress-card">
      ${duressHtml(acc)}
    </div>

    <div class="section-title">Confianza</div>
    <a class="card card-tap" href="test-mode.html">
      <div class="card-row">
        <span style="font-size:20px;">🧪</span>
        <div class="flex-1">
          <div style="font-weight:700; font-size:14px;">Modo Prueba</div>
          <div class="text-sm muted">Simulá una alerta sin enviar nada real</div>
        </div>
        <span class="muted">›</span>
      </div>
    </a>

    <div class="section-title" style="color:var(--color-red);">Zona crítica</div>
    <button class="btn btn-outline mt-8" style="border-color:var(--color-red); color:var(--color-red);" onclick="showToast('Cerrar sesión — pendiente de implementar')">Cerrar sesión</button>
  `;

  qs("#f-bio").onchange = (e) => {
    acc.biometric = e.target.checked;
    saveAccount(acc);
    showToast(acc.biometric ? "Biometría activada" : "Biometría desactivada");
  };

  wireDuress();
}

function duressHtml(acc) {
  const d = acc.duress || { status: "none" };
  if (d.status === "none") {
    return `
      <p style="font-weight:700; margin:0 0 4px;">🔕 Duress code (código bajo presión)</p>
      <p class="text-sm muted" style="margin:0 0 12px;">Un gesto o PIN alternativo que en pantalla se ve como un check-in normal, pero por dentro dispara la alerta en silencio. Cubre el escenario en que alguien te obliga a decir que estás bien.</p>
      <button class="btn btn-secondary" id="duress-setup-btn">Configurar duress code</button>
    `;
  }
  if (d.status === "step1") {
    return `
      <p style="font-weight:700; margin:0 0 4px;">🔕 Duress code — falta confirmar</p>
      <p class="text-sm muted" style="margin:0 0 12px;">Definiste el código «${d.code}». Para asegurarnos de que lo vas a recordar, te lo vamos a volver a pedir en otro momento (no ahora).</p>
      <div class="demo-banner" style="margin-bottom:0;">
        <strong>DEMO</strong> En la app real esto aparece más tarde, no en este mismo flujo.
        <div class="mt-8"><button class="btn btn-outline btn-sm" id="duress-confirm-btn">Simular: pedir confirmación ahora</button></div>
      </div>
    `;
  }
  return `
    <p style="font-weight:700; margin:0 0 4px;">🔕 Duress code — activo</p>
    <p class="text-sm muted" style="margin:0 0 12px;">Confirmado y listo para usar. Solo vos sabés cuál es.</p>
    <button class="btn btn-outline btn-sm" style="width:auto;" id="duress-reset-btn">Borrar duress code</button>
  `;
}

function wireDuress() {
  const setupBtn = qs("#duress-setup-btn");
  if (setupBtn) setupBtn.onclick = () => {
    const code = prompt("Elegí un gesto o PIN que uses solo si te obligan a hacer el check-in (ej: 0000).");
    if (!code) return;
    const acc = getAccount();
    acc.duress = { status: "step1", code };
    saveAccount(acc);
    render();
    showToast("Duress code guardado — te lo confirmamos más adelante");
  };

  const confirmBtn = qs("#duress-confirm-btn");
  if (confirmBtn) confirmBtn.onclick = () => {
    const acc = getAccount();
    const typed = prompt("Repetí tu duress code para confirmarlo:");
    if (typed === acc.duress.code) {
      acc.duress.status = "confirmed";
      saveAccount(acc);
      render();
      showToast("Duress code confirmado");
    } else {
      showToast("No coincide — probá de nuevo más tarde");
    }
  };

  const resetBtn = qs("#duress-reset-btn");
  if (resetBtn) resetBtn.onclick = () => {
    if (!confirm("¿Borrar tu duress code?")) return;
    const acc = getAccount();
    acc.duress = { status: "none" };
    saveAccount(acc);
    render();
  };
}

render();
