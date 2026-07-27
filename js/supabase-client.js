/*
 * Cliente de Supabase compartido por toda la app.
 *
 * IMPORTANTE: completar con los datos de TU proyecto de Supabase
 * (Project Settings → API). La anon key es pública por diseño —
 * la seguridad real la da Row Level Security (ver supabase/schema.sql),
 * no el secreto de esta key. Nunca poner acá la service_role key.
 */

const SUPABASE_URL = "https://qjnoizdyjveaakhdqfob.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_p16e5aQ-AzS2nod9B0ZAFw_HLa1682S";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

let CURRENT_SESSION = null;

async function getSession() {
  if (CURRENT_SESSION) return CURRENT_SESSION;
  const { data } = await supabaseClient.auth.getSession();
  CURRENT_SESSION = data.session;
  return CURRENT_SESSION;
}

function getUserId() {
  return CURRENT_SESSION ? CURRENT_SESSION.user.id : null;
}

/*
 * Llamar al principio de cada página protegida. Si no hay sesión,
 * manda a login.html (guardando a dónde volver). El check-in no
 * vuelve a pedir credenciales mientras la sesión siga viva en el
 * dispositivo — eso es lo que cumple el principio de "sin login".
 */
async function requireSession() {
  const session = await getSession();
  if (!session) {
    const back = encodeURIComponent(location.pathname + location.search);
    location.href = `login.html?next=${back}`;
    return null;
  }
  return session;
}

async function signOut() {
  await supabaseClient.auth.signOut();
  CURRENT_SESSION = null;
  location.href = "login.html";
}

/*
 * Llama a una Netlify Function protegida, mandando el token de la sesión
 * actual. Tira si la respuesta no es 2xx.
 */
async function callFunction(name, body) {
  const session = await getSession();
  const res = await fetch(`/.netlify/functions/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || text || `HTTP ${res.status}`);
  return data;
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  CURRENT_SESSION = session;
});
