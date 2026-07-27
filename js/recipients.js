/* Gestión de destinatarios (contactos de confianza). */

let showForm = false;

function render() {
  const recipients = getRecipients();
  const switches = getSwitches();

  qs("#main").innerHTML = `
    <div class="info-banner">
      ℹ️ ${t("recipients.info_banner")}
    </div>

    ${showForm ? formHtml() : ""}

    ${recipients.length === 0 ? `
      <div class="empty-state">
        <span class="icon">👥</span>
        <p>${t("recipients.empty")}</p>
        <button class="btn btn-primary" style="width:auto; display:inline-flex;" onclick="openForm()">${t("recipients.add_btn")}</button>
      </div>
    ` : recipients.map((r) => rowHtml(r, switches)).join("")}
  `;

  if (showForm) {
    qs("#cancel-form").onclick = closeForm;
    qs("#submit-form").onclick = submitForm;
  }
}

function formHtml() {
  return `
    <div class="card" id="add-form">
      <p class="eyebrow">${t("recipients.form_title")}</p>
      <div class="field">
        <label for="nf-name">${t("recipients.name_label")}</label>
        <input class="input" id="nf-name" placeholder="${t("recipients.name_placeholder")}" />
      </div>
      <div class="field">
        <label for="nf-phone">${t("recipients.phone_label")}</label>
        <input class="input" id="nf-phone" placeholder="+54 9 11 ..." />
      </div>
      <div class="field mb-0">
        <label for="nf-email">${t("recipients.email_label")}</label>
        <input class="input" id="nf-email" placeholder="${t("recipients.email_placeholder")}" />
      </div>
      <div class="flex gap-8 mt-16">
        <button class="btn btn-secondary" id="cancel-form">${t("common.cancel")}</button>
        <button class="btn btn-primary" id="submit-form">${t("recipients.submit_btn")}</button>
      </div>
    </div>
  `;
}

function rowHtml(r, switches) {
  const meta = recipientStatusMeta(r.status);
  const usedIn = switches.filter((s) => s.recipients.includes(r.id));
  const isVerifierFor = switches.filter((s) => s.verifierId === r.id);

  return `
    <div class="card">
      <div class="card-row">
        <span class="avatar">${initials(r.name)}</span>
        <div class="flex-1">
          <div style="font-weight:700; font-size:15px;">${r.name}</div>
          <div class="text-sm muted">${r.phone || ""}${r.phone && r.email ? " · " : ""}${r.email || ""}</div>
        </div>
        <span class="badge ${meta.badge}">${meta.icon} ${meta.label}</span>
      </div>
      ${usedIn.length ? `<div class="text-sm muted mt-8">${t("recipients.used_in", { list: usedIn.map((s) => s.name).join(", ") })}</div>` : ""}
      ${isVerifierFor.length ? `<div class="mt-8"><span class="badge badge-violet">${t("recipients.verifier_of", { list: isVerifierFor.map((s) => s.name).join(", ") })}</span></div>` : ""}

      ${r.status === "pending" ? `
        <div class="info-banner mt-8" style="margin-bottom:0;">
          ${t("recipients.pending_note")}
          <div class="mt-8"><button class="btn btn-outline btn-sm" onclick="resendInvite('${r.id}')">${t("recipients.resend_btn")}</button></div>
        </div>
      ` : ""}

      <button class="btn btn-ghost btn-sm mt-8" style="width:auto; color:var(--color-red);" onclick="removeRecipient('${r.id}')">${t("recipients.remove_btn")}</button>
    </div>
  `;
}

function openForm() {
  showForm = true;
  render();
  setTimeout(() => qs("#nf-name")?.focus(), 50);
}

function closeForm() {
  showForm = false;
  render();
}

async function submitForm() {
  const name = qs("#nf-name").value.trim();
  const phone = qs("#nf-phone").value.trim();
  const email = qs("#nf-email").value.trim();
  if (!name || (!phone && !email)) {
    showToast(t("recipients.toast_missing_fields"));
    return;
  }

  const submitBtn = qs("#submit-form");
  submitBtn.disabled = true;
  try {
    const saved = await saveRecipient({ name, phone, email, status: "pending" });
    await callFunction("send-invite", { recipientId: saved.id });
    await loadAll();
    showForm = false;
    render();
    showToast(t("recipients.toast_invite_sent", { name }));
  } catch (e) {
    console.error(e);
    submitBtn.disabled = false;
    showToast(t("home.toast_alert_error"));
  }
}

async function resendInvite(id) {
  try {
    await callFunction("send-invite", { recipientId: id });
    await loadAll();
    render();
    showToast(t("recipients.toast_invite_sent", { name: getRecipient(id)?.name || "" }));
  } catch (e) {
    console.error(e);
    showToast(t("home.toast_alert_error"));
  }
}

async function removeRecipient(id) {
  if (!confirm(t("recipients.confirm_remove"))) return;
  const switches = getSwitches();
  for (const s of switches) {
    if (s.recipients.includes(id)) {
      s.recipients = s.recipients.filter((rid) => rid !== id);
      if (s.verifierId === id) s.verifierId = null;
      await saveSwitch(s);
    }
  }
  await deleteRecipient(id);
  render();
  showToast(t("recipients.toast_removed"));
}

(async function boot() {
  const session = await requireSession();
  if (!session) return;
  await loadAll();
  qs("#fab-add").title = t("recipients.add_btn");
  render();
})();
