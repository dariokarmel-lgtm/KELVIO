/*
 * Configuración de la cuenta propia (todos los roles): datos de la cuenta y
 * cambio de contraseña. Se verifica la contraseña actual antes de cambiarla.
 */

function $(id) { return document.getElementById(id); }

function showMsg(text, kind) {
  $("pw-msg").innerHTML = text ? `<div class="banner ${kind || "error"}">${esc(text)}</div>` : "";
}

function renderAccount() {
  const kv = (label, value) => `<dt>${esc(t(label))}</dt><dd>${esc(value || "—")}</dd>`;
  $("account-info").innerHTML =
    kv("common.name", ME.full_name) +
    `<dt>${esc(t("common.email"))}</dt><dd dir="ltr">${esc(ME.email)}</dd>` +
    kv("common.role", roleLabel(ME.role)) +
    kv("common.country", ME.country ? ME.country.name : "");
}

async function changePassword(e) {
  e.preventDefault();
  showMsg("");
  const current = $("pw-current").value;
  const next = $("pw-new").value;
  const confirm = $("pw-confirm").value;
  if (!current) return showMsg(t("set.err_current_empty"));
  if (next.length < 8) return showMsg(t("login.err_password"));
  if (next !== confirm) return showMsg(t("set.err_match"));
  if (next === current) return showMsg(t("set.err_same"));

  const btn = $("pw-save");
  btn.disabled = true;
  try {
    // Verificar la contraseña actual antes de cambiarla.
    const { error: authErr } = await sb.auth.signInWithPassword({ email: ME.email, password: current });
    if (authErr) return showMsg(t("set.err_current"));
    const { error } = await sb.auth.updateUser({ password: next });
    if (error) throw error;
    $("pw-form").reset();
    showMsg(t("set.saved"), "ok");
  } catch (err) {
    showMsg(errMsg(err));
  } finally {
    btn.disabled = false;
  }
}

(async function init() {
  if (!(await requireRole())) return;
  renderAccount();
  $("pw-form").addEventListener("submit", changePassword);
  $("pw-show").addEventListener("change", (e) => {
    ["pw-current", "pw-new", "pw-confirm"].forEach((id) => { $(id).type = e.target.checked ? "text" : "password"; });
  });
})();
