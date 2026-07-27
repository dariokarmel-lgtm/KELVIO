# KALVIO

App de check-in / dead man's switch. Ver [CLAUDE.md](CLAUDE.md) para el contexto de
producto completo.

## Estado actual

Ya no es un prototipo de solo-frontend: tiene cuentas de usuario reales (Supabase Auth),
los datos viven en una base Postgres real (Supabase), y el botón de pánico / el
vencimiento automático de un switch mandan **email, SMS y WhatsApp de verdad** vía
Netlify Functions (Resend + Twilio). Una función programada revisa cada 5 minutos si
algún switch venció y dispara la alerta sola, sin que la app esté abierta.

"Llamada automática" queda como opción configurable pero **todavía no está implementada**
de verdad (necesita Twilio Voice + TwiML — es un paso más).

## Estructura

```
index.html, checkin.html, create-switch.html, configure-switch.html,
escalation.html, recipients.html, history.html, test-mode.html, settings.html
                          ← Las 9 pantallas de la app
login.html                ← Ingresar / crear cuenta (Supabase Auth)
invite.html                ← Página pública para que un destinatario confirme/rechace

css/style.css              ← Estilos compartidos
js/i18n.js                 ← Diccionario + motor de traducciones (10 idiomas)
js/supabase-client.js      ← Cliente Supabase + sesión + callFunction()
js/data.js                 ← Capa de datos (Supabase, con caché en memoria)
js/app.js                  ← Helpers compartidos
js/*.js                    ← Lógica de cada pantalla
img/                       ← Logo oficial (ícono, favicon, apple-touch-icon)

supabase/schema.sql        ← Migración completa (tablas + RLS + trigger)

netlify/functions/
  _lib/send.js              ← Resend + Twilio + lógica de disparo compartida
  send-alert.js              ← Botón de pánico manual (protegido, verifica dueño)
  send-invite.js              ← Manda la invitación real a un destinatario
  invite-info.js               ← Pública: quién invitó (para invite.html)
  invite-respond.js             ← Pública: el destinatario confirma/rechaza
  check-overdue.js               ← Scheduled function (cron cada 5 min)

package.json                ← Dependencias de las functions (@supabase/supabase-js,
                               resend, twilio) — tiene que estar en la RAÍZ del repo,
                               no dentro de netlify/functions/, si no Netlify no las instala
netlify.toml               ← functions dir + cron del check-overdue
```

Sin build step para el frontend — lo que está en la raíz se sube directo al hosting,
igual que InstructorLog. Las functions comparten el `package.json` de la raíz (Netlify lo
instala solo al deployar).

## Setup — de cero a funcionando

### 1. Crear el proyecto de Supabase

Un proyecto **separado** del de InstructorLog (no se comparte — ver nota abajo).

1. [supabase.com](https://supabase.com) → New Project.
2. SQL Editor → pegar y correr entero `supabase/schema.sql`.
3. Project Settings → API → copiar **Project URL** y **anon/public key**.
4. Pegarlas en `js/supabase-client.js` (`SUPABASE_URL` / `SUPABASE_ANON_KEY`) — son
   públicas por diseño, la seguridad la da RLS, no el secreto de esa key.
5. Copiar también la **service_role key** (Project Settings → API) — esa NO va en el
   código, va como variable de entorno en Netlify (paso 3 más abajo).

> Por qué un proyecto separado: el Supabase de InstructorLog ya tiene su propia tabla
> `profiles` y su propio trigger `on_auth_user_created`/`handle_new_user` para crear la
> academia al registrarse. Compartir el proyecto pisaría esas definiciones y rompería el
> registro de InstructorLog.

### 2. Cuentas de envío

- **Resend** (email): [resend.com](https://resend.com), gratis hasta 3000/mes. Para
  producción real conviene verificar un dominio propio; mientras tanto funciona con el
  remitente de pruebas de Resend (solo entrega a la cuenta con la que te registraste).
- **Twilio** (SMS + WhatsApp): [twilio.com](https://twilio.com).
  - SMS: comprar un número de Twilio (tiene costo).
  - WhatsApp: activar el **sandbox** de WhatsApp (Messaging → Try it out → WhatsApp) para
    probar ya mismo — mientras estás en sandbox, solo le llega a números que vos mismo
    uniste al sandbox (le mandan un código por WhatsApp al número de Twilio). Para mandarle
    a cualquier número hace falta verificar el negocio con Meta (Twilio → WhatsApp Senders),
    que puede tardar días.

### 3. Variables de entorno en Netlify

Netlify → tu sitio → Project configuration → Environment variables:

| Variable | De dónde sale |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (secreta, nunca en el código) |
| `RESEND_API_KEY` | Resend → API Keys |
| `RESEND_FROM_EMAIL` | ej. `KALVIO <alertas@tudominio.com>` (o dejar sin setear = remitente de pruebas de Resend) |
| `TWILIO_ACCOUNT_SID` | Twilio Console |
| `TWILIO_AUTH_TOKEN` | Twilio Console |
| `TWILIO_PHONE_NUMBER` | El número de Twilio comprado, formato `+1415...` |
| `TWILIO_WHATSAPP_NUMBER` | El número del sandbox (o el tuyo aprobado), formato `+1415...` sin el prefijo `whatsapp:` |

Después de cargarlas, redeployar el sitio para que las functions las tomen.

### 4. Deploy

Ya está conectado por Git en **https://kelvioapp.netlify.app**
(repo `dariokarmel-lgtm/KELVIO`) — cada `git push` a `main` redeploya solo, functions
incluidas. Build settings: **Base directory** vacío · **Build command** vacío ·
**Publish directory** `.` · **Functions directory** `netlify/functions`.

## Cómo funciona el disparo real

- **Manual** (botón de pánico): el navegador llama a `send-alert` con el token de sesión
  del usuario — la function verifica que el switch sea suyo antes de mandar nada.
- **Automático**: `check-overdue` corre sola cada 5 minutos (Netlify Scheduled Function,
  `netlify.toml`), revisa todos los switches de todos los usuarios y dispara los que
  vencieron su período de gracia/alarma y todavía no fueron avisados.
- Ambos caminos son **idempotentes**: una vez que un switch tiene `triggered_at` seteado,
  no se vuelve a mandar nada hasta el próximo check-in real.
- El **Modo Prueba** (`test-mode.html`) sigue siendo 100% simulado a propósito — nunca
  llama a estas functions, solo agrega un registro al historial.

## Multi-idioma

10 idiomas: ES/EN/PT/FR/DE/HE/AR/HI/ZH/JA (hebreo y árabe con RTL). Selector en Ajustes,
persiste en Supabase (`profiles.lang`, todavía no leído al boot — hoy el idioma activo
vive en `localStorage` del dispositivo). Todo el texto de la UI vive como claves en
`js/i18n.js` (`t("clave", {vars})`); el markup estático usa `data-i18n` /
`data-i18n-attr`. Español e inglés están escritos y revisados a mano; el resto se generó
con IA — conviene una revisión de hablantes nativos antes de un lanzamiento real.

## Para Claude Code

Al abrir este proyecto, el contexto completo está en [CLAUDE.md](CLAUDE.md).
