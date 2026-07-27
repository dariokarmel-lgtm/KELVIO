/*
 * Lógica compartida por las Netlify Functions: cliente admin de Supabase
 * (service_role — se salta RLS a propósito, son procesos de sistema) y
 * el envío real por Resend (email) y Twilio (SMS / WhatsApp).
 *
 * "Llamada automática" queda configurable en el switch pero todavía NO
 * se implementa acá (requiere Twilio Voice + TwiML, es un paso más).
 */

const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const twilio = require("twilio");

function adminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function resendClient() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

function twilioClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return null;
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

// Normaliza a E.164 aproximado (Twilio lo exige sin espacios/guiones).
function normalizePhone(phone) {
  if (!phone) return null;
  const trimmed = phone.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/[^\d]/g, "");
  return digits ? plus + digits : null;
}

async function sendEmail(to, subject, text) {
  const resend = resendClient();
  if (!resend) throw new Error("RESEND_API_KEY no configurada");
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || "KALVIO <onboarding@resend.dev>",
    to,
    subject,
    text,
  });
  if (error) throw new Error(error.message || String(error));
}

async function sendSms(to, body) {
  const client = twilioClient();
  if (!client) throw new Error("Twilio no configurado (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)");
  if (!process.env.TWILIO_PHONE_NUMBER) throw new Error("TWILIO_PHONE_NUMBER no configurado");
  const phone = normalizePhone(to);
  if (!phone) throw new Error("Destinatario sin teléfono válido");
  await client.messages.create({ from: process.env.TWILIO_PHONE_NUMBER, to: phone, body });
}

async function sendWhatsapp(to, body) {
  const client = twilioClient();
  if (!client) throw new Error("Twilio no configurado (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)");
  if (!process.env.TWILIO_WHATSAPP_NUMBER) throw new Error("TWILIO_WHATSAPP_NUMBER no configurado");
  const phone = normalizePhone(to);
  if (!phone) throw new Error("Destinatario sin teléfono válido");
  await client.messages.create({
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
    to: `whatsapp:${phone}`,
    body,
  });
}

/*
 * Dispara la alerta real de un switch: manda por los canales configurados
 * a todos sus destinatarios, marca triggered_at (para que no se repita) y
 * agrega un registro al historial. Es idempotente: si ya estaba disparado,
 * no hace nada.
 */
async function triggerSwitch(switchId, { historyType = "trigger_manual" } = {}) {
  const supabase = adminClient();

  const { data: sw, error: swErr } = await supabase
    .from("switches")
    .select("*, switch_recipients(recipient_id)")
    .eq("id", switchId)
    .single();
  if (swErr || !sw) throw new Error("Switch no encontrado");
  if (sw.off) return { skipped: "off" };
  if (sw.triggered_at) return { skipped: "already_triggered" };

  const recipientIds = (sw.switch_recipients || []).map((x) => x.recipient_id);
  const { data: recipients } = recipientIds.length
    ? await supabase.from("recipients").select("*").in("id", recipientIds)
    : { data: [] };

  const subject = `⚠️ Alerta de KALVIO — ${sw.name}`;
  const body = sw.message + "\n\n— Enviado automáticamente por KALVIO porque no hubo confirmación a tiempo.";

  const results = [];
  for (const r of recipients || []) {
    if (sw.channels?.email && r.email) {
      try {
        await sendEmail(r.email, subject, body);
        results.push({ recipient: r.id, channel: "email", ok: true });
      } catch (e) {
        results.push({ recipient: r.id, channel: "email", ok: false, error: String(e.message || e) });
      }
    }
    if (sw.channels?.sms && r.phone) {
      try {
        await sendSms(r.phone, body);
        results.push({ recipient: r.id, channel: "sms", ok: true });
      } catch (e) {
        results.push({ recipient: r.id, channel: "sms", ok: false, error: String(e.message || e) });
      }
    }
    if (sw.channels?.whatsapp && r.phone) {
      try {
        await sendWhatsapp(r.phone, body);
        results.push({ recipient: r.id, channel: "whatsapp", ok: true });
      } catch (e) {
        results.push({ recipient: r.id, channel: "whatsapp", ok: false, error: String(e.message || e) });
      }
    }
  }

  await supabase.from("switches").update({ triggered_at: new Date().toISOString() }).eq("id", sw.id);

  const names = (recipients || []).map((r) => r.name).join(", ") || "tus contactos";
  await supabase.from("history").insert({
    user_id: sw.user_id,
    switch_id: sw.id,
    type: historyType,
    note: `Alerta enviada a ${names}`,
  });

  return { ok: true, results };
}

module.exports = { adminClient, sendEmail, sendSms, sendWhatsapp, normalizePhone, triggerSwitch };
