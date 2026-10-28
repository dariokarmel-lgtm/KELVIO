# IKMF Pagos

**URL:** https://instructorfee.ikmfpassport.com

Sitio para controlar las cuotas mensuales de los instructores de IKMF, con tres niveles de
acceso y validación de pagos mediante comprobante.

> Proyecto independiente de KALVIO: comparte el repo pero tiene su propio Supabase y su
> propio sitio de Netlify.

## Qué hace

| Rol | Puede |
|---|---|
| **Instructor** | Ver su estado mes por mes (aprobado / en revisión / rechazado / adeuda), cargar el pago de un mes **subiendo el comprobante** (imagen o PDF, máx. 5 MB), corregir y re-enviar un pago rechazado. |
| **Director de país** | Ver solo a los instructores de **su país**: pagos del mes con totales (recaudado vs. esperado), bandeja de comprobantes por validar, aprobar o rechazar (el rechazo exige motivo), registrar pagos en efectivo, exportar CSV. **Crear, editar, activar, dar de baja y reactivar instructores** de su país. También carga sus propios pagos. |
| **Admin** | Todo lo del director para cualquier país (selector arriba). En *Administración*: **crear, editar, dar de baja y reactivar directores e instructores** de cualquier país (incluye cambiar rol y país), y alta/edición de países (moneda + cuota por defecto). Valida los pagos de los directores. |

**Alta de usuarios:** desde el panel se carga nombre, email, teléfono, cuota y mes de inicio.
Si se deja vacía la contraseña inicial, Supabase le manda un **email de invitación** para que
elija la suya; si se completa, la cuenta queda lista para entrar con esa contraseña.
Los instructores también pueden registrarse solos y quedan *pendientes* hasta que el director
los activa.

**Baja:** se elige el último mes que se le cobra. La cuenta queda bloqueada (no puede
ingresar), deja de generar deuda después de ese mes y **se conserva todo su historial de
pagos**. Se puede reactivar: vuelve a cobrarse desde el mes en curso. No hay borrado
definitivo desde la web.

Flujo: el instructor se registra eligiendo su país → el director lo activa → el instructor
sube el comprobante → queda **En revisión** → el director lo **aprueba** o lo **rechaza con
motivo** → si se rechazó, el instructor lo corrige y vuelve a revisión.

## Seguridad

Todas las reglas viven en la base (`supabase/schema.sql`), no en el JS:

- RLS: cada usuario ve solo sus pagos; un director solo ve perfiles, pagos y comprobantes
  de instructores de su país; un admin ve todo.
- Un instructor no puede aprobarse un pago, cambiarse el rol, el país, la cuota ni
  activarse: el trigger lo fuerza a "En revisión" y descarta esos campos.
- Un director no valida sus propios pagos ni los de otro director (lo hace un admin).
- Un pago aprobado no se puede editar ni borrar por el instructor.
- Alta, cambio de email y baja de cuentas pasan por la Netlify Function `manage-user`, que
  usa la `service_role` (nunca llega al navegador) y valida el rol de quien llama: un
  director solo puede tocar instructores de su país; nadie gestiona admins desde la web.
- Comprobantes en un bucket **privado** de Storage; se ven con links firmados de 10 minutos.
  Los archivos no se pueden pisar ni borrar (queda registro); solo un admin puede borrarlos.

## Estructura

```
index.html        Ingresar / crear cuenta / recuperar contraseña
instructor.html   Mis pagos (todos los roles)
director.html     Panel de país (director y admin)
admin.html        Países y usuarios (admin)
css/style.css
js/config.js      URL y anon key de Supabase  ← completar
js/common.js      Cliente, sesión, navegación, helpers, comprobantes
js/*.js           Lógica de cada pantalla
supabase/schema.sql   Tablas + RLS + triggers + bucket de Storage
netlify/functions/manage-user.js   Alta / edición / baja de usuarios (service_role)
package.json      Dependencias de la function (Netlify las instala solo)
netlify.toml
```

Sin build step: HTML/CSS/JS estático + `supabase-js` por CDN.

## Puesta en marcha

1. **Supabase** → New project (uno nuevo, no el de KALVIO/InstructorLog).
2. SQL Editor → pegar y correr completo `supabase/schema.sql`. Crea tablas, policies,
   el bucket `receipts` y algunos países de ejemplo (editables después).
3. Project Settings → API → copiar **Project URL** y **anon/publishable key** en
   `js/config.js`.
4. Supabase → Authentication → URL Configuration:
   - **Site URL** = `https://instructorfee.ikmfpassport.com`
   - **Redirect URLs** = `https://instructorfee.ikmfpassport.com/**`

   (Hace falta para los mails de confirmación, invitación y recuperar contraseña.)
5. **Netlify** → Add new site → Import from Git → este repo, con
   **Base directory = `ikmf-pagos`** (Publish directory `.`). En Site configuration →
   Environment variables cargar:
   - `SUPABASE_URL` → la Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` → Project Settings → API → service_role (**secreta**)
   - `SITE_URL` → `https://instructorfee.ikmfpassport.com`
5b. **Dominio** — Netlify → Domain management → Add a domain →
   `instructorfee.ikmfpassport.com`. Después, en el DNS de `ikmfpassport.com` (donde esté
   registrado el dominio) crear el registro:

   | Tipo | Nombre | Valor |
   |---|---|---|
   | CNAME | `instructorfee` | `<nombre-del-sitio>.netlify.app` |

   Cuando el DNS propague, Netlify emite el certificado HTTPS solo (Let's Encrypt) y
   redirige la URL `*.netlify.app` al dominio propio.
6. Entrar al sitio, crear tu cuenta y convertirla en admin desde el SQL Editor:
   ```sql
   update public.profiles set role = 'admin', active = true
   where email = 'tu-mail@ejemplo.com';
   ```
7. En *Administración → Países* cargar moneda y cuota por defecto de cada país.
8. En *Administración → Usuarios → + Nuevo usuario* crear cada director (rol **Director de
   país** + su país).
9. Cada director crea a sus instructores desde *Mi país → Instructores → + Nuevo
   instructor* (o los instructores se registran solos y el director los activa).

> El servicio de email que trae Supabase tiene un límite bajo de envíos por hora. Para dar de
> alta muchos usuarios por invitación conviene configurar un SMTP propio (Authentication →
> Emails → SMTP, por ejemplo con Resend) o cargar una contraseña inicial.

## Pendiente / ideas

- Avisos por email (comprobante nuevo al director, aprobado/rechazado al instructor) —
  se puede sumar con una Netlify Function + Resend, como en KALVIO.
- Recordatorio automático a quien adeuda (función programada).
- Reportes anuales por país.
