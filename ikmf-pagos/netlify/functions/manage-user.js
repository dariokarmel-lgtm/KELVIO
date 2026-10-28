/*
 * POST /.netlify/functions/manage-user
 * Header: Authorization: Bearer <access_token del usuario>
 * Body: { action, userId?, data? }
 *
 *   create      → alta de usuario. Con data.password se crea con esa
 *                 contraseña; sin password se le manda invitación por email.
 *   update      → edita nombre, email, teléfono, cuota, mes de inicio
 *                 (y rol / país si quien llama es admin).
 *   deactivate  → baja: deja de cobrarse después de data.end_month y no
 *                 puede volver a ingresar. El historial de pagos se conserva.
 *   reactivate  → deshace la baja.
 *
 * Permisos (la service_role saltea RLS, así que se chequean acá):
 *   admin              → instructores y directores de cualquier país.
 *   director activo    → solo instructores de su propio país.
 *   Nadie gestiona cuentas admin por acá (se hace por SQL).
 *
 * Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * SITE_URL (https://instructorfee.ikmfpassport.com; si falta, usa la URL
 * principal que da Netlify).
 */

const { createClient } = require("@supabase/supabase-js");

const BAN_FOREVER = "876000h"; // ~100 años

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function adminClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(500, "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en las variables de entorno de Netlify.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/* ---------- Validación de campos ---------- */

function cleanText(v, max = 200) {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim();
  return s.slice(0, max);
}

function cleanEmail(v) {
  const s = cleanText(v, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, "Email inválido.");
  return s;
}

function cleanPeriod(v, label) {
  if (!/^\d{4}-\d{2}-01$/.test(String(v || ""))) throw new HttpError(400, `${label}: mes inválido.`);
  return v;
}

function cleanFee(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!(n >= 0)) throw new HttpError(400, "La cuota no puede ser negativa.");
  return Math.round(n * 100) / 100;
}

/* ---------- Permisos ---------- */

async function loadCaller(sb, token) {
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Sesión inválida. Volvé a ingresar.");
  const { data: me } = await sb.from("profiles").select("*").eq("id", data.user.id).single();
  if (!me) throw new HttpError(403, "Perfil no encontrado.");
  const isAdmin = me.role === "admin";
  const isDirector = me.role === "director" && me.active && me.country_id;
  if (!isAdmin && !isDirector) throw new HttpError(403, "No tenés permisos para gestionar usuarios.");
  return { me, isAdmin };
}

function assertCanManage(caller, target) {
  if (!target) throw new HttpError(404, "Usuario no encontrado.");
  if (target.id === caller.me.id) throw new HttpError(403, "No podés modificar tu propia cuenta desde acá.");
  if (target.role === "admin") throw new HttpError(403, "Las cuentas de administrador se gestionan desde la base de datos.");
  if (caller.isAdmin) return;
  if (target.role !== "instructor" || target.country_id !== caller.me.country_id) {
    throw new HttpError(403, "Solo podés gestionar instructores de tu país.");
  }
}

function allowedRole(caller, role) {
  const r = role || "instructor";
  if (r === "instructor") return r;
  if (r === "director" && caller.isAdmin) return r;
  throw new HttpError(403, "Solo un administrador puede crear o asignar directores.");
}

async function resolveCountry(sb, caller, countryId) {
  if (!caller.isAdmin) return caller.me.country_id;
  if (!countryId) throw new HttpError(400, "Elegí el país.");
  const { data } = await sb.from("countries").select("id").eq("id", countryId).single();
  if (!data) throw new HttpError(400, "País inexistente.");
  return data.id;
}

async function getProfile(sb, id) {
  const { data } = await sb.from("profiles").select("*").eq("id", id).single();
  return data;
}

/* ---------- Acciones ---------- */

async function createUser(sb, caller, data, siteUrl) {
  const email = cleanEmail(data.email);
  const full_name = cleanText(data.full_name);
  if (!full_name) throw new HttpError(400, "Completá el nombre.");
  const role = allowedRole(caller, data.role);
  const country_id = await resolveCountry(sb, caller, data.country_id);
  const phone = cleanText(data.phone, 40) || null;
  const meta = { full_name, phone, country_id };

  let userId;
  let invited = false;
  if (data.password) {
    if (String(data.password).length < 8) throw new HttpError(400, "La contraseña inicial tiene que tener al menos 8 caracteres.");
    const { data: created, error } = await sb.auth.admin.createUser({
      email,
      password: String(data.password),
      email_confirm: true,
      user_metadata: meta,
    });
    if (error) throw mapAuthError(error);
    userId = created.user.id;
  } else {
    const { data: created, error } = await sb.auth.admin.inviteUserByEmail(email, {
      data: meta,
      redirectTo: siteUrl ? `${siteUrl.replace(/\/$/, "")}/index.html` : undefined,
    });
    if (error) throw mapAuthError(error);
    userId = created.user.id;
    invited = true;
  }

  // El trigger ikmf_handle_new_user ya creó el perfil; completamos el resto.
  const { data: profile, error } = await sb.from("profiles").update({
    full_name,
    phone,
    country_id,
    role,
    active: true,
    end_month: null,
    monthly_fee: cleanFee(data.monthly_fee) ?? null,
    start_month: data.start_month ? cleanPeriod(data.start_month, "Cobrar desde") : currentPeriod(),
  }).eq("id", userId).select().single();
  if (error) throw new HttpError(500, error.message);
  return { user: profile, invited };
}

async function updateUser(sb, caller, target, data) {
  const row = {};
  if (data.full_name !== undefined) {
    row.full_name = cleanText(data.full_name);
    if (!row.full_name) throw new HttpError(400, "El nombre no puede quedar vacío.");
  }
  if (data.phone !== undefined) row.phone = cleanText(data.phone, 40) || null;
  if (data.monthly_fee !== undefined) row.monthly_fee = cleanFee(data.monthly_fee);
  if (data.start_month !== undefined) row.start_month = cleanPeriod(data.start_month, "Cobrar desde");
  if (data.role !== undefined && data.role !== target.role) row.role = allowedRole(caller, data.role);
  if (data.country_id !== undefined && data.country_id !== target.country_id) {
    if (!caller.isAdmin) throw new HttpError(403, "Solo un administrador puede cambiar el país.");
    row.country_id = await resolveCountry(sb, caller, data.country_id);
  }

  if (data.email !== undefined) {
    const email = cleanEmail(data.email);
    if (email !== target.email) {
      const { error } = await sb.auth.admin.updateUserById(target.id, { email, email_confirm: true });
      if (error) throw mapAuthError(error);
      row.email = email;
    }
  }

  if (!Object.keys(row).length) return { user: target };
  const { data: profile, error } = await sb.from("profiles").update(row).eq("id", target.id).select().single();
  if (error) throw new HttpError(500, error.message);
  return { user: profile };
}

async function deactivateUser(sb, target, data) {
  const end_month = data.end_month ? cleanPeriod(data.end_month, "Último mes") : currentPeriod();
  if (end_month < target.start_month) throw new HttpError(400, "El último mes no puede ser anterior al mes de inicio.");
  const { error: banErr } = await sb.auth.admin.updateUserById(target.id, { ban_duration: BAN_FOREVER });
  if (banErr) throw mapAuthError(banErr);
  const { data: profile, error } = await sb.from("profiles")
    .update({ active: false, end_month }).eq("id", target.id).select().single();
  if (error) throw new HttpError(500, error.message);
  return { user: profile };
}

// Sirve tanto para reactivar una baja como para activar a alguien que se
// registró solo. Al volver de una baja se cobra desde el mes actual, para
// que los meses en que estuvo de baja no figuren como deuda.
async function reactivateUser(sb, target) {
  const { error: banErr } = await sb.auth.admin.updateUserById(target.id, { ban_duration: "none" });
  if (banErr) throw mapAuthError(banErr);
  const row = { active: true, end_month: null };
  if (target.end_month) row.start_month = currentPeriod();
  const { data: profile, error } = await sb.from("profiles")
    .update(row).eq("id", target.id).select().single();
  if (error) throw new HttpError(500, error.message);
  return { user: profile };
}

function mapAuthError(error) {
  const msg = String(error.message || error);
  if (/already (been )?registered|already exists/i.test(msg)) {
    return new HttpError(409, "Ya existe una cuenta con ese email.");
  }
  if (/rate limit/i.test(msg)) {
    return new HttpError(429, "Se alcanzó el límite de emails de Supabase. Probá más tarde o cargá una contraseña inicial.");
  }
  return new HttpError(400, msg);
}

/* ---------- Handler ---------- */

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "JSON inválido" });
  }
  const { action, userId } = body;
  const data = body.data || {};

  const token = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Falta token de autenticación." });

  try {
    const sb = adminClient();
    const caller = await loadCaller(sb, token);

    if (action === "create") {
      const siteUrl = process.env.SITE_URL || process.env.URL || event.headers.origin;
      return json(200, await createUser(sb, caller, data, siteUrl));
    }

    const target = await getProfile(sb, userId);
    assertCanManage(caller, target);

    switch (action) {
      case "update":
        return json(200, await updateUser(sb, caller, target, data));
      case "deactivate":
        return json(200, await deactivateUser(sb, target, data));
      case "reactivate":
        return json(200, await reactivateUser(sb, target));
      default:
        return json(400, { error: "Acción desconocida." });
    }
  } catch (e) {
    return json(e.status || 500, { error: e.message || String(e) });
  }
};
