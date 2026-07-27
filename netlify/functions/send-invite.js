/*
 * POST /.netlify/functions/send-invite
 * Body: { recipientId }
 * Header: Authorization: Bearer <access_token del usuario>
 *
 * Manda la invitación real por email (y SMS si tiene teléfono) a un
 * destinatario recién agregado, con el link de confirmación pública.
 * Nunca manda la alerta real como primer contacto — esto es justo ese
 * paso intermedio.
 */

const { createClient } = require("@supabase/supabase-js");
const { adminClient, sendEmail, sendSms } = require("./_lib/send");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let recipientId;
  try {
    ({ recipientId } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: "JSON inválido" };
  }
  if (!recipientId) {
    return { statusCode: 400, body: "Falta recipientId" };
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
  const { data: recipient, error: rErr } = await supabase
    .from("recipients")
    .select("*")
    .eq("id", recipientId)
    .single();
  if (rErr || !recipient) {
    return { statusCode: 404, body: "Destinatario no encontrado" };
  }
  if (recipient.user_id !== userData.user.id) {
    return { statusCode: 403, body: "Este destinatario no es tuyo" };
  }

  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
  const link = `${siteUrl}/invite.html?token=${recipient.invite_token}`;
  const subject = "Te agregaron como contacto de confianza en KALVIO";
  const body =
    `${userData.user.email} te agregó como contacto de confianza en KALVIO, una app de check-in de seguridad.\n\n` +
    `Si no confirma que está bien, vas a recibir un aviso.\n\n` +
    `¿Confirmás? ${link}\n\n` +
    `Si no conocés a esta persona, podés ignorar este mensaje.`;

  const errors = [];
  if (recipient.email) {
    try { await sendEmail(recipient.email, subject, body); }
    catch (e) { errors.push(`email: ${e.message || e}`); }
  }
  if (recipient.phone) {
    try { await sendSms(recipient.phone, body); }
    catch (e) { errors.push(`sms: ${e.message || e}`); }
  }

  await supabase.from("history").insert({
    user_id: userData.user.id,
    switch_id: null,
    type: "invite",
    note: `Invitación enviada a ${recipient.name}`,
  });

  if (errors.length && !recipient.email && !recipient.phone) {
    return { statusCode: 400, body: JSON.stringify({ error: "El destinatario no tiene email ni teléfono" }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, errors }) };
};
