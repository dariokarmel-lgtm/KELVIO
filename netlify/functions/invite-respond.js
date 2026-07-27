/*
 * POST /.netlify/functions/invite-respond
 * Body: { token, action: "confirm" | "reject" }
 *
 * Pública (sin login) — el destinatario confirma o rechaza ser contacto
 * de confianza tocando el link que le llegó por email/SMS. El token es
 * un UUID random, no adivinable, así que sirve como autorización.
 */

const { adminClient } = require("./_lib/send");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let token, action;
  try {
    ({ token, action } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: "JSON inválido" };
  }
  if (!token || !["confirm", "reject"].includes(action)) {
    return { statusCode: 400, body: "Parámetros inválidos" };
  }

  const supabase = adminClient();
  const { data: recipient, error: rErr } = await supabase
    .from("recipients")
    .select("id, name, status")
    .eq("invite_token", token)
    .single();
  if (rErr || !recipient) {
    return { statusCode: 404, body: JSON.stringify({ error: "Invitación no encontrada" }) };
  }

  const newStatus = action === "confirm" ? "confirmed" : "rejected";
  const { error: updErr } = await supabase.from("recipients").update({ status: newStatus }).eq("id", recipient.id);
  if (updErr) {
    return { statusCode: 500, body: JSON.stringify({ error: updErr.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, name: recipient.name, status: newStatus }) };
};
