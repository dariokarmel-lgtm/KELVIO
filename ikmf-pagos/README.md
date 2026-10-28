# IKMF Pagos

Sitio para controlar las cuotas mensuales de los instructores de IKMF, con tres niveles de
acceso y validación de pagos mediante comprobante.

> Proyecto independiente de KALVIO: comparte el repo pero tiene su propio Supabase y su
> propio sitio de Netlify.

## Qué hace

| Rol | Puede |
|---|---|
| **Instructor** | Ver su estado mes por mes (aprobado / en revisión / rechazado / adeuda), cargar el pago de un mes **subiendo el comprobante** (imagen o PDF, máx. 5 MB), corregir y re-enviar un pago rechazado. |
| **Director de país** | Ver solo a los instructores de **su país**: pagos del mes con totales (recaudado vs. esperado), bandeja de comprobantes por validar, aprobar o rechazar (el rechazo exige motivo), registrar pagos en efectivo, activar instructores nuevos, fijar cuota individual y mes de inicio, exportar CSV. También carga sus propios pagos. |
| **Admin** | Todo lo del director para cualquier país (selector arriba), y en *Administración*: alta/edición de países (moneda + cuota por defecto) y asignación de roles, país y activación de usuarios. Valida los pagos de los directores. |

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
netlify.toml
```

Sin build step: HTML/CSS/JS estático + `supabase-js` por CDN.

## Puesta en marcha

1. **Supabase** → New project (uno nuevo, no el de KALVIO/InstructorLog).
2. SQL Editor → pegar y correr completo `supabase/schema.sql`. Crea tablas, policies,
   el bucket `receipts` y algunos países de ejemplo (editables después).
3. Project Settings → API → copiar **Project URL** y **anon/publishable key** en
   `js/config.js`.
4. Authentication → URL Configuration → **Site URL** = la URL del sitio en Netlify
   (para que funcionen los mails de confirmación y de recuperar contraseña).
5. **Netlify** → Add new site → Import from Git → este repo, con
   **Base directory = `ikmf-pagos`** (Publish directory `.`). Sin variables de entorno.
6. Entrar al sitio, crear tu cuenta y convertirla en admin desde el SQL Editor:
   ```sql
   update public.profiles set role = 'admin', active = true
   where email = 'tu-mail@ejemplo.com';
   ```
7. En *Administración → Países* cargar moneda y cuota por defecto de cada país.
8. Cada director se registra normalmente; en *Administración → Usuarios* le asignás rol
   **Director de país**, su país y lo marcás activo.
9. Los instructores se registran solos y el director de su país los activa desde
   *Mi país → Instructores*.

## Pendiente / ideas

- Avisos por email (comprobante nuevo al director, aprobado/rechazado al instructor) —
  se puede sumar con una Netlify Function + Resend, como en KALVIO.
- Recordatorio automático a quien adeuda (función programada).
- Reportes anuales por país.
