# KALVIO

Prototipo estático de la app de check-in / dead man's switch. Ver [CLAUDE.md](CLAUDE.md)
para el contexto de producto completo.

## Estado actual

Prototipo navegable en HTML/CSS/JS vanilla, sin build ni backend. Los datos (switches,
destinatarios, historial) viven en `localStorage` del navegador — sirve para probar los
flujos y la UX, pero no manda nada real y no persiste entre dispositivos.

## Estructura

```
index.html              ← Dashboard
checkin.html             ← Pantalla de check-in (la más crítica)
create-switch.html       ← Alta de switch (selector de modo)
configure-switch.html    ← Configuración de un switch
escalation.html          ← Período de gracia / duración de alarma
recipients.html          ← Gestión de destinatarios
history.html             ← Historial de actividad
test-mode.html           ← Modo Prueba (simula un disparo sin enviar nada real)
settings.html            ← Cuenta, biometría, duress code
css/style.css            ← Estilos compartidos
js/i18n.js               ← Diccionario + motor de traducciones (10 idiomas)
js/data.js               ← Capa de datos (localStorage)
js/app.js                ← Helpers compartidos
js/*.js                  ← Lógica de cada pantalla
img/                     ← Logo oficial (ícono, favicon, apple-touch-icon)
```

Sin build step — lo que está acá se sube directo al hosting, igual que InstructorLog.

## Multi-idioma

10 idiomas: ES/EN/PT/FR/DE/HE/AR/HI/ZH/JA (hebreo y árabe con RTL). Selector en
Ajustes, persiste en `localStorage`. Todo el texto de la UI vive como claves en
`js/i18n.js` (`t("clave", {vars})`); el markup estático usa `data-i18n` /
`data-i18n-attr`. Español e inglés están escritos y revisados a mano; el resto se generó
con IA — conviene una revisión de hablantes nativos antes de un lanzamiento real.

## Deployment (demo estática)

Ya está online: **https://kelvioapp.netlify.app** (repo GitHub: `dariokarmel-lgtm/KELVIO`).

Conectado por Git, igual que InstructorLog — cada `git push` a `main` redeploya solo.
Build settings: **Base directory** vacío · **Build command** vacío · **Publish directory** `.`

Esto deja la demo online, pero sigue siendo solo un prototipo visual — no manda alertas
reales. Para que funcione de verdad hace falta un backend (Supabase) y una función
programada (Netlify Scheduled Functions) que revise los switches vencidos y dispare el
aviso, como ya usa InstructorLog para sus recordatorios de vencimiento.

## Para Claude Code

Al abrir este proyecto, el contexto completo está en [CLAUDE.md](CLAUDE.md).
