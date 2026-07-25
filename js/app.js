/* Helpers compartidos por todas las pantallas. */

document.addEventListener("DOMContentLoaded", () => {
  // Resalta el ítem activo del bottom nav según data-page en <body>.
  const page = document.body.dataset.page;
  if (page) {
    document.querySelectorAll(".bottom-nav a[data-nav]").forEach((a) => {
      if (a.dataset.nav === page) a.classList.add("active");
    });
  }
});

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
      return { label: "Activo", dot: "dot-green", badge: "badge-green" };
    case "grace":
      return { label: "En gracia — sin confirmar", dot: "dot-yellow", badge: "badge-yellow" };
    case "alarm":
      return { label: "¡Venció! Alarma en curso", dot: "dot-red", badge: "badge-red" };
    case "triggered":
      return { label: "Alerta enviada", dot: "dot-red", badge: "badge-red" };
    case "off":
      return { label: "Apagado", dot: "dot-gray", badge: "badge-gray" };
    default:
      return { label: status, dot: "dot-gray", badge: "badge-gray" };
  }
}

function recipientStatusMeta(status) {
  switch (status) {
    case "confirmed":
      return { label: "Confirmado", icon: "🟢", badge: "badge-green" };
    case "pending":
      return { label: "Pendiente", icon: "🟡", badge: "badge-yellow" };
    case "rejected":
      return { label: "Rechazó / no respondió", icon: "🔴", badge: "badge-red" };
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
