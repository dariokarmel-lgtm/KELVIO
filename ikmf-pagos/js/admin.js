/*
 * Administración global: alta / edición / baja de directores e
 * instructores (vía la function manage-user) y países (moneda, cuota por
 * defecto). Solo accesible para role = admin.
 */

let countries = [];
let users = [];

function $(id) { return document.getElementById(id); }

function countryName(id) {
  const c = countries.find((x) => x.id === id);
  return c ? c.name : "—";
}

async function load() {
  const [c, u] = await Promise.all([
    sb.from("countries").select("*").order("name"),
    sb.from("profiles").select("*").order("full_name"),
  ]);
  if (c.error) throw c.error;
  if (u.error) throw u.error;
  countries = c.data;
  registerCountries(countries);
  users = u.data;
}

function renderFilters() {
  const sel = $("u-country");
  const current = sel.value;
  sel.innerHTML = `<option value="">${esc(t("adm.all_countries"))}</option><option value="none">${esc(t("adm.no_country"))}</option>` +
    countries.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  sel.value = current;
}

function renderUsers() {
  const q = $("u-search").value.trim().toLowerCase();
  const cf = $("u-country").value;
  const rf = $("u-role").value;
  const showLeft = $("u-left").checked;
  const list = users.filter((u) =>
    (!q || (u.full_name || "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
    (!cf || (cf === "none" ? !u.country_id : u.country_id === cf)) &&
    (!rf || u.role === rf) &&
    (showLeft || accountState(u) !== "left"));

  $("u-count").textContent = t("adm.count", { n: list.length, total: users.length });

  $("users-body").innerHTML = list.map((u) => {
    let actions = "";
    if (u.role === "admin") {
      // A otros admins solo se les puede reenviar el acceso; el resto, por SQL.
      actions = u.id === ME.id
        ? `<span class="sub">${esc(t("adm.sql_managed"))}</span>`
        : `<button class="btn sm ghost" data-resend="${u.id}">${esc(t("user.resend"))}</button>`;
    } else {
      const st = accountState(u);
      if (st === "pending") actions += `<button class="btn sm success" data-activate="${u.id}">${esc(t("user.activate"))}</button> `;
      actions += `<button class="btn sm ghost" data-edit-user="${u.id}">${esc(t("common.edit"))}</button> `;
      actions += st === "left"
        ? `<button class="btn sm ghost" data-activate="${u.id}">${esc(t("user.reactivate"))}</button>`
        : `<button class="btn sm ghost" data-deactivate="${u.id}">${esc(t("user.deactivate"))}</button>`;
      if (st !== "left") actions += ` <button class="btn sm ghost" data-resend="${u.id}">${esc(t("user.resend"))}</button>`;
    }
    return `<tr>
      <td><strong>${esc(u.full_name || t("common.no_name"))}</strong>${u.id === ME.id ? ` <span class="sub">${esc(t("common.you"))}</span>` : ""}
        <div class="sub" dir="ltr">${esc(u.email)}${u.phone ? " · " + esc(u.phone) : ""}</div></td>
      <td>${esc(countryName(u.country_id))}</td>
      <td>${esc(roleLabel(u.role))}</td>
      <td>${accountChip(u)}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" class="empty">${esc(t("adm.no_users"))}</td></tr>`;
}

function userById(id) {
  return users.find((u) => u.id === id);
}

function openAdminUserForm(user) {
  openUserForm({
    user,
    roles: ["instructor", "director"],
    countries,
    country: null,
    onSaved: refresh,
  });
}

function renderCountries() {
  $("countries-body").innerHTML = countries.map((c) => {
    const directors = users.filter((u) => u.role === "director" && u.country_id === c.id);
    return `<tr data-country="${c.id}">
      <td><input class="input sm f-name" value="${esc(c.name)}" style="width:160px" /></td>
      <td><input class="input sm f-code" value="${esc(c.code)}" maxlength="2" style="width:60px" /></td>
      <td><input class="input sm f-currency" value="${esc(c.currency)}" maxlength="3" style="width:70px" /></td>
      <td><input class="input sm f-fee" type="number" min="0" step="0.01" value="${c.default_fee}" style="width:110px" /></td>
      <td><select class="input sm f-region" style="width:150px">${regionOptions(c.region)}</select></td>
      <td><input class="input sm f-first" type="month" value="${c.first_month ? c.first_month.slice(0, 7) : ""}" style="width:150px" /></td>
      <td>${directors.length
        ? directors.map((d) => `${esc(d.full_name || d.email)}${d.active ? "" : " " + accountChip(d)}`).join("<br>")
        : `<span class="sub">${esc(t("adm.no_director"))}</span>`}</td>
      <td class="actions">
        <button class="btn sm dark" data-save-country="${c.id}">${esc(t("common.save"))}</button>
        <button class="btn sm ghost" data-delete-country="${c.id}">${esc(t("common.delete"))}</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="empty">${esc(t("adm.no_countries"))}</td></tr>`;
}

function renderAll() {
  renderFilters();
  renderUsers();
  renderCountries();
}

async function refresh() {
  try {
    await load();
  } catch (e) {
    toast(errMsg(e), true);
  }
  renderAll();
}

function regionOptions(selected) {
  return `<option value="">${esc(t("region.none"))}</option>` +
    REGIONS.map((r) => `<option value="${r}" ${r === selected ? "selected" : ""}>${esc(regionLabel(r))}</option>`).join("");
}

function countryRow(prefix, root) {
  const get = (cls) => root.querySelector(cls).value.trim();
  const first = get(`${prefix}first`);
  return {
    name: get(`${prefix}name`),
    code: get(`${prefix}code`).toUpperCase(),
    currency: get(`${prefix}currency`).toUpperCase(),
    default_fee: Number(get(`${prefix}fee`) || 0),
    region: get(`${prefix}region`) || null,
    first_month: first ? `${first}-01` : null,
  };
}

function validCountry(c) {
  if (!c.name) return t("adm.err_name");
  if (!/^[A-Z]{2}$/.test(c.code)) return t("adm.err_code");
  if (!/^[A-Z]{3}$/.test(c.currency)) return t("adm.err_currency");
  if (!(c.default_fee >= 0)) return t("adm.err_fee");
  return null;
}

async function saveCountry(id) {
  const tr = document.querySelector(`tr[data-country="${id}"]`);
  const row = countryRow(".f-", tr);
  const v = validCountry(row);
  if (v) return toast(v, true);
  const { error } = await sb.from("countries").update(row).eq("id", id);
  if (error) return toast(errMsg(error), true);
  toast(t("adm.country_saved"));
  await refresh();
}

async function deleteCountry(id) {
  const n = users.filter((u) => u.country_id === id).length;
  if (n) return toast(t("adm.cant_delete", { n }), true);
  if (!confirm(t("adm.confirm_delete", { name: countryName(id) }))) return;
  const { error } = await sb.from("countries").delete().eq("id", id);
  if (error) return toast(errMsg(error), true);
  toast(t("adm.country_deleted"));
  await refresh();
}

function setTab(tab) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["users", "countries"].forEach((x) => $(`tab-${x}`).classList.toggle("hidden", x !== tab));
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.tab) setTab(b.dataset.tab);
  if (b.dataset.editUser) openAdminUserForm(userById(b.dataset.editUser));
  if (b.dataset.deactivate) openDeactivateForm(userById(b.dataset.deactivate), refresh);
  if (b.dataset.activate) reactivateUser(userById(b.dataset.activate), refresh);
  if (b.dataset.resend) resendAccess(userById(b.dataset.resend));
  if (b.dataset.saveCountry) saveCountry(b.dataset.saveCountry);
  if (b.dataset.deleteCountry) deleteCountry(b.dataset.deleteCountry);
});

(async function init() {
  if (!(await requireRole(["admin"]))) return;
  $("c-region").innerHTML = regionOptions("");

  ["u-search", "u-country", "u-role", "u-left"].forEach((id) => $(id).addEventListener("input", renderUsers));
  $("new-user-btn").addEventListener("click", () => openAdminUserForm(null));

  $("c-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = countryRow("#c-", e.target);
    const v = validCountry(row);
    if (v) return toast(v, true);
    const { error } = await sb.from("countries").insert(row);
    if (error) return toast(errMsg(error), true);
    e.target.reset();
    toast(t("adm.country_added"));
    await refresh();
  });

  await refresh();
})();
