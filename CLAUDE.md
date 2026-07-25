# KALVIO — App de Check-in / Dead Man's Switch
> Este archivo es el contexto de producto para trabajar en este proyecto con Claude Code.
> Contiene las decisiones de concepto y UX ya tomadas. Todavía NO hay código ni stack
> técnico definitivo — eso se decide en la siguiente etapa.

## 1. Elevator pitch
Un motor de "check-in" con dos modos de uso:
- **Modo Legado** (intervalo largo — días/semanas): si el usuario no confirma que está
  bien, se envía un mensaje predeterminado a destinatarios elegidos.
- **Modo Sesión** (intervalo corto — minutos/horas, con ubicación): pensado para viajes,
  citas, situaciones puntuales de riesgo. Si no hay check-in, se envía SMS/llamada/email
  con la última ubicación.

Mismo motor, dos casos de uso, público más amplio que la competencia (que suele cubrir
solo uno de los dos).

## 2. Referencias de mercado (research previo)
- **GoodTrust**: plataforma de legado digital, dead man's switch como feature secundaria.
  ~$39-149/año.
- **Kitestring**: check-in por SMS, sin app. Gratis limitado (3 viajes) / $3 mes ilimitado.
  Es el competidor más directo del Modo Sesión.
- **Noonlight**: panic button + integración con emergencias/911, 3M+ usuarios en EEUU.
  Mucho más "pesado" en infraestructura que lo que buscamos para el MVP.
- Ángulo B2B posible a futuro: empresas que cubren la seguridad de empleados en turnos
  nocturnos, delivery, choferes.

## 3. Principios de diseño (no negociables)
1. El check-in tiene que ser **accesible sin login** (notificación / lock screen). Pedir
   contraseña para chequear es el error que rompe el producto.
2. **Modo Legado prioriza evitar falsos positivos** (confirmación con "verificador" antes
   de disparar). **Modo Sesión prioriza velocidad** (mejor una falsa alarma que llegar tarde).
3. Configuración de cosas críticas (apagar el switch, cambiar destinatarios) tiene que
   tener **más fricción** que el check-in mismo — para proteger contra el escenario de
   alguien controlando/manipulando al usuario.
4. Nunca un destinatario debe recibir la alerta real como primer contacto con la app —
   siempre hay un paso de invitación/confirmación previo.
5. Modo de prueba (simular disparo sin enviar nada real) es clave para generar confianza.

## 4. Modos — comparación
| | Modo Legado | Modo Sesión |
|---|---|---|
| Intervalo | Días / semanas | Minutos / horas |
| Ubicación | No | Sí |
| Canal de disparo | Email | SMS / llamada / email |
| Grace period | 24-48hs con recordatorios escalados | 60-90 segundos |
| Verificación previa al disparo | Sí (rol "verificador") | No — se prioriza velocidad |
| Cancelación | Un toque, hasta el último segundo | Botón de pánico visible, cancelación de último segundo |

## 5. Flujo de disparo

### Modo Legado
1. Vence el intervalo → grace period (24-48hs), recordatorios agresivos (push, SMS,
   email, llamada automática).
2. Verificación con "verificador" designado (no necesariamente el mismo destinatario del
   mensaje final) — evita falsos positivos tipo "se fue de viaje sin señal".
3. Envío del mensaje predeterminado a destinatarios.
4. Todo el proceso es cancelable con un toque hasta el envío.

### Modo Sesión
1. Vence el check-in → alerta inmediata (sonido fuerte, no silenciable fácil), countdown
   60-90 seg.
2. Sin respuesta → disparo automático: ubicación + mensaje por el canal configurado.
3. Sin paso de verificación previa (la urgencia pesa más que el riesgo de falsa alarma).
4. Botón de pánico manual disponible en la misma pantalla, sin esperar al timer.

## 6. Pantallas
- **Home / Dashboard** — switches activos, estado tipo semáforo. En Modo Sesión, contador
  grande visible.
- **Crear Switch** — selector de modo con explicación de 1 línea cada uno. Lugar natural
  del paywall (free = 1 switch / 1 destinatario / intervalo fijo).
- **Configurar Switch** — intervalo, destinatarios, contenido del mensaje, canal, ubicación
  sí/no.
- **Check-in** (la más crítica — ver wireframe abajo).
- **Gestión de Destinatarios** — ver sección 8.
- **Escalamiento** — avisos previos configurables, grace period.
- **Historial** — log de check-ins pasados (refuerza confianza).
- **Modo Prueba** — simular disparo sin enviar nada real.
- **Settings/Cuenta** — verificación, plan, pago, biometría, duress code.

### Wireframe conceptual — pantalla de Check-in
```
┌─────────────────────────┐
│  🟢 Estado: Activo       │  ← barra de estado, color semáforo
│  Próximo check-in: 4h 12m│
├─────────────────────────┤
│      ⬤ ⬤ ⬤ ⬤ ⬤          │  ← anillo de progreso
│    ┌───────────┐         │
│    │  ESTOY    │         │  ← botón gigante, ~60% de pantalla
│    │  BIEN     │         │
│    └───────────┘         │
├─────────────────────────┤
│ "Si no tocás este botón  │  ← contrato siempre visible
│  antes de las 18:40,     │
│  avisamos a Mamá y Juan" │
└─────────────────────────┘
```

**Copy Modo Legado**: botón "Confirmar que estoy bien" · confirmación sin fricción
("Listo. Nos vemos el martes.") · sin pedir contraseña.

**Copy Modo Sesión**: botón "Llegué bien" (más específico y fácil de decidir en el
momento) · countdown siempre visible (idealmente notificación persistente / widget) ·
al vencer: pantalla roja "🚨 Enviando en 10... 9... 8..." + botón CANCELAR enorme.

**Ícono de configuración**: esquina superior, bajo peso visual, fuera de la zona natural
del pulgar. Dos niveles: **ver** (libre) vs **editar crítico** (destinatarios, apagar
switch, cambiar intervalo) con reautenticación + posible delay de "enfriamiento" antes
de que el cambio se aplique.

**Detalles que hacen o rompen la confianza**:
- Confirmación visual + háptica al tocar (vibración + check verde).
- Botón de deshacer visible unos segundos después del toque, por si fue sin querer.
- Offline-first: el toque se guarda localmente y sincroniza cuando hay señal, para no
  disparar una alarma falsa por falta de conexión (clave en Modo Legado, gente de viaje).

## 7. Biometría y Duress Code
- La biometría **no** es para agregar fricción a "confirmar que estoy bien" — es para
  verificar que es físicamente el dueño del dispositivo quien hace el check-in.
- **Duress code**: gesto o PIN alternativo que en pantalla se ve como un check-in normal
  (check verde, todo ok) pero por dentro dispara la alerta en silencio. Cubre el
  escenario "me obligan a decir que estoy bien" — el peor caso que este tipo de apps
  debería resolver.
- Relevante sobre todo para Modo Sesión.
- Si el usuario configura un duress code, se le pide que lo repita una segunda vez en
  otro momento (no en el mismo flujo) para confirmar que lo recuerda — un duress code
  olvidado es peor que no tenerlo.

## 8. Flujo de onboarding
1. **Bienvenida** — 1 frase sin jerga + un solo CTA.
2. **Verificación** — teléfono + email (son los canales de disparo).
3. **Biometría** — un toggle, opcional, no bloquea el onboarding si se salta.
4. **Elegir modo del primer switch** (Legado / Sesión) — determina si aparece el paso 5.
5a. Si Modo Sesión → oferta de duress code, presentado como "tip de seguridad", nunca
    obligatorio.
5b. Si Modo Legado → se salta, se ofrece más adelante si crea un switch de Sesión.
6. **Crear el primer switch real** (no tutorial/demo) — el usuario sale del onboarding
   con algo ya funcionando.
7. **Oferta de Modo Prueba** — "¿simulamos una alerta para ver cómo funciona, sin enviar
   nada real?" — ataca la ansiedad de confianza en el momento justo.

## 9. Gestión de destinatarios
1. **Agregar** — nombre + teléfono/email.
2. **Invitación de confirmación** — mensaje corto y honesto (no una alerta), con link
   simple sin necesidad de instalar la app: *"[Usuario] te agregó como contacto de
   confianza. Si no confirma que está bien, vas a recibir un aviso. ¿Confirmás?"*
3. **Estados**: 🟡 Pendiente · 🟢 Confirmado · 🔴 Rechazó / no respondió.
4. Un switch puede armarse con destinatarios sin confirmar, pero con advertencia visible
   ("Juan todavía no confirmó").
5. **Contactos reutilizables** entre switches una vez confirmados — no hay que re-invitar.
6. **Rol de "verificador"** (Modo Legado): un destinatario marcado con flag extra, al que
   se le pregunta ANTES del disparo final si sabe algo del usuario. Conviene que sea
   alguien de contacto frecuente, separado en la UI como rol distinto.

## 10. Modelo de negocio (borrador)
- Freemium: free = 1 switch, 1 destinatario, intervalo fijo. Pago = ilimitado, ubicación
  en tiempo real, SMS/llamada, intervalos personalizados.
- Paywall natural en la pantalla de "Crear Switch".
- Posicionamiento amplio ("check-in de seguridad" en general) en vez de solo "para cuando
  me muera" — más TAM, menos morboso.

## 11. Decisiones técnicas ya tomadas (nivel infraestructura, no código)
- Sin servidor propio / VPS — buscar algo simple y de bajo costo (serverless / hosting
  gestionado).
- Email transaccional: **Resend** o **SendGrid**.
- SMS / llamadas (Modo Sesión): pendiente de research, probablemente **Twilio**.

## 12. Pendiente de definir (próximos pasos)
- [ ] Contenido y tono exacto del mensaje real que se envía en el disparo.
- [ ] Alcance del MVP — qué queda afuera de la v1 (candidatos a cortar: llamadas
      automáticas, duress code, modo verificador, historial).
- [ ] Stack técnico concreto y arquitectura (a definir cuando se pase a código).
- [x] Nombre de la app: **KALVIO** ("Safety switch & panic button"). Logo oficial en `img/`.
