# Guía de instalación · Reservas AP Latam

Tiempo estimado: 20 minutos. No necesitas saber programar; solo copiar, pegar y dar clics.

La app tiene dos partes:

- **El "cerebro" (Google):** una hoja de Google guarda usuarios y reservas, y un script manda los códigos de acceso y las alertas por correo.
- **La cara (GitHub):** la página que ve el equipo, publicada gratis con GitHub Pages.

Archivos que vas a usar:

| Archivo | Va en |
|---|---|
| `backend/Code.gs` | Apps Script (Google) |
| `frontend/index.html` | GitHub |
| `README.md` | GitHub (opcional) |

---

## Parte 1 · El cerebro en Google

> Usa la cuenta de Google desde la que quieres que salgan los correos. Si existe una cuenta compartida del equipo, mejor esa; si no, la tuya funciona.

1. Abre **sheets.new** para crear una hoja nueva. Ponle de nombre `Reservas AP – Base de datos`.
2. En el menú, entra a **Extensiones › Apps Script**. Se abre una pestaña nueva.
3. Borra todo lo que aparece en el archivo `Código.gs` y pega el contenido completo de `backend/Code.gs`.
4. Arriba del código está la sección **CONFIGURACIÓN**. Cambia al menos esto:
   - `TOOL_NAME`: el nombre de la herramienta, por ejemplo `'Midjourney'`.
   - `ALLOWED_DOMAINS`: te recomiendo `['aplatam.com']` para que solo entren correos del equipo. Si hay colaboradores con otros correos, agrega sus dominios o déjalo vacío `[]`.
   - Deja `APP_URL` vacío por ahora; lo llenas en el paso 14.
5. Da clic en el ícono de disco (**Guardar**).
6. En la barra izquierda, entra a **Configuración del proyecto** (el engrane) y en **Zona horaria** elige **(GMT-06:00) Ciudad de México**.
7. Regresa al **Editor** (ícono `< >`). En la lista desplegable de funciones, arriba, elige **setup** y da clic en **Ejecutar**.
8. Google te pedirá permisos. Es normal que diga *"Google no verificó esta app"*, porque el script es tuyo: da clic en **Configuración avanzada › Ir a … (no seguro)** y luego **Permitir**.
   - Al terminar verás en el registro: *"Listo. Hojas creadas y alerta programada cada minuto."* Si vuelves a la hoja, ahora tiene las pestañas Usuarios, Reservas, Codigos y Sesiones.
9. (Opcional) Elige la función **probarCorreo** y ejecútala. Te llegará un correo de prueba.
10. Arriba a la derecha: **Implementar › Nueva implementación**. En el engrane de "Seleccionar tipo", elige **Aplicación web** y configura:
    - **Ejecutar como:** Yo
    - **Quién tiene acceso:** Cualquier usuario
    
    Da clic en **Implementar** y **copia la URL** que termina en `/exec`. La necesitas en el paso 12.

---

## Parte 2 · La página en GitHub

11. En GitHub, da clic en **+ › New repository**.
    - **Repository name:** `reservas`
    - Márcalo como **Public** (GitHub Pages es gratis en repositorios públicos). No te preocupes: el código no tiene datos ni contraseñas; las reservas viven en tu hoja de Google y para entrar se necesita un código enviado al correo.
    - Da clic en **Create repository**.
12. Abre `frontend/index.html` en cualquier editor de texto (Bloc de notas o TextEdit sirven). Busca esta línea, casi al inicio del bloque de código:

    ```js
    const API_URL = '';
    ```

    Pega entre las comillas la URL del paso 10 y guarda:

    ```js
    const API_URL = 'https://script.google.com/macros/s/AKfy…/exec';
    ```

    Luego, en tu repositorio, da clic en **uploading an existing file** (o **Add file › Upload files**), arrastra `index.html` (y `README.md` si quieres) y da clic en **Commit changes**.
13. En el repositorio, entra a **Settings › Pages**. En **Branch** elige `main` y carpeta `/ (root)`, y da clic en **Save**. En uno o dos minutos aparecerá tu enlace, algo como:

    `https://TU-USUARIO.github.io/reservas/`

    Ábrelo para confirmar que carga la pantalla de acceso.

14. Regresa a Apps Script y pega ese enlace en `APP_URL` (así el botón "Reservar otro turno" de los correos lleva a la app). Guarda y publica el cambio:
    **Implementar › Administrar implementaciones › ✏️ (editar) › Versión: Nueva versión › Implementar.**

    > Importante: cada vez que cambies algo en `Code.gs`, repite este paso. Si no publicas una nueva versión, la app sigue usando la anterior. La URL `/exec` no cambia.

---

## Parte 3 · Compartir con el equipo

Manda el enlace de GitHub Pages. La primera vez cada persona escribe su correo y su nombre, recibe un código de 6 dígitos y listo; su sesión queda abierta 30 días en ese navegador.

Sugiéreles dar clic en **Activar avisos** (arriba a la derecha) para recibir también la notificación del navegador, además del correo, 15 y 5 minutos antes de que termine su turno.

**No pongas la contraseña de la herramienta en la app.** Compártela por el canal que ya usen.

---

## Cómo funciona

- **Margen de 15 minutos:** nadie puede reservar a menos de 15 minutos del turno de otra persona. La app lo muestra rayado en gris y lo valida en el servidor.
- **Alertas:** a quien tiene el turno le llega un correo 15 minutos antes de terminar (solo en turnos de 25 minutos o más) y otro 5 minutos antes, con la invitación a guardar su trabajo y reservar otro espacio. Si tiene la app abierta, también ve el aviso en pantalla.
- **Liberar ahora:** si alguien termina antes, puede liberar la herramienta y el espacio queda disponible de inmediato.
- **Autogestión:** cada quien crea, cambia y cancela solo sus propias reservas. No hay administrador.
- **Exportar:** botón **Exportar CSV** (abre en Excel) y, en cada reserva propia, **Agregar a mi calendario** (archivo .ics para Outlook o Google Calendar).
- **Zonas horarias:** cada persona ve las horas en su zona; los correos usan la zona de quien los recibe.
- **Historial:** la hoja de Google guarda todas las reservas, incluidas las canceladas, por si quieres revisar el uso.

## Ajustes en CONFIG (Code.gs)

| Ajuste | Qué hace | Valor actual |
|---|---|---|
| `BUFFER_MIN` | Minutos entre turnos | 15 |
| `MIN_DURATION_MIN` | Duración mínima de una reserva | 15 |
| `MAX_DURATION_MIN` | Duración máxima de una reserva | 240 (4 h) |
| `MAX_DAYS_AHEAD` | Hasta cuántos días adelante se reserva | 30 |
| `ALLOWED_DOMAINS` | Dominios de correo permitidos | `[]` (todos) |
| `SENDER_NAME` | Nombre del remitente en los correos | Reservas AP Latam |

Recuerda publicar una nueva versión (paso 14) después de cambiar cualquiera.

## Límites de Google

- **Correos:** una cuenta de Gmail gratuita puede enviar 100 correos al día; una de Google Workspace, 1,500. Cada turno usa hasta 2 alertas, más los códigos de acceso. Para 9 a 13 personas alcanza de sobra.
- **Alertas cada minuto:** usan unos 30 de los 90 minutos diarios de ejecución automática que da una cuenta gratuita.

## Si algo falla

| Síntoma | Solución |
|---|---|
| La página dice "Falta conectar el backend" | Falta pegar la URL en `API_URL` (paso 12). |
| "No pudimos conectar" | Revisa que la URL termine en `/exec` y que la implementación diga **Cualquier usuario** en "Quién tiene acceso". |
| No llega el código | Revisar correo no deseado. En Apps Script › Ejecuciones puedes ver errores. |
| Cambié `Code.gs` y no se nota | Publica una nueva versión (paso 14). |
| No llegan las alertas | Ejecuta `setup` de nuevo; vuelve a crear la alerta automática. Puedes verla en Apps Script › Activadores. |
