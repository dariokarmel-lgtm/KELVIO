/* Gestión de destinatarios (contactos de confianza). */

let showForm = false;

function render() {
  const recipients = getRecipients();
  const switches = getSwitches();

  qs("#main").innerHTML = `
    <div class="info-banner">
      ℹ️ Un destinatario nunca recibe la alerta real como primer contacto: siempre le mandamos
      antes una invitación para que confirme que quiere ser tu contacto de confianza.
    </div>

    ${showForm ? formHtml() : ""}

    ${recipients.length === 0 ? `
      <div class="empty-state">
        <span class="icon">👥</span>
        <p>Todavía no agregaste destinatarios.</p>
        <button class="btn btn-primary" style="width:auto; display:inline-flex;" onclick="openForm()">+ Agregar destinatario</button>
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
      <p class="eyebrow">Nuevo destinatario</p>
      <div class="field">
        <label for="nf-name">Nombre</label>
        <input class="input" id="nf-name" placeholder="Ej: Juan Pérez" />
      </div>
      <div class="field">
        <label for="nf-phone">Teléfono</label>
        <input class="input" id="nf-phone" placeholder="+54 9 11 ..." />
      </div>
      <div class="field mb-0">
        <label for="nf-email">Email</label>
        <input class="input" id="nf-email" placeholder="nombre@email.com" />
      </div>
      <div class="flex gap-8 mt-16">
        <button class="btn btn-secondary" id="cancel-form">Cancelar</button>
        <button class="btn btn-primary" id="submit-form">Enviar invitación</button>
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
      ${usedIn.length ? `<div class="text-sm muted mt-8">En: ${usedIn.map((s) => s.name).join(", ")}</div>` : ""}
      ${isVerifierFor.length ? `<div class="mt-8"><span class="badge badge-violet">Verificador de ${isVerifierFor.map((s) => s.name).join(", ")}</span></div>` : ""}

      ${r.status !== "confirmed" ? `
        <div class="demo-banner mt-8" style="margin-bottom:0;">
          <strong>DEMO</strong> En la app real, este estado cambia cuando la persona responde el link de invitación.
          <div class="flex gap-8 mt-8">
            <button class="btn btn-outline btn-sm" onclick="setStatus('${r.id}','confirmed')">Simular: confirmó</button>
            <button class="btn btn-outline btn-sm" onclick="setStatus('${r.id}','rejected')">Simular: rechazó</button>
          </div>
        </div>
      ` : ""}

      <button class="btn btn-ghost btn-sm mt-8" style="width:auto; color:var(--color-red);" onclick="removeRecipient('${r.id}')">Quitar destinatario</button>
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

function submitForm() {
  const name = qs("#nf-name").value.trim();
  const phone = qs("#nf-phone").value.trim();
  const email = qs("#nf-email").value.trim();
  if (!name || (!phone && !email)) {
    showToast("Completá al menos nombre y un contacto");
    return;
  }
  saveRecipient({ name, phone, email, status: "pending" });
  addHistory({ switchId: null, type: "invite", note: `Invitación enviada a ${name}` });
  showForm = false;
  render();
  showToast(`Invitación "enviada" a ${name} (simulado)`);
}

function setStatus(id, status) {
  const r = getRecipient(id);
  if (!r) return;
  r.status = status;
  saveRecipient(r);
  addHistory({ switchId: null, type: "invite_response", note: `${r.name} ${status === "confirmed" ? "confirmó" : "rechazó"} la invitación` });
  render();
}

function removeRecipient(id) {
  if (!confirm("¿Quitar este destinatario? Se sacará de los switches que lo tengan.")) return;
  const switches = getSwitches();
  switches.forEach((s) => {
    if (s.recipients.includes(id)) {
      s.recipients = s.recipients.filter((rid) => rid !== id);
      if (s.verifierId === id) s.verifierId = null;
      saveSwitch(s);
    }
  });
  deleteRecipient(id);
  render();
  showToast("Destinatario eliminado");
}

render();
