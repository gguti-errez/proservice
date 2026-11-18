# Plan de mttos PBS (multicliente)

Seguimiento en tiempo real del plan de mantenimientos de impresoras, con logo y colores de PBS.
Se ve desde cualquier dispositivo (computadora, tablet, celular) con solo abrir la dirección web.

## Qué incluye
- **Varios clientes, cada uno con su catálogo independiente.** CORINSA ya viene cargado; los demás se agregan desde Administración.
- **Perfiles** (validados en el servidor, no solo en la pantalla). No hay límite de cuentas de administrador ni de colaborador:
  - **Administrador**: acceso total. Crea clientes y cuentas (de cualquier perfil), elimina equipos, exporta respaldo. Siempre debe quedar al menos un administrador activo.
  - **Colaborador**: ve todos los clientes, registra mantenimientos, agrega/edita equipos e importa inventario. **No elimina equipos.** Una vez que un equipo queda *listo*, el colaborador ya no puede *Reabrir* ni usar *Checklist y observaciones* (solo un administrador). Al *Editar* un equipo, el colaborador solo puede cambiar *Localidad* y *Ubicación de la impresora*. Con el equipo *en espera de repuesto*, el colaborador tampoco puede usar *Volver a pendiente* ni *Checklist y observaciones* (sí puede *Actualizar repuesto* y *Marcar listo*). Cada solicitud o cambio de repuesto, cada edición de observaciones y la instalación del repuesto al pasar a listo quedan en el **Historial de cambios** (fecha, hora y usuario) dentro de *Ver detalle*.
  - **Cliente** (varias cuentas por cliente): solo lectura y solo de su propio catálogo. No ve datos ni evidencias de otros clientes.
- **Cerrar sesión** siempre visible en la parte superior, junto al nombre de la cuenta.
- **Imprimir resumen**: botón en la parte superior para todos los perfiles. Genera un resumen de una página (avance, tablas por empresa, familia, tipo, localidad y modelo, repuestos, atrasados y próximos servicios) según los filtros activos. En el cuadro de impresión elige "Guardar como PDF" para descargarlo.
- **Alta manual de equipos**: "+ Agregar equipo" permite uno o varios equipos puntuales ("Guardar y agregar otro"), también en un cliente sin plan (crea su primer plan).
- Resumen con gráfico de pastel, barras con cantidades por empresa, familia, tipo, modelo y localidad, y próximos servicios.
- **Panel gerencial** (solo administradores, es su página de inicio): avance global, cumplimiento por cliente (avance, puntualidad, atrasados y próximos servicios vencidos), productividad y eficiencia por colaborador (equipos por día/semana/mes, horas promedio por equipo, equipos por hora, puntualidad) y horas de trabajo por máquina/serie. Filtros por cliente y fechas; botones **Exportar Excel** (6 hojas: resumen, clientes, colaboradores, por periodo, horas por equipo y detalle) e **Imprimir / PDF**. Las horas salen de la **hora de llegada y salida**, obligatorias al marcar un equipo como listo. El trabajo se atribuye a quien marcó el equipo como listo; los equipos ya listos del plan original no tienen colaborador ni horas ("Sin asignar") y no entran en los promedios de horas.
- **Firma del cliente** al marcar un equipo como listo: se dibuja con dedo, lápiz táctil o mouse y es obligatoria; si el cliente no puede o no quiere firmar, se marca la casilla y se anota el motivo. Se guarda con fecha, hora y el usuario que registró, y se ve en *Ver detalle*.
- **En espera de repuesto:** al poner un equipo en espera se registran horas de llegada y salida y la firma del cliente (o el motivo). En *Actualizar repuesto* esos datos son opcionales y solo se piden si hubo una nueva visita. Cada visita queda en *Ver detalle* y sus horas suman al tiempo del equipo en el Panel gerencial. Si el repuesto es un **suministro** (tóner, cilindro o cartucho de mantenimiento; se detecta por el texto y se puede corregir con la casilla), la tarjeta y la etiqueta se muestran en **amarillo**; las piezas siguen en rojo. Los cambios de repuesto y de observaciones quedan en el historial. El colaborador puede editar observaciones desde *Actualizar repuesto*, pero no el checklist ni los contadores.
- **Perfil:** cada cuenta tiene el botón *Perfil* (reemplaza a "Mi clave") para personalizar cargo, teléfono, correo y color del avatar, y cambiar su contraseña. El nombre y el usuario los cambia un administrador.
- **Plantilla de calendarización** (`public/plantilla-calendarizacion.xlsx`, también con enlace en *Importar inventario*): una hoja con parámetros (fecha de inicio, equipos por día, frecuencia), feriados de Honduras 2026-2028 editables y fechas calculadas por localidad (una localidad por día, lunes a sábado, sin domingos ni feriados), con avisos de series repetidas y localidades parecidas. Al importar se leen solo las columnas de la tabla.
- **Calendario** mensual por cliente con realizados, pendientes, en espera de repuesto y próximos servicios; domingos y feriados sombreados.
- **Importación de inventario** desde Excel (.xlsx) o CSV, con vista previa y plantilla descargable.
- **Ver detalle** (administradores, colaboradores y cuentas de cliente): ventana de solo lectura con estado, fechas, quién registró y cuándo, contadores, checklist completo actividad por actividad, observaciones y evidencia.
- Mantenimiento con fecha programada, checklist de 16 actividades del preventivo (tóner obligatorio; incluye sección de salida, contactos y/o tarjetas, finalizador, calibración y limpieza general) más 3 actividades adicionales opcionales (capacitación de usuario, despeje de código de error y reubicación de equipo), contadores Total / B-N / Color (los tres obligatorios; B-N + Color = Total), observaciones y evidencia PDF/JPG.
- **Frecuencia configurable por cliente** (por defecto 6 meses), siempre evitando domingos y feriados.
- Planes por ciclo (2026, 2027, 2027B…): "Nuevo plan" copia el plan en pantalla.
- Todos los cambios aparecen al instante en todas las pantallas abiertas.

## Control de horas extras (`he.js` + `public/horas-extras.html`)
Página: `/horas-extras.html` (ya tiene su pestaña “Horas extras” en el menú del plan de mttos, visible solo para colaboradores y administradores; el cliente no la ve).
- **Técnico (colaborador):** registra sus horas (fecha, inicio, fin, tipo de observación y detalle) y ve **únicamente las suyas**. Edita o elimina mientras estén *Pendientes* o *Devueltas*; un registro *Autorizado* solo lo reabre un administrador.
- **Administrador:** ve todo, autoriza (uno por uno o en lote), devuelve con motivo, reabre, consulta el **resumen del período** (del 15 al 14), el **calendario** por colaborador y exporta a **Excel**. También agrega feriados.
- **Cliente:** sin acceso (403).
- **Reglas:** diurna 5:00 a. m.–7:00 p. m., el resto nocturna; domingos y feriados cuentan completos como dobles; si pasa de la medianoche se divide por día; máx. 16 h por registro; no se aceptan fechas futuras ni horarios que se crucen con otro registro del mismo técnico. Se marca *Fuera de plazo* cuando se reporta después del día siguiente al trabajo. Solo cuenta horas; no calcula valores monetarios.
- **Privacidad:** todo se valida en el servidor (`he.js`). Un técnico solo recibe sus registros; pedir el registro de otro devuelve 404. Las colecciones `he_reg` y `he_fer` no se pueden leer por `/api/col` ni `/api/doc`. Las horas de un registro autorizado quedan congeladas al autorizar.
- **Feriados:** vienen cargados los fijos y Semana Santa 2026–2028; los demás (por ejemplo el Feriado Morazánico) se agregan en la pestaña *Feriados*. También se leen las fechas de la colección `feriados` del calendario, si las trae.
- **Reporte para Recursos Humanos (`he-form.js` + `he-form-tpl.js`):** al cerrar el período (a partir del día 15) el colaborador descarga el suyo y el administrador el de un colaborador o el de todos (una hoja por colaborador). Es el formato oficial `Formato_Horas_Extras_Limpio` (logo, columnas Mañana/Tarde/Noche, Diurnas/Nocturna/Dobles, horas de viaje, totales y firmas) y solo incluye horas **autorizadas**. Se entrega como `.xlsx`. Si hay más de 7 registros se agregan hojas idénticas con su propio total. El código y el departamento del encabezado se editan en la pestaña *Empleados*. Turnos: Mañana 5:00–12:00, Tarde 12:00–19:00, Noche 19:00–5:00. La plantilla va incrustada en `he-form-tpl.js` (no hay que subir el .xls).
- **Horas de viaje:** campo opcional al registrar; se imprime en la columna "Horas de viaje" del reporte.
- **Datos:** se guardan en las mismas tablas de Supabase (`mttos_docs`); no hay que cambiar nada en `supabase-setup.sql`.

## Primer arranque y cuentas
1. Despliega sin definir ninguna contraseña. Al abrir la página por primera vez aparece **Configuración inicial**: ahí defines tú la contraseña de la cuenta **`admin`** (mínimo 8 caracteres). Hazlo apenas despliegues: quien abra la página primero podría crear esa cuenta. Para evitarlo, define la variable `SETUP_CODE` y la pantalla exigirá ese código.
   - Alternativa: definir `APP_PASSWORD` en el hosting; en ese caso la cuenta `admin` se crea sola con esa clave y no aparece la pantalla de configuración.
2. Entra como `admin` > **Administración** > *Clientes* para agregar clientes (nombre, código y frecuencia en meses) y *Cuentas* para crear colaboradores y usuarios de cliente.
3. Elige el cliente en el selector, pulsa **Importar inventario** y sube el archivo.
4. Si olvidas la clave de `admin`: arranca una vez con `RESET_MASTER=1` y `APP_PASSWORD=<clave nueva>`, y luego quita ambas variables.

### Plantilla de importación
Columnas: **Empresa** (opcional), **Localidad**, **Equipo / Ubicación**, **Modelo**, **Serie**, **Fecha programada** (dd/mm/aaaa o aaaa-mm-dd) y **Contador anterior** (opcional). Se puede descargar desde la ventana de importación. Archivos .xls antiguos: guárdalos como .xlsx o CSV.

### Notas de seguridad
- Cada petición se valida en el servidor según el perfil y el cliente. Las evidencias solo se descargan con sesión y del cliente permitido.
- Las sesiones usan cookie firmada (HttpOnly, SameSite=Strict, Secure con HTTPS) y vencen por inactividad (`SESSION_MINUTES`, 60 por defecto).
- Los clientes no se eliminan, se desactivan. El respaldo completo está en `/api/export` (solo admin).
- La regla de "tóner obligatorio" y la validación de contadores se aplican en la pantalla.

## Requisitos
- Node.js 18 o superior. No hay que instalar paquetes (`npm install` no es necesario).

## Probar en tu computadora
```bash
node server.js
# abre http://localhost:3000
```
Opcionalmente `DATA_DIR=./data` cambia la carpeta de datos.

## Variables de entorno
| Variable | Para qué sirve | Por defecto |
|---|---|---|
| `APP_PASSWORD` | Opcional. Clave inicial de `admin`; si no se define, se pide en la pantalla de configuración inicial (mínimo 8 caracteres) | — |
| `SETUP_CODE` | Opcional. Código que se exige en la configuración inicial | — |
| `MASTER_USER` | Nombre de usuario de la cuenta master | admin |
| `RESET_MASTER` | `1` junto con `APP_PASSWORD` restablece la clave del master (usar una sola vez) | — |
| `PORT` | Puerto | 3000 |
| `DATA_DIR` | Carpeta donde se guardan datos y evidencias | `./data` |
| `SESSION_MINUTES` | Minutos de sesión sin cambios | 60 |
| `SUPABASE_URL` | Dirección del proyecto de Supabase (`https://xxxx.supabase.co`). Activa el almacenamiento persistente | — |
| `SUPABASE_SERVICE_KEY` | Llave **secreta** de Supabase (`sb_secret_…`). Solo en variables de entorno; nunca en el repositorio ni en el navegador | — |
| `SUPABASE_BUCKET` | Bucket de evidencias | evidencias |

## Datos permanentes en Supabase + servidor siempre activo (Render gratis)
En el plan gratuito de Render el disco se borra al reiniciar. Con Supabase los equipos, avances, bitácora, firmas, cuentas **y las evidencias PDF/JPG** se guardan fuera de Render, y el servidor de Render queda sin estado.

### 1. Crear el proyecto en Supabase (una sola vez)
1. Entra a supabase.com → *Start your project* → crea cuenta → **New project**. Nombre: `plan-mttos-pbs`. Define una contraseña de base de datos (guárdala) y elige la región más cercana (por ejemplo East US).
2. Menú **SQL Editor** → *New query* → pega el contenido de `supabase-setup.sql` → **Run**. Crea la tabla `mttos_docs` (con RLS activado y sin políticas, por lo que nadie accede con llaves públicas) y el bucket privado `evidencias`.
3. **Project Settings → API Keys**: copia la *Project URL* (`https://xxxx.supabase.co`) y crea/copia la **Secret key** (`sb_secret_…`). Esa llave da acceso total: no la compartas ni la pegues en chats o en GitHub.

### 2. Conectar Render
En Render → tu servicio → **Environment** → agrega `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` (y `SETUP_CODE` si aún no lo tienes) → *Save, rebuild and deploy*. En el registro debe aparecer `Supabase: base vacía; se subirán los datos locales` la primera vez, y `Supabase: N registros cargados` en los siguientes arranques.

### 3. Comprobar que funciona
Inicia sesión como administrador → **Administración**: arriba debe decir *Almacenamiento: Supabase conectado*. Si dice *SIN Supabase* faltan las variables. Prueba real: registra un cambio, en Render pulsa *Manual Deploy → Restart*, e inicia sesión de nuevo: tus cuentas, avances y evidencias deben seguir ahí.
- Si Supabase no responde, el servidor reintenta solo cada 10 segundos y no pierde los cambios mientras siga encendido. Si no puede leer Supabase al arrancar, **no inicia vacío**: se detiene para no sobrescribir datos.
- Plan gratuito de Supabase: 500 MB de base de datos, 1 GB de archivos, y el proyecto se **pausa tras 1 semana sin actividad**. El ping de abajo también lo evita.

### 4. Mantener Render despierto (cada 14 minutos)
El archivo `.github/workflows/keepalive.yml` hace que GitHub llame a `/healthz` cada 14 minutos.
1. Sube la carpeta `.github` completa al repositorio (en GitHub: *Add file → Upload files* no siempre acepta carpetas ocultas; si falla, usa *Add file → Create new file*, escribe `.github/workflows/keepalive.yml` como nombre y pega el contenido).
2. Repositorio → **Settings → Secrets and variables → Actions → pestaña Variables → New repository variable**: nombre `APP_URL`, valor la dirección de tu servicio (`https://tu-servicio.onrender.com`).
3. Pestaña **Actions** → *Mantener Render activo* → **Run workflow** para probarlo. Debe terminar en verde y mostrar `{"ok":true,...}`.
- GitHub puede retrasar unos minutos las ejecuciones programadas y desactiva los flujos programados de repositorios sin actividad durante 60 días (entra a Actions y reactívalo). Respaldo opcional: crea un monitor gratuito en cron-job.org o UptimeRobot que llame a `https://tu-servicio.onrender.com/healthz` cada 5 a 14 minutos.
- Comando manual: `curl -fsS https://tu-servicio.onrender.com/healthz`.

## Desplegar en un servidor
**Lo esencial:** el servidor necesita un **disco persistente** en `DATA_DIR`. Si el hosting borra los archivos al reiniciar (planes gratuitos sin disco), se pierde el avance.

### Opción A: Docker en un servidor propio o VPS
```bash
docker build -t mttos.pbs .
docker run -d --name mantenimientos --restart unless-stopped \
  -p 3000:3000 -v mantenimientos_datos:/data \
  -e SETUP_CODE="codigo-que-tu-elijas" mttos.pbs
```

### Opción B: Render
Sube esta carpeta a un repositorio de GitHub y crea un "Blueprint" con `render.yaml`. Define `SETUP_CODE` en el panel (opcional). Con Supabase (ver sección anterior) puedes usar el plan Free sin perder datos. Sin Supabase el disco persistente exige plan de pago.

### Opción C: Railway / Fly.io
Crea el servicio desde el repositorio, agrega un volumen montado en `/data`, define `DATA_DIR=/data` y, si quieres, `SETUP_CODE`.

### Opción D: Servidor Linux con Node
```bash
npm i -g pm2
DATA_DIR=/var/lib/mttos pm2 start server.js --name mttos-pbs
pm2 save && pm2 startup
```

### HTTPS (obligatorio si es por internet)
Pon el servidor detrás de HTTPS (Nginx, Caddy o el HTTPS que ya da Render/Railway/Fly). Sin HTTPS la contraseña viaja sin cifrar. Con Nginx, desactiva el buffering para el tiempo real:
```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_buffering off;
  proxy_read_timeout 1h;
}
```

## Respaldo
Copia periódicamente la carpeta `DATA_DIR` (contiene `data.json` y `uploads/`). Para restaurar, ponla de vuelta y reinicia. También existe `GET /api/export` (requiere sesión) que devuelve todos los datos en JSON.

## Cambiar claves
Cada persona cambia la suya en "Mi clave". El master puede asignar una clave nueva a cualquier cuenta en Administración > Cuentas.

## Seguridad: lo que debes saber
- **Nunca escribas claves en archivos del repositorio.** Si usas `APP_PASSWORD` o `SETUP_CODE`, defínelos solo como variables de entorno en el hosting.
- Hay que iniciar sesión para ver cualquier dato. Límite de intentos: 4 fallos = 1 minuto de espera.
- La acción de cada persona queda en "Actividad reciente" con su nombre.
- Solo se aceptan PDF y JPG de hasta 10 MB, verificados por su contenido.
- Usa siempre HTTPS: la clave viaja en cada inicio de sesión.

## Notas técnicas
- Un solo proceso: no lo escales a varias instancias (los datos están en un archivo JSON y el tiempo real es en memoria). Pensado para cientos de equipos y decenas de usuarios.
- El inventario original de CORINSA 2026 (129 equipos) va en `seed-corinsa.json` y solo lo entrega el servidor a quien puede ver CORINSA. Los datos de despliegues anteriores siguen funcionando: se conservan como cliente CORINSA.
- Archivos: `server.js` (servidor), `reports.js` (métricas y Excel del panel), `he.js` (horas extras), `public/index.html` (página), `public/horas-extras.html` (horas extras), `seed-corinsa.json`.
