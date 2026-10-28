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
  users = u.data;
}

function renderFilters() {
  const sel = $("u-country");
  const current = sel.value;
  sel.innerHTML = `<option value="">Todos los países</option><option value="none">Sin país</option>` +
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

  $("u-count").textContent = `${list.length} de ${users.length}`;

  $("users-body").innerHTML = list.map((u) => {
    let actions = "";
    if (u.role === "admin") {
      actions = `<span class="sub">Se gestiona por SQL</span>`;
    } else {
      const st = accountState(u);
      if (st === "pending") actions += `<button class="btn sm success" data-activate="${u.id}">Activar</button> `;
      actions += `<button class="btn sm ghost" data-edit-user="${u.id}">Editar</button> `;
      actions += st === "left"
        ? `<button class="btn sm ghost" data-activate="${u.id}">Reactivar</button>`
        : `<button class="btn sm ghost" data-deactivate="${u.id}">Dar de baja</button>`;
    }
    return `<tr>
      <td><strong>${esc(u.full_name || "(sin nombre)")}</strong>${u.id === ME.id ? ' <span class="sub">(vos)</span>' : ""}
        <div class="sub">${esc(u.email)}${u.phone ? " · " + esc(u.phone) : ""}</div></td>
      <td>${esc(countryName(u.country_id))}</td>
      <td>${ROLE_LABELS[u.role]}</td>
      <td>${accountChip(u)}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" class="empty">No hay usuarios con ese filtro.</td></tr>`;
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
      <td>${directors.length
        ? directors.map((d) => `${esc(d.full_name || d.email)}${d.active ? "" : " " + accountChip(d)}`).join("<br>")
        : '<span class="sub">Sin director — asignalo desde Usuarios</span>'}</td>
      <td class="actions">
        <button class="btn sm dark" data-save-country="${c.id}">Guardar</button>
        <button class="btn sm ghost" data-delete-country="${c.id}">Eliminar</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="empty">No hay países cargados.</td></tr>`;
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

function countryRow(prefix, root) {
  const get = (cls) => root.querySelector(cls).value.trim();
  return {
    name: get(`${prefix}name`),
    code: get(`${prefix}code`).toUpperCase(),
    currency: get(`${prefix}currency`).toUpperCase(),
    default_fee: Number(get(`${prefix}fee`) || 0),
  };
}

function validCountry(c) {
  if (!c.name) return "Falta el nombre del país.";
  if (!/^[A-Z]{2}$/.test(c.code)) return "El código tiene que ser de 2 letras (ISO), ej. AR.";
  if (!/^[A-Z]{3}$/.test(c.currency)) return "La moneda tiene que ser un código de 3 letras, ej. ARS, USD, EUR.";
  if (!(c.default_fee >= 0)) return "La cuota no puede ser negativa.";
  return null;
}

async function saveCountry(id) {
  const tr = document.querySelector(`tr[data-country="${id}"]`);
  const row = countryRow(".f-", tr);
  const v = validCountry(row);
  if (v) return toast(v, true);
  const { error } = await sb.from("countries").update(row).eq("id", id);
  if (error) return toast(errMsg(error), true);
  toast("País actualizado.");
  await refresh();
}

async function deleteCountry(id) {
  const n = users.filter((u) => u.country_id === id).length;
  if (n) return toast(`No se puede eliminar: hay ${n} usuario(s) en ese país. Reasignalos primero.`, true);
  if (!confirm(`¿Eliminar ${countryName(id)}?`)) return;
  const { error } = await sb.from("countries").delete().eq("id", id);
  if (error) return toast(errMsg(error), true);
  toast("País eliminado.");
  await refresh();
}

function setTab(tab) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["users", "countries"].forEach((t) => $(`tab-${t}`).classList.toggle("hidden", t !== tab));
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.tab) setTab(t.dataset.tab);
  if (t.dataset.editUser) openAdminUserForm(userById(t.dataset.editUser));
  if (t.dataset.deactivate) openDeactivateForm(userById(t.dataset.deactivate), refresh);
  if (t.dataset.activate) reactivateUser(userById(t.dataset.activate), refresh);
  if (t.dataset.saveCountry) saveCountry(t.dataset.saveCountry);
  if (t.dataset.deleteCountry) deleteCountry(t.dataset.deleteCountry);
});

(async function init() {
  if (!(await requireRole(["admin"]))) return;

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
    toast("País agregado.");
    await refresh();
  });

  await refresh();
})();
