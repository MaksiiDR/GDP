# Mi Plata

App web para ordenar tu plata: cuentas de varios bancos, **apartados** dentro de cada cuenta (plata separada para algo que sigue en la misma cuenta) y cuánto te queda **libre**. Los cargos de tus tarjetas se anotan solos leyendo los correos que te manda el banco.

Funciona sobre tu propia cuenta de Google:
- **Datos:** una planilla "Mi Plata - datos" en tu Drive (puedes abrirla y ver todo).
- **Correos:** lee tu Gmail (solo lectura) buscando avisos de compra.
- **Hosting:** Google Apps Script, gratis. Nadie más tiene acceso.

## Archivos

| Archivo | Qué es |
|---|---|
| `Code.gs` | Backend: guarda en la planilla, lee Gmail, revisión automática cada 10 min |
| `Parser.gs` | Lector de los correos del banco (monto, comercio, últimos 4 dígitos, fecha) |
| `Index.html` | La app (pantalla del celular) |
| `appsscript.json` | Permisos y zona horaria |

## Instalación (10 minutos, una sola vez)

1. Entra a <https://script.google.com> → **Nuevo proyecto**. Ponle de nombre **Mi Plata**.
2. ⚙️ **Configuración del proyecto** → activa **"Mostrar el archivo de manifiesto appsscript.json"**.
3. Vuelve al **Editor** y crea/pega estos archivos (botón **+** al lado de "Archivos"):
   - `appsscript.json` → reemplaza todo por el contenido de `appsscript.json`.
   - `Código.gs` → reemplaza todo por el contenido de `Code.gs`.
   - **+ Secuencia de comandos** llamada `Parser` → pega `Parser.gs`.
   - **+ HTML** llamado `Index` → pega `Index.html`.
4. Guarda (Ctrl+S). Arriba elige la función **getState** y aprieta **Ejecutar**. Google te pedirá permisos:
   aparecerá "Google no verificó esta app" (es normal, la app es tuya) → **Configuración avanzada** → **Ir a Mi Plata** → **Permitir**.
5. **Implementar** → **Nueva implementación** → tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Solo yo**
   → **Implementar** y copia la URL.
6. Abre esa URL en el Chrome del celular → menú ⋮ → **Agregar a la pantalla principal**. Queda como una app.

> Cada vez que cambies el código: **Implementar → Administrar implementaciones → ✏️ → Versión: nueva → Implementar** (la URL no cambia).

## Primer uso

1. **Agregar cuenta** por cada cuenta, con el saldo que muestra tu banco hoy (las tarjetas de crédito con su deuda actual).
2. En cada cuenta, **Apartar** → "Nuevo apartado…" para separar plata (arriendo, emergencias, vacaciones…). La barra de colores muestra cómo está repartida la cuenta y lo verde es lo libre.
3. Pestaña **Correos**:
   - **Tus tarjetas** → agrega los últimos 4 dígitos de cada tarjeta y a qué cuenta van.
   - **Probar con un correo** → pega el texto de un aviso de compra real de tu banco y revisa que saque bien el monto, comercio y tarjeta.
   - **Revisar correos ahora**, y luego activa **Revisar solo cada 10 minutos**.
4. Los cargos que lleguen aparecen con un punto naranjo en **Por revisar**. Tócalos y elige si salieron de lo libre o de un apartado.

## Cómo se calcula

- **Saldo** de una cuenta = saldo inicial + todos sus movimientos.
- **Apartado** = lo que pusiste + ingresos − gastos marcados "salió de este apartado".
- **Libre** = saldo − lo apartado.
- **Transferir** entre tus cuentas (o **Pagar tarjeta**) no cuenta como gasto del mes.
- Si el saldo no calza con el banco, edita la cuenta y pon el saldo real: se anota un "Ajuste de saldo".

## Si un correo no se entiende

En **Correos → Últimos correos leídos** aparecen en rojo los que no se entendieron, con un extracto. Si es un aviso real de tu banco, copia ese texto y se puede ajustar `Parser.gs` para ese formato. Tocar el correo lo deja para volver a leerlo en la próxima revisión.

Si tu banco no aparece en la búsqueda por defecto, en **Correos → Qué correos buscar** agrega su remitente con `from:dominio.cl`.

## Probar sin instalar

Abre `Index.html` con un servidor local (por ejemplo `python -m http.server` en esta carpeta) y entra a `/Index.html`: funciona en **modo demo** con datos de ejemplo guardados en el navegador.
