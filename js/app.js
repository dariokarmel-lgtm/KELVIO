/* Helpers compartidos por todas las pantallas. */

document.addEventListener("DOMContentLoaded", () => {
  // Resalta el ítem activo del bottom nav según data-page en <body>.
  const page = document.body.dataset.page;
  if (page) {
    document.querySelectorAll(".bottom-nav a[data-nav]").forEach((a) => {
      if (a.dataset.nav === page) a.classList.add("active");
    });
  }

  applyStaticTranslations();
});

// Traduce el markup estático (nav, aria-labels, títulos fijos) declarado con
// data-i18n / data-i18n-attr. El contenido armado por JS se traduce en cada render().
function applyStaticTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    el.dataset.i18nAttr.split(";").forEach((pair) => {
      const [attr, key] = pair.split(":").map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
}

let toastTimer = null;
function showToast(msg, ms = 2600) {
  let el = document.getElementById("global-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "global-toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

function qs(sel, root = document) {
  return root.querySelector(sel);
}
function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}
function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

function statusMeta(status) {
  switch (status) {
    case "active":
      return { label: t("status.active"), dot: "dot-green", badge: "badge-green" };
    case "grace":
      return { label: t("status.grace"), dot: "dot-yellow", badge: "badge-yellow" };
    case "alarm":
      return { label: t("status.alarm"), dot: "dot-red", badge: "badge-red" };
    case "triggered":
      return { label: t("status.triggered"), dot: "dot-red", badge: "badge-red" };
    case "off":
      return { label: t("status.off"), dot: "dot-gray", badge: "badge-gray" };
    default:
      return { label: status, dot: "dot-gray", badge: "badge-gray" };
  }
}

function modeLabel(mode) {
  return mode === "legado" ? t("common.mode_legado") : t("common.mode_cuidame");
}

function recipientStatusMeta(status) {
  switch (status) {
    case "confirmed":
      return { label: t("recipient_status.confirmed"), icon: "🟢", badge: "badge-green" };
    case "pending":
      return { label: t("recipient_status.pending"), icon: "🟡", badge: "badge-yellow" };
    case "rejected":
      return { label: t("recipient_status.rejected"), icon: "🔴", badge: "badge-red" };
    default:
      return { label: status, icon: "⚪", badge: "badge-gray" };
  }
}

function initials(name) {
  return name
    .split(/\s+/)
    .map((word) => (word.match(/\p{L}/u) || [""])[0])
    .filter(Boolean)
    .slice(0, 2)
    .map((ch) => ch.toUpperCase())
    .join("");
}

/*
 * Gate de autenticación para entrar a configuración crítica (destinatarios,
 * intervalo, apagar el switch). Biometría si está activada; si no, PIN.
 * Si el usuario no configuró ninguna de las dos, caemos a una confirmación
 * simple para no bloquear el prototipo.
 */
function requireCriticalAuth(onSuccess) {
  const acc = getAccount();
  if (acc.biometric) {
    showBiometricModal(onSuccess);
  } else if (acc.securityCode) {
    const typed = prompt(t("auth.enter_code"));
    if (typed == null) return;
    if (typed === acc.securityCode) onSuccess();
    else showToast(t("auth.wrong_code"));
  } else if (confirm(t("checkin.gear_confirm"))) {
    onSuccess();
  }
}

function showBiometricModal(onSuccess) {
  const wrap = document.createElement("div");
  wrap.className = "auth-modal-wrap";
  wrap.innerHTML = `
    <div class="auth-modal">
      <div class="auth-modal-icon">👆</div>
      <h2>${t("auth.biometric_title")}</h2>
      <p>${t("auth.biometric_desc")}</p>
      <button class="btn btn-primary" id="auth-confirm-btn">${t("auth.biometric_confirm_btn")}</button>
      <button class="btn btn-ghost" id="auth-cancel-btn">${t("auth.biometric_cancel_btn")}</button>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  qs("#auth-confirm-btn", wrap).onclick = () => {
    close();
    onSuccess();
  };
  qs("#auth-cancel-btn", wrap).onclick = close;
}
