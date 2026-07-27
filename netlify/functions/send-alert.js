/*
 * POST /.netlify/functions/send-alert
 * Body: { switchId }
 * Header: Authorization: Bearer <access_token del usuario>
 *
 * Dispara la alerta REAL de un switch (botón de pánico manual). Verifica
 * que el switch pertenezca a quien hace el pedido antes de mandar nada —
 * si no, cualquiera podría spamear a los destinatarios de otra persona.
 */

const { createClient } = require("@supabase/supabase-js");
const { adminClient, triggerSwitch } = require("./_lib/send");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let switchId;
  try {
    ({ switchId } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: "JSON inválido" };
  }
  if (!switchId) {
    return { statusCode: 400, body: "Falta switchId" };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return { statusCode: 401, body: "Falta token de autenticación" };
  }

  const authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: userData, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { statusCode: 401, body: "Token inválido" };
  }

  const supabase = adminClient();
  const { data: sw, error: swErr } = await supabase.from("switches").select("id, user_id").eq("id", switchId).single();
  if (swErr || !sw) {
    return { statusCode: 404, body: "Switch no encontrado" };
  }
  if (sw.user_id !== userData.user.id) {
    return { statusCode: 403, body: "Este switch no es tuyo" };
  }

  try {
    const result = await triggerSwitch(switchId, { historyType: "trigger_manual" });
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
