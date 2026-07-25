/* Cuenta, plan, biometría, idioma y duress code. */

function render() {
  const acc = getAccount();

  qs("#main").innerHTML = `
    <div class="section-title">${t("settings.language_section")}</div>
    <div class="lang-grid" id="lang-grid">
      ${Object.keys(LANGS).map((code) => `
        <button class="lang-chip ${getLang() === code ? "selected" : ""}" data-lang="${code}">${LANGS[code].label}</button>
      `).join("")}
    </div>

    <div class="section-title">${t("settings.account_section")}</div>
    <div class="card">
      <div class="card-row">
        <span style="font-size:18px;">📱</span>
        <span class="flex-1">${acc.phone}</span>
        <span class="badge ${acc.phoneVerified ? "badge-green" : "badge-yellow"}">${acc.phoneVerified ? t("common.verified") : t("common.pending")}</span>
      </div>
      <div class="card-row mt-8">
        <span style="font-size:18px;">✉️</span>
        <span class="flex-1">${acc.email}</span>
        <span class="badge ${acc.emailVerified ? "badge-green" : "badge-yellow"}">${acc.emailVerified ? t("common.verified") : t("common.pending")}</span>
      </div>
      <p class="hint mt-8">${t("settings.account_hint")}</p>
    </div>

    <div class="section-title">${t("settings.plan_section")}</div>
    <div class="card">
      <div class="card-row">
        <span class="flex-1">
          <div style="font-weight:700;">${acc.plan === "free" ? t("settings.plan_free") : "Pro"}</div>
          <div class="text-sm muted">${acc.plan === "free" ? t("settings.plan_free_desc") : t("settings.plan_pro_desc")}</div>
        </span>
        <span class="badge badge-primary">${acc.plan === "free" ? "Free" : "Pro"}</span>
      </div>
      ${acc.plan === "free" ? `<button class="btn btn-primary mt-16" onclick="showToast(t('create.toast_plans_pending'))">${t("settings.upgrade_btn")}</button>` : ""}
    </div>

    <div class="section-title">${t("settings.security_section")}</div>
    <div class="card">
      <div class="checkbox-row" style="border-bottom:none;">
        <span class="flex-1">
          <label style="margin:0; display:block;">${t("settings.biometric_label")}</label>
          <span class="hint" style="margin:2px 0 0;">${t("settings.biometric_hint")}</span>
        </span>
        <span class="toggle"><input type="checkbox" id="f-bio" ${acc.biometric ? "checked" : ""} /><span class="track"></span></span>
      </div>
    </div>

    <div class="card" id="duress-card">
      ${duressHtml(acc)}
    </div>

    <div class="section-title">${t("settings.trust_section")}</div>
    <a class="card card-tap" href="test-mode.html">
      <div class="card-row">
        <span style="font-size:20px;">🧪</span>
        <div class="flex-1">
          <div style="font-weight:700; font-size:14px;">${t("settings.test_mode_title")}</div>
          <div class="text-sm muted">${t("settings.test_mode_desc")}</div>
        </div>
        <span class="muted">›</span>
      </div>
    </a>

    <div class="section-title" style="color:var(--color-red);">${t("settings.critical_zone")}</div>
    <button class="btn btn-outline mt-8" style="border-color:var(--color-red); color:var(--color-red);" onclick="showToast(t('settings.toast_logout_pending'))">${t("settings.logout_btn")}</button>
  `;

  qs("#f-bio").onchange = (e) => {
    acc.biometric = e.target.checked;
    saveAccount(acc);
    showToast(acc.biometric ? t("settings.toast_bio_on") : t("settings.toast_bio_off"));
  };

  qsa("#lang-grid .lang-chip").forEach((btn) => {
    btn.onclick = () => {
      setLang(btn.dataset.lang);
      render();
      applyStaticTranslations();
    };
  });

  wireDuress();
}

function duressHtml(acc) {
  const d = acc.duress || { status: "none" };
  if (d.status === "none") {
    return `
      <p style="font-weight:700; margin:0 0 4px;">${t("settings.duress_title_none")}</p>
      <p class="text-sm muted" style="margin:0 0 12px;">${t("settings.duress_desc_none")}</p>
      <button class="btn btn-secondary" id="duress-setup-btn">${t("settings.duress_setup_btn")}</button>
    `;
  }
  if (d.status === "step1") {
    return `
      <p style="font-weight:700; margin:0 0 4px;">${t("settings.duress_title_step1")}</p>
      <p class="text-sm muted" style="margin:0 0 12px;">${t("settings.duress_desc_step1", { code: d.code })}</p>
      <div class="demo-banner" style="margin-bottom:0;">
        <strong>${t("common.demo")}</strong> ${t("settings.duress_demo_note")}
        <div class="mt-8"><button class="btn btn-outline btn-sm" id="duress-confirm-btn">${t("settings.duress_confirm_btn")}</button></div>
      </div>
    `;
  }
  return `
    <p style="font-weight:700; margin:0 0 4px;">${t("settings.duress_title_confirmed")}</p>
    <p class="text-sm muted" style="margin:0 0 12px;">${t("settings.duress_desc_confirmed")}</p>
    <button class="btn btn-outline btn-sm" style="width:auto;" id="duress-reset-btn">${t("settings.duress_delete_btn")}</button>
  `;
}

function wireDuress() {
  const setupBtn = qs("#duress-setup-btn");
  if (setupBtn) setupBtn.onclick = () => {
    const code = prompt(t("settings.duress_prompt_setup"));
    if (!code) return;
    const acc = getAccount();
    acc.duress = { status: "step1", code };
    saveAccount(acc);
    render();
    showToast(t("settings.duress_toast_saved"));
  };

  const confirmBtn = qs("#duress-confirm-btn");
  if (confirmBtn) confirmBtn.onclick = () => {
    const acc = getAccount();
    const typed = prompt(t("settings.duress_prompt_confirm"));
    if (typed === acc.duress.code) {
      acc.duress.status = "confirmed";
      saveAccount(acc);
      render();
      showToast(t("settings.duress_toast_confirmed"));
    } else {
      showToast(t("settings.duress_toast_mismatch"));
    }
  };

  const resetBtn = qs("#duress-reset-btn");
  if (resetBtn) resetBtn.onclick = () => {
    if (!confirm(t("settings.duress_confirm_delete"))) return;
    const acc = getAccount();
    acc.duress = { status: "none" };
    saveAccount(acc);
    render();
  };
}

render();
