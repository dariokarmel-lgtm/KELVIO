/*
 * GET /.netlify/functions/invite-info?token=...
 * Pública — solo lectura, para mostrarle al destinatario quién lo invitó
 * antes de que confirme o rechace.
 */

const { adminClient } = require("./_lib/send");

exports.handler = async (event) => {
  const token = event.queryStringParameters && event.queryStringParameters.token;
  if (!token) {
    return { statusCode: 400, body: JSON.stringify({ error: "Falta token" }) };
  }

  const supabase = adminClient();
  const { data: recipient, error } = await supabase
    .from("recipients")
    .select("name, status, user_id")
    .eq("invite_token", token)
    .single();

  if (error || !recipient) {
    return { statusCode: 404, body: JSON.stringify({ error: "Invitación no encontrada" }) };
  }

  let inviterEmail = "";
  try {
    const { data: userRes } = await supabase.auth.admin.getUserById(recipient.user_id);
    inviterEmail = userRes?.user?.email || "";
  } catch {
    // Si falla, mostramos el prompt sin el email del que invita.
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ recipientName: recipient.name, inviterEmail, status: recipient.status }),
  };
};
