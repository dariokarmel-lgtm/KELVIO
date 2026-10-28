/*
 * Ingreso, registro y recuperación de contraseña.
 * Modos: login | signup | forgot | recovery (al volver del mail de reseteo
 * o del mail de invitación cuando un director/admin crea la cuenta).
 */

let mode = "login";

const $ = (id) => document.getElementById(id);

function showMsg(text, kind) {
  const el = $("msg");
  el.className = `banner ${kind || "error"}`;
  el.textContent = text;
}

function hideMsg() {
  $("msg").className = "banner hidden";
}

function setMode(next) {
  mode = next;
  hideMsg();
  document.querySelectorAll("#mode-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.mode === next));
  $("mode-tabs").classList.toggle("hidden", next === "recovery");
  document.querySelector(".signup-only").classList.toggle("hidden", next !== "signup");
  document.querySelector(".email-field").classList.toggle("hidden", next === "recovery");
  document.querySelector(".password-field").classList.toggle("hidden", next === "forgot");
  $("forgot-link").classList.toggle("hidden", next !== "login");
  $("f-password").autocomplete = next === "login" ? "current-password" : "new-password";
  $("submit-btn").textContent = t({
    login: "login.btn_login",
    signup: "login.btn_signup",
    forgot: "login.btn_forgot",
    recovery: "login.btn_recovery",
  }[next]);
  $("password-label").textContent = t(next === "recovery" ? "login.choose_password" : "login.password");
}

async function loadCountries() {
  const { data, error } = await sb.from("countries").select("id, name").order("name");
  const sel = $("f-country");
  if (error) {
    sel.innerHTML = `<option value="">${esc(t("login.countries_error"))}</option>`;
    return;
  }
  sel.innerHTML = `<option value="">${esc(t("login.choose_country"))}</option>` +
    data.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
}

async function goHome() {
  const me = await loadMe();
  if (me) location.href = homeFor(me);
}

async function onSubmit(e) {
  e.preventDefault();
  hideMsg();
  const email = $("f-email").value.trim();
  const password = $("f-password").value;
  const btn = $("submit-btn");
  btn.disabled = true;

  try {
    if (mode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await goHome();
    } else if (mode === "signup") {
      const full_name = $("f-name").value.trim();
      const country_id = $("f-country").value;
      const phone = $("f-phone").value.trim();
      if (!full_name) throw new Error(t("login.err_name"));
      if (!country_id) throw new Error(t("login.err_country"));
      if (password.length < 8) throw new Error(t("login.err_password"));
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { full_name, country_id, phone },
          emailRedirectTo: location.origin + location.pathname,
        },
      });
      if (error) throw error;
      if (data.session) {
        await goHome();
      } else {
        setMode("login");
        showMsg(t("login.signup_ok"), "ok");
      }
    } else if (mode === "forgot") {
      if (!email) throw new Error(t("login.err_email"));
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname,
      });
      if (error) throw error;
      setMode("login");
      showMsg(t("login.forgot_ok"), "ok");
    } else if (mode === "recovery") {
      if (password.length < 8) throw new Error(t("login.err_password"));
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      await goHome();
    }
  } catch (err) {
    showMsg(errMsg(err));
  } finally {
    btn.disabled = false;
  }
}

document.querySelectorAll("#mode-tabs button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
$("forgot-link").addEventListener("click", (e) => { e.preventDefault(); setMode("forgot"); });
$("auth-form").addEventListener("submit", onSubmit);

let recovering = false;
sb.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") {
    recovering = true;
    setMode("recovery");
  }
});

(async function init() {
  applyI18n();
  $("lang-slot").innerHTML = langSelectHTML("login-lang");
  bindLangSelect($("login-lang"));
  loadCountries();
  // Si ya hay sesión (y no es un reseteo de contraseña), entrar directo.
  const { data: { session } } = await sb.auth.getSession();
  const fromEmailLink = /type=(recovery|invite)/.test(INITIAL_HASH);
  if (session && fromEmailLink) {
    recovering = true;
    setMode("recovery");
    if (INITIAL_HASH.includes("type=invite")) showMsg(t("login.welcome_invite"), "info");
    return;
  }
  if (session && !recovering) {
    try { await goHome(); } catch { /* perfil inaccesible: se queda en el login */ }
  }
})();
