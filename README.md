# MyPOS_FBM (POS NEW STYLE)

Aplicación Django para buscador y punto de venta (POS) con UI Bootstrap 5, cachés locales (Parquet/SQLite) e integración con servicios externos (Fabric/D365). Incluye catálogo con filtros, carrito con multipagos, modal de stock, detalles con atributos, simulador de pagos externo y generación de presupuesto.

Esta guía funcional y técnica cubre instalación, configuración, arquitectura, API, front y operación.

## Tabla de contenidos

- Requisitos y arranque rápido
- Configuración (.env) y variables
- Arquitectura y módulos
- Datos y cachés (Parquet/SQLite)
- Scheduler y jobs
- API (detallada con ejemplos)
- Frontend (flujos, modales, atajos)
- Estilos y branding
- Persistencia de carrito (local/remota)
- Paginación y rendimiento
- Seguridad y autenticación
- Despliegue (prod) y estáticos
- Pruebas y diagnóstico
- Mantenimiento y tareas operativas
- Changelog

## Requisitos y arranque rápido

- Python 3.10+
- Virtualenv recomendado: `python -m venv .venv && . .venv/bin/activate` (Windows: `.venv\Scripts\activate`)
- Instalar dependencias: `pip install -r requirements.txt`
- Migraciones (si aplica): `python manage.py migrate`
- Ejecutar: `python manage.py runserver`

En el arranque, `core.apps.CoreConfig.ready()` inicializa SQLite y arranca el scheduler. En la primera ejecución, se dispara un bootstrap paralelo para construir Parquet de datos base.

## Configuración (.env) y variables

- `OPENSSL_PATH`: ruta al binario de OpenSSL si no está en `PATH`.
- `DJANGO_SESSION_FILE_PATH`: carpeta para sesiones de archivo (default `sessions/`).
- Scheduler:
  - `APS_MAX_WORKERS`: hilos para jobs (default 10).
  - `INITIAL_LOAD_MAX_WORKERS`: hilos para bootstrap inicial (default 6).
- Front/externos:
  - `SIMULATOR_V5_URL`: URL del simulador de pagos V5 (inyectable en `window.SIMULATOR_V5_URL`).

Ver también `services/config.py` para rutas de Parquet y caches.

## Arquitectura y módulos

- `core/apps.py`: arranque del app, UTF‑8 en Windows, init DB y scheduler.
- `core/scheduler.py`: jobs, bootstrap, lectura de Parquet con caché en memoria por mtime.
- `services/`:
  - `database.py`: SQLite (tablas de atributos, stock, carrito/pagos, etc.).
  - `caching.py`: escritura de Parquet desde SQLite.
  - `fabric.py`: extracción desde Fabric (atributos, stock, etc.).
  - `email_service.py`: avisos de error.
  - `config.py`: rutas de archivos (CACHE_FILE_*).
- Front:
  - `core/templates/pos_retail.html`: vista de catálogo/carrito.
  - `core/static/js/pos_retail.js`: catálogo, filtros, carrito, modales, API.
  - `core/static/css/pos_retail.css`, `core/static/css/styles.css`: estilos y variables CSS.

## Datos y cachés (Parquet/SQLite)

- Bootstrap inicial escribe Parquet a partir de SQLite/servicios.
- Lectura usando `pyarrow` con caché por mtime (evita relecturas costosas).
- Archivos clave (según `services/config.py`):
  - `CACHE_FILE_PRODUCTOS`, `CACHE_FILE_CLIENTES`, `CACHE_FILE_STOCK`, `CACHE_FILE_ATRIBUTOS`.
- SQLite (`services/database.py`):
  - `atributos(product_number, product_name, attribute_name, attribute_value)`.
  - `stock(codigo, almacen_365, stock_fisico, disponible_venta, disponible_entrega, comprometido)`.
  - Tablas de pagos/simulaciones (según implementación).

## Scheduler y jobs

Jobs definidos en `core/scheduler.py` (cron aproximado):

- Keep‑alive: cada 5 min (log de vida del scheduler).
- Token D365: cada 10 min.
- Cachés simples: clientes (14 min), productos (20 min).
- Con dependencias:
  - Stock Fabric → cache stock (20 min).
  - Atributos Fabric → cache atributos (30 min).
  - Empleados Fabric → diaria 07:00.
- Semanales: grupos de cumplimiento y datos de tiendas (sáb 22:00/22:30).

Bootstrap paralelo (una vez): genera Parquet iniciales y graba `bootstrap_done.flag`.

## API (detallada con ejemplos)

Autenticación: requiere usuario logueado (decorador `@login_required`), y CSRF en POST.

- Productos por código
  - `GET /api/productos/by_code?code=STRING`
  - Respuesta: `[{...}]` (lista con 1 producto)

- Stock por producto y sucursal
  - `GET /api/stock/<codigo>/<store>`
  - Respuesta: `[ { codigo, almacen_365, stock_fisico, disponible_venta, disponible_entrega, comprometido }, ... ]`

- Atributos de producto
  - `GET /producto/atributos/<int:product_id>`
  - Respuesta:
    ```json
    {
      "product_name": "Cerro Negro...",
      "product_number": "171780",
      "attributes": [
        {"ProductNumber":"171780","ProductName":"...","AttributeName":"Medidas","AttributeValue":"51x51"},
        ...
      ]
    }
    ```

- Carrito remoto
  - `GET /api/get_user_cart` → `{...carrito...}`
  - `POST /api/save_user_cart` → `{ ok: true }` (cuerpo: `{ userId, cart, timestamp }`)

- Sucursal preferida
  - `POST /api/update_last_store` → `{ ok: true }` (cuerpo: `{ store_id }`)

- Clientes
  - `GET /api/clientes/search?query=STRING` → `[ { numero_cliente, nombre_completo, nif, ... }, ... ]`
  - `POST /api/clientes/create` → `{ customer_id, message }`
  - `POST /api/clientes/validate` → `{ exists: bool, client?: {...} }`

## Frontend (flujos, modales, atajos)

- Búsqueda y filtros
  - Campo de búsqueda compacto (Ctrl+K enfoca y selecciona).
  - Filtros: categoría, cobertura, precio mínimo/máximo, signos de stock, sucursal.
  - Chips con filtros activos y limpieza individual.
- Catálogo y tarjetas
  - Orden: relevancia (por coincidencias), precio asc/desc, alfabético.
  - Paginación: 20 ítems por página; ventana compacta con elipsis.
- Modales
  - Detalle de producto: imagen, quick‑specs, atributos agrupados.
  - Botón “Agregar al Carrito” (debajo del precio, derecha) abre modal de cantidad.
  - Stock por almacén, cantidad (con múltiplos y equivalencia de m² a cajas).
- Carrito
  - Totales (IVA por ítem), descuentos (% y monto), logística y pagos múltiples.
  - Persistencia local (localStorage) y remota (por usuario) asincrónica.
- Simulador V5
  - `#modalSimV5` abre `SIM_V5_URL`; se le envía el total con `postMessage`.
- Atajos
  - F1/F2/F6/F7/F8/F9/F10 y Ctrl+K (ver pos_retail.js para detalles).

## Estilos y branding

- Color base corporativo: `#df0209` aplicado a `--brand-primary`, `--bs-primary`, `.btn-primary/.btn-outline-primary`, badges, links, etc.
- Soporte tema claro/oscuro (`data-bs-theme`), toggle en `#btnToggleTheme`.
- Búsqueda compacta: `input-group-sm` + `form-control-sm`.

## Persistencia de carrito

- Estructura en localStorage: clave `pos.front.state` con `{ carrito, filtros, clientes, tema, currentPage, itemsPerPage }`.
- Remota por usuario: endpoints `/api/get_user_cart` y `/api/save_user_cart` (debounced ~400ms).

## Paginación y rendimiento

- Tamaño fijo: 20 ítems/página.
- `renderPagination` limita botones y usa elipsis; CSS permite `flex-wrap` para evitar overflow.
- Lazy‑load de imágenes con `IntersectionObserver` y cacheo en `sessionStorage`.

## Seguridad y autenticación

- Todas las APIs protegidas con `@login_required`.
- CSRF en POST; usa encabezados adecuados (`Content-Type: application/json`).
- Manejo de errores y logs: `services/logging_utils.py` y correo en jobs fallidos.

## Despliegue (prod) y estáticos

- Recomendado: `DEBUG=False`, `ALLOWED_HOSTS=*` apropiados.
- Servir estáticos con `collectstatic` (CDN o servidor frontal).
- Mantener carpeta `sessions/` persistente y con permisos de escritura.

## Pruebas y diagnóstico

- Smoke test del modal del simulador: `python manage.py test_sim_modal` (management command en `core/management/commands/test_sim_modal.py`).
- Verificar caches: presencia de archivos Parquet y tamaño razonable.
- Revisar `bootstrap_done.flag` si se completó el bootstrap inicial.

## Mantenimiento y tareas operativas

- Forzar refresco de cachés (vía scheduler o llamando funciones de `services.caching`).
- Revisar logs de scheduler para errores de Fabric/D365.
- Si no carga Bootstrap JS (CDN), el front aplica fallback básico de modales.

## Changelog (últimos cambios relevantes)

- Atributos: renderer dinámico, quick‑specs y contenedor único en el modal.
- Botón “Agregar al Carrito” en detalle de producto.
- Paginación compacta y 20 ítems/página.
- Branding rojo `#df0209` en todo el front.
- Buscador de filtros reducido.
