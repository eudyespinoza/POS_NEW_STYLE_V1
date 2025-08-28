import sqlite3
import os
import locale
import time
from contextlib import contextmanager
import pyarrow.parquet as pq
import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow as pa
from services.logging_utils import get_module_logger
try:
    from services.config import CACHE_FILE_PRODUCTOS
except Exception:
    from config import CACHE_FILE_PRODUCTOS
import json



# Configuración inicial
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DB_PATHS = {
    "atributos": os.path.join(BASE_DIR, "atributos.db"),
    "empleados": os.path.join(BASE_DIR, "empleados.db"),
    "misc": os.path.join(BASE_DIR, "misc.db"),
    "stock": os.path.join(BASE_DIR, "stock.db"),
    "store_data": os.path.join(BASE_DIR, "store_data.db"),
    "grupos_cumplimiento": os.path.join(BASE_DIR, "grupos_cumplimiento.db"),
    "secuencias_numericas": os.path.join(BASE_DIR, "secuencias_numericas.db"),
    "tipos_entrega": os.path.join(BASE_DIR, "tipos_entrega.db"),
    "config_impositiva": os.path.join(BASE_DIR, "config_impositiva.db")
}

logger = get_module_logger(__name__)

try:
    locale.setlocale(locale.LC_ALL, 'es_AR.UTF-8')
except Exception as e:
    logger.warning(f"No se pudo aplicar locale es_AR.UTF-8: {e}")

# Configuración de reintentos
MAX_RETRIES = 5
RETRY_DELAY = 2.5  # segundos

@contextmanager
def conectar_db(tabla):
    """Gestor de conexión optimizado con timeout y configuraciones para una tabla específica."""
    db_path = DB_PATHS.get(tabla)
    if not db_path:
        raise ValueError(f"No se encontró una base de datos para la tabla {tabla}")
    # Asegurar que el directorio de la base de datos exista antes de conectar
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    try:
        conexion = sqlite3.connect(db_path, timeout=10)
        conexion.execute("PRAGMA journal_mode=WAL;")
        conexion.execute("PRAGMA synchronous=NORMAL;")
        logger.info(f"Conectado a la base de datos: {db_path} para tabla {tabla}")
        yield conexion
    except sqlite3.Error as e:
        logger.error(f"Error al conectar con la base de datos {db_path}: {e}")
        raise
    finally:
        if 'conexion' in locals():
            conexion.close()
            logger.debug(f"Conexión cerrada correctamente para {db_path}.")

def formatear_moneda(valor):
    if valor is None:
        return "N/A"
    try:
        return locale.format_string("%.2f", valor, grouping=True)
    except ValueError:
        return str(valor)

def obtener_stores_from_parquet():
    for attempt in range(MAX_RETRIES):
        try:
            if not os.path.exists(CACHE_FILE_PRODUCTOS):
                logger.error(f"El archivo Parquet no existe en la ruta: {CACHE_FILE_PRODUCTOS}")
                return []
            dataset = ds.dataset(CACHE_FILE_PRODUCTOS, format="parquet")
            tbl = dataset.to_table(columns=["store_number"])
            stores = sorted(set(tbl.column("store_number").to_pylist()))
            logger.info(f"Se obtuvieron {len(stores)} tiendas únicas desde el Parquet.")
            return stores
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                logger.warning(f"Error al obtener tiendas desde Parquet, reintentando ({attempt + 1}/{MAX_RETRIES})...: {e}")
                time.sleep(RETRY_DELAY)
                continue
            logger.error(f"Error al obtener tiendas desde Parquet tras {MAX_RETRIES} intentos: {e}")
            return []

def obtener_equivalencia(codigo):
    if not codigo:
        logger.warning("Falta código para obtener equivalencia.")
        return []
    for attempt in range(MAX_RETRIES):
        try:
            if not os.path.exists(CACHE_FILE_PRODUCTOS):
                logger.error(f"El archivo Parquet no existe en la ruta: {CACHE_FILE_PRODUCTOS}")
                return []
            dataset = ds.dataset(CACHE_FILE_PRODUCTOS, format="parquet")
            filtro = ds.field("numero_producto") == str(codigo)
            tbl = dataset.to_table(filter=filtro, columns=["multiplo"])
            multiplos = tbl.column("multiplo").to_pylist()
            if not multiplos:
                logger.info(f"No se encontraron múltiplos para el código {codigo} en el Parquet.")
                return []
            logger.info(f"Se encontraron {len(multiplos)} múltiplos para el código {codigo}: {multiplos}")
            return multiplos
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                logger.warning(
                    f"Error al obtener equivalencia desde Parquet, reintentando ({attempt + 1}/{MAX_RETRIES})...: {e}")
                time.sleep(RETRY_DELAY)
                continue
            logger.error(f"Error al obtener equivalencia desde Parquet tras {MAX_RETRIES} intentos: {e}")
            return []

def init_db():
    # Inicializar cada base de datos por separado
    tablas_scripts = {
        "atributos": """
            CREATE TABLE IF NOT EXISTS atributos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_number TEXT,   
                product_name TEXT,
                attribute_name TEXT,
                attribute_value TEXT
            );
        """,
        "empleados": """
            CREATE TABLE IF NOT EXISTS empleados (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                empleado_d365 TEXT,   
                id_puesto TEXT,
                email TEXT UNIQUE,
                nombre_completo TEXT,
                numero_sap TEXT,
                last_store TEXT
            );
        """,
        "misc": """
            CREATE TABLE IF NOT EXISTS misc (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_d365 TEXT,
                contador TEXT,
                contador_pdf TEXT
            );
            CREATE TABLE IF NOT EXISTS carts (
                user_id TEXT PRIMARY KEY,
                cart_json TEXT NOT NULL,
                timestamp TEXT NOT NULL
            );
        """,
        "stock": """
            CREATE TABLE IF NOT EXISTS stock (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                codigo TEXT,
                almacen_365 TEXT,
                stock_fisico REAL,
                disponible_venta REAL,
                disponible_entrega REAL,
                comprometido REAL,
                UNIQUE(codigo, almacen_365)
            );
        """,
        "store_data": """
            CREATE TABLE IF NOT EXISTS store_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                almacen_retiro TEXT,
                sitio_almacen_retiro TEXT,
                id_tienda TEXT,
                id_unidad_operativa TEXT,
                nombre_tienda TEXT,
                almacen_envio TEXT,
                sitio_almacen_envio TEXT,
                direccion_unidad_operativa TEXT,
                direccion_completa_unidad_operativa TEXT,
                UNIQUE(id_tienda)
            );
        """,
        "grupos_cumplimiento": """
            CREATE TABLE IF NOT EXISTS grupos_cumplimiento (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_locator_group_name TEXT NOT NULL,
                invent_location_id TEXT NOT NULL,
                UNIQUE(store_locator_group_name, invent_location_id)
            );
        """,
        "secuencias_numericas": """
            CREATE TABLE IF NOT EXISTS secuencias_numericas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT UNIQUE,
                prefijo TEXT,
                valor_actual INTEGER,
                incremento INTEGER
            );
        """,
        "tipos_entrega": """
            CREATE TABLE IF NOT EXISTS tipos_entrega (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT UNIQUE
            );
        """,
        "config_impositiva": """
            CREATE TABLE IF NOT EXISTS config_impositiva (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT,
                codigo_arca TEXT UNIQUE
            );
        """
    }

    for tabla, script in tablas_scripts.items():
        with conectar_db(tabla) as conexion:
            cursor = conexion.cursor()
            try:
                cursor.executescript(script)
                conexion.commit()
                logger.info(f"Tabla {tabla} verificada/creada exitosamente en {DB_PATHS[tabla]}.")
            except sqlite3.Error as e:
                logger.error(f"Error al inicializar la base de datos para {tabla}: {e}")

def guardar_token_d365(token):
    for attempt in range(MAX_RETRIES):
        with conectar_db("misc") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("BEGIN TRANSACTION;")
                cursor.execute("SELECT COUNT(*) FROM misc WHERE id = 1")
                exists = cursor.fetchone()[0] > 0
                if exists:
                    cursor.execute("UPDATE misc SET token_d365 = ? WHERE id = 1", (token,))
                else:
                    cursor.execute("INSERT INTO misc (id, token_d365, contador) VALUES (1, ?, NULL)", (token,))
                conexion.commit()
                logger.info("Token D365 guardado/actualizado exitosamente.")
                return
            except sqlite3.OperationalError as e:
                conexion.rollback()
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error al guardar token D365 tras {MAX_RETRIES} intentos: {e}")
                raise
            except sqlite3.Error as e:
                conexion.rollback()
                logger.error(f"Error inesperado al guardar token D365: {e}")
                raise

def obtener_token_d365():
    for attempt in range(MAX_RETRIES):
        with conectar_db("misc") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("SELECT token_d365 FROM misc WHERE id = 1")
                token = cursor.fetchone()
                if token and token[0]:
                    logger.info("Token D365 obtenido desde la base de datos.")
                    return token[0]
                logger.warning("No se encontró token D365 en la base de datos.")
                return None
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error al obtener token D365 tras {MAX_RETRIES} intentos: {e}")
                return None
            except sqlite3.Error as e:
                logger.error(f"Error inesperado al obtener token D365: {e}")
                return None

def obtener_contador_presupuesto():
    for attempt in range(MAX_RETRIES):
        with conectar_db("misc") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("BEGIN TRANSACTION;")
                cursor.execute("SELECT contador FROM misc WHERE id = 1")
                contador = cursor.fetchone()
                nuevo_contador = int(contador[0]) + 1 if contador and contador[0] else 1
                cursor.execute("SELECT COUNT(*) FROM misc WHERE id = 1")
                exists = cursor.fetchone()[0] > 0
                if exists:
                    cursor.execute("UPDATE misc SET contador = ? WHERE id = 1", (str(nuevo_contador),))
                else:
                    cursor.execute("INSERT INTO misc (id, token_d365, contador) VALUES (1, NULL, ?)", (str(nuevo_contador),))
                conexion.commit()
                logger.info(f"Contador de presupuestos actualizado: {nuevo_contador}")
                return nuevo_contador
            except sqlite3.OperationalError as e:
                conexion.rollback()
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error al actualizar contador tras {MAX_RETRIES} intentos: {e}")
                raise
            except sqlite3.Error as e:
                conexion.rollback()
                logger.error(f"Error inesperado al obtener/incrementar contador: {e}")
                raise

def agregar_atributos_masivo(lista_atributos):
    if not lista_atributos:
        logger.info("Lista de atributos vacía, no se insertó nada.")
        return 0
    for attempt in range(MAX_RETRIES):
        with conectar_db("atributos") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("PRAGMA synchronous = OFF;")
                cursor.execute("BEGIN TRANSACTION;")
                cursor.execute("DELETE FROM atributos;")
                cursor.executemany("""
                    INSERT INTO atributos (product_number, product_name, attribute_name, attribute_value)
                    VALUES (?, ?, ?, ?);
                """, lista_atributos)
                conexion.commit()
                logger.info(f"Se insertaron {len(lista_atributos)} atributos en SQLite.")
                return len(lista_atributos)
            except sqlite3.OperationalError as e:
                conexion.rollback()
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error en inserción masiva de atributos tras {MAX_RETRIES} intentos: {e}")
                return 0
            except sqlite3.Error as e:
                conexion.rollback()
                logger.error(f"Error inesperado en inserción masiva de atributos: {e}")
                return 0

def obtener_atributos(product_number):
    for attempt in range(MAX_RETRIES):
        with conectar_db("atributos") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("""
                    SELECT product_number, product_name, attribute_name, attribute_value
                    FROM atributos WHERE product_number = ?
                """, (product_number,))
                atributos = [
                    {"ProductNumber": row[0], "ProductName": row[1], "AttributeName": row[2], "AttributeValue": row[3]}
                    for row in cursor.fetchall()
                ]
                logger.info(f"Se obtuvieron {len(atributos)} atributos para el producto {product_number}.")
                return atributos
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error al obtener atributos tras {MAX_RETRIES} intentos: {e}")
                return []
            except sqlite3.Error as e:
                logger.error(f"Error inesperado al obtener atributos para {product_number}: {e}")
                return []

def obtener_stock(formateado=True):
    for attempt in range(MAX_RETRIES):
        with conectar_db("stock") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("""
                    SELECT codigo, almacen_365, stock_fisico, disponible_venta, disponible_entrega, comprometido
                    FROM stock
                """)
                rows = cursor.fetchall()
                if formateado:
                    to_row = lambda r: {
                        "codigo": r[0], "almacen_365": r[1],
                        "stock_fisico": formatear_moneda(r[2]),
                        "disponible_venta": formatear_moneda(r[3]),
                        "disponible_entrega": formatear_moneda(r[4]),
                        "comprometido": formatear_moneda(r[5]),
                    }
                else:
                    to_row = lambda r: {
                        "codigo": r[0], "almacen_365": r[1],
                        "stock_fisico": float(r[2]) if r[2] is not None else None,
                        "disponible_venta": float(r[3]) if r[3] is not None else None,
                        "disponible_entrega": float(r[4]) if r[4] is not None else None,
                        "comprometido": float(r[5]) if r[5] is not None else None,
                    }
                stock_data = [to_row(r) for r in rows]
                logger.info(f"Se obtuvieron {len(stock_data)} registros de stock.")
                return stock_data
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error al obtener stock tras {MAX_RETRIES} intentos: {e}")
                return []
            except sqlite3.Error as e:
                logger.error(f"Error inesperado al obtener stock de la base de datos: {e}")
                return []

def obtener_grupos_cumplimiento(store):
    for attempt in range(MAX_RETRIES):
        with conectar_db("grupos_cumplimiento") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("SELECT invent_location_id FROM grupos_cumplimiento WHERE store_locator_group_name = ?", (store,))
                almacenes_asignados = [row[0] for row in cursor.fetchall()]
                logger.info(f"Se obtuvieron {len(almacenes_asignados)} almacenes para la tienda {store}.")
                return almacenes_asignados
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error al obtener grupos tras {MAX_RETRIES} intentos: {e}")
                return []
            except sqlite3.Error as e:
                logger.error(f"Error inesperado al obtener grupos de cumplimiento: {e}")
                return []

def agregar_stock_masivo(lista_stock):
    if not lista_stock:
        logger.info("Lista de stock vacía, no se insertó nada.")
        return 0
    for attempt in range(MAX_RETRIES):
        with conectar_db("stock") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("BEGIN TRANSACTION;")
                cursor.executemany("""
                    INSERT INTO stock (codigo, almacen_365, stock_fisico, disponible_venta, disponible_entrega, comprometido)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(codigo, almacen_365) DO UPDATE SET
                        stock_fisico=excluded.stock_fisico,
                        disponible_venta=excluded.disponible_venta,
                        disponible_entrega=excluded.disponible_entrega,
                        comprometido=excluded.comprometido;
                """, lista_stock)
                conexion.commit()
                logger.info(f"Se insertaron/actualizaron {len(lista_stock)} registros de stock.")
                return len(lista_stock)
            except sqlite3.OperationalError as e:
                conexion.rollback()
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error en inserción de stock tras {MAX_RETRIES} intentos: {e}")
                return 0
            except sqlite3.Error as e:
                conexion.rollback()
                logger.error(f"Error inesperado en inserción de stock: {e}")
                return 0

def agregar_grupos_cumplimiento_masivo(lista_grupos):
    if not lista_grupos:
        logger.info("Lista de grupos de cumplimiento vacía, no se insertó nada.")
        return 0
    for attempt in range(MAX_RETRIES):
        with conectar_db("grupos_cumplimiento") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("BEGIN TRANSACTION;")
                cursor.executemany("""
                    INSERT INTO grupos_cumplimiento (store_locator_group_name, invent_location_id)
                    VALUES (?, ?)
                    ON CONFLICT(store_locator_group_name, invent_location_id) DO UPDATE SET
                        store_locator_group_name=excluded.store_locator_group_name,
                        invent_location_id=excluded.invent_location_id;
                """, lista_grupos)
                conexion.commit()
                logger.info(f"Se insertaron/actualizaron {len(lista_grupos)} registros en `grupos_cumplimiento`.")
                return len(lista_grupos)
            except sqlite3.OperationalError as e:
                conexion.rollback()
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error en inserción de grupos tras {MAX_RETRIES} intentos: {e}")
                return 0
            except sqlite3.Error as e:
                conexion.rollback()
                logger.error(f"Error inesperado en inserción/actualización de grupos: {e}")
                return 0

def agregar_empleados_masivo(lista_empleados):
    if not lista_empleados:
        logger.info("Lista de empleados vacía, no se insertó nada.")
        return 0
    dedup = {}
    for emp in lista_empleados:
        email = emp[2]
        if email not in dedup:
            dedup[email] = emp
    lista_empleados_unicos = list(dedup.values())
    if not lista_empleados_unicos:
        logger.warning("Todos los empleados tienen emails duplicados, no se insertó nada.")
        return 0
    for attempt in range(MAX_RETRIES):
        with conectar_db("empleados") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("PRAGMA synchronous = OFF;")
                cursor.execute("BEGIN TRANSACTION;")
                cursor.executemany("""
                    INSERT INTO empleados (empleado_d365, id_puesto, email, nombre_completo, numero_sap)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(email) DO UPDATE SET
                        empleado_d365=excluded.empleado_d365,
                        id_puesto=excluded.id_puesto,
                        nombre_completo=excluded.nombre_completo,
                        numero_sap=excluded.numero_sap;
                """, lista_empleados_unicos)
                conexion.commit()
                logger.info(f"Se insertaron/actualizaron {len(lista_empleados_unicos)} empleados en SQLite.")
                return len(lista_empleados_unicos)
            except sqlite3.OperationalError as e:
                conexion.rollback()
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error en inserción masiva de empleados tras {MAX_RETRIES} intentos: {e}")
                return 0
            except sqlite3.Error as e:
                conexion.rollback()
                logger.error(f"Error inesperado en inserción masiva de empleados: {e}")
                return 0

def obtener_empleados():
    for attempt in range(MAX_RETRIES):
        with conectar_db("empleados") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("""
                    SELECT empleado_d365, id_puesto, email, nombre_completo, numero_sap
                    FROM empleados
                """)
                filas = cursor.fetchall()
                if not filas:
                    logger.warning("No se encontraron empleados en la base de datos.")
                    return []
                claves = ["empleado_d365", "id_puesto", "email", "nombre_completo", "numero_sap"]
                empleados = [dict(zip(claves, fila)) for fila in filas]
                logger.info(f"Se obtuvieron {len(empleados)} empleados.")
                return empleados
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error al obtener empleados tras {MAX_RETRIES} intentos: {e}")
                return []
            except sqlite3.Error as e:
                logger.error(f"Error inesperado al obtener empleados: {e}")
                return []

def obtener_empleados_by_email(email):
    for attempt in range(MAX_RETRIES):
        with conectar_db("empleados") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("""
                    SELECT empleado_d365, id_puesto, email, nombre_completo, numero_sap, last_store
                    FROM empleados WHERE email = ?
                """, (email,))
                filas = cursor.fetchall()
                if not filas:
                    logger.warning(f"No se encontraron empleados con el email {email}.")
                    return {}
                claves = ["empleado_d365", "id_puesto", "email", "nombre_completo", "numero_sap", "last_store"]
                empleado = dict(zip(claves, filas[0]))
                logger.info(f"Se obtuvo un empleado con email {email}.")
                return empleado
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error al obtener empleado tras {MAX_RETRIES} intentos: {e}")
                return {}
            except sqlite3.Error as e:
                logger.error(f"Error inesperado al obtener empleado con email {email}: {e}")
                return {}

def obtener_todos_atributos():
    for attempt in range(MAX_RETRIES):
        with conectar_db("atributos") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("""
                    SELECT product_number, product_name, attribute_name, attribute_value
                    FROM atributos
                """)
                filas = cursor.fetchall()
                if not filas:
                    logger.warning("No se encontraron atributos en la base de datos.")
                    return []
                atributos = [{"ProductNumber": row[0], "ProductName": row[1], "AttributeName": row[2], "AttributeValue": row[3]}
                             for row in filas]
                logger.info(f"Se obtuvieron {len(atributos)} atributos en una sola consulta.")
                return atributos
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error al obtener atributos tras {MAX_RETRIES} intentos: {e}")
                return []
            except sqlite3.Error as e:
                logger.error(f"Error inesperado al obtener todos los atributos: {e}")
                return []

def agregar_datos_tienda_masivo(lista_tiendas):
    if not lista_tiendas:
        logger.warning("Lista de tiendas vacía, no se insertó nada.")
        return 0
    for attempt in range(MAX_RETRIES):
        with conectar_db("store_data") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("PRAGMA synchronous = OFF;")
                cursor.execute("BEGIN TRANSACTION;")
                cursor.execute("DELETE FROM store_data;")
                query = """
                    INSERT INTO store_data (
                        almacen_retiro, sitio_almacen_retiro, id_tienda, id_unidad_operativa, 
                        nombre_tienda, almacen_envio, sitio_almacen_envio, direccion_unidad_operativa, 
                        direccion_completa_unidad_operativa
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id_tienda) DO UPDATE SET
                        almacen_retiro=excluded.almacen_retiro,
                        sitio_almacen_retiro=excluded.sitio_almacen_retiro,
                        id_unidad_operativa=excluded.id_unidad_operativa,
                        nombre_tienda=excluded.nombre_tienda,
                        almacen_envio=excluded.almacen_envio,
                        sitio_almacen_envio=excluded.sitio_almacen_envio,
                        direccion_unidad_operativa=excluded.direccion_unidad_operativa,
                        direccion_completa_unidad_operativa=excluded.direccion_completa_unidad_operativa;
                """
                cursor.executemany(query, lista_tiendas)
                conexion.commit()
                logger.info(f"Se insertaron/actualizaron {len(lista_tiendas)} registros de tiendas en SQLite.")
                return len(lista_tiendas)
            except sqlite3.OperationalError as e:
                conexion.rollback()
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error en inserción masiva de tiendas tras {MAX_RETRIES} intentos: {e}")
                return 0
            except sqlite3.Error as e:
                conexion.rollback()
                logger.error(f"Error inesperado en inserción masiva de datos de tiendas: {e}")
                return 0

def limpiar_direccion(direccion):
    if not direccion:
        return ""
    if direccion.startswith("Unimaco S.A. -"):
        direccion = direccion.replace("Unimaco S.A. -", "", 1).strip()
    elif direccion.startswith("Unimaco S.A."):
        direccion = direccion.replace("Unimaco S.A.", "", 1).strip()
    if direccion.endswith("%1"):
        direccion = direccion[:-2].strip()
    return direccion

def obtener_datos_tienda_por_id(id_tienda):
    for attempt in range(MAX_RETRIES):
        with conectar_db("store_data") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("""
                    SELECT 
                        almacen_retiro, sitio_almacen_retiro, id_tienda, id_unidad_operativa, 
                        nombre_tienda, almacen_envio, sitio_almacen_envio, direccion_unidad_operativa, 
                        direccion_completa_unidad_operativa
                    FROM store_data WHERE id_tienda = ?
                """, (id_tienda,))
                tienda = cursor.fetchone()
                if tienda:
                    claves = ["almacen_retiro", "sitio_almacen_retiro", "id_tienda", "id_unidad_operativa",
                              "nombre_tienda", "almacen_envio", "sitio_almacen_envio", "direccion_unidad_operativa",
                              "direccion_completa_unidad_operativa"]
                    resultado = dict(zip(claves, tienda))
                    resultado["direccion_completa_unidad_operativa"] = limpiar_direccion(resultado["direccion_completa_unidad_operativa"])
                    logger.info(f"Se encontraron datos para la tienda con id_tienda {id_tienda}.")
                    return resultado
                logger.warning(f"No se encontraron datos para la tienda con id_tienda {id_tienda}.")
                return {}
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error al obtener tienda tras {MAX_RETRIES} intentos: {e}")
                return {}
            except sqlite3.Error as e:
                logger.error(f"Error inesperado al obtener datos de la tienda con id_tienda {id_tienda}: {e}")
                return {}

def actualizar_last_store(email, store_id):
    for attempt in range(MAX_RETRIES):
        with conectar_db("empleados") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("BEGIN TRANSACTION;")
                cursor.execute("UPDATE empleados SET last_store = ? WHERE email = ?", (store_id, email))
                if cursor.rowcount == 0:
                    logger.warning(f"No se encontró empleado con email {email} para actualizar last_store.")
                conexion.commit()
                logger.info(f"Last_store actualizado a {store_id} para el empleado con email {email}.")
                return
            except sqlite3.OperationalError as e:
                conexion.rollback()
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error al actualizar last_store tras {MAX_RETRIES} intentos: {e}")
                raise
            except sqlite3.Error as e:
                conexion.rollback()
                logger.error(f"Error inesperado al actualizar last_store para {email}: {e}")
                raise

def obtener_contador_pdf():
    for attempt in range(MAX_RETRIES):
        with conectar_db("misc") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("BEGIN TRANSACTION;")
                cursor.execute("SELECT contador_pdf FROM misc WHERE id = 1")
                contador = cursor.fetchone()
                nuevo_contador = int(contador[0]) + 1 if contador and contador[0] else 1
                cursor.execute("SELECT COUNT(*) FROM misc WHERE id = 1")
                exists = cursor.fetchone()[0] > 0
                if exists:
                    cursor.execute("UPDATE misc SET contador_pdf = ? WHERE id = 1", (str(nuevo_contador),))
                else:
                    cursor.execute("INSERT INTO misc (id, token_d365, contador, contador_pdf) VALUES (1, NULL, NULL, ?)", (str(nuevo_contador),))
                conexion.commit()
                logger.info(f"Contador de PDFs actualizado: {nuevo_contador}")
                return nuevo_contador
            except sqlite3.OperationalError as e:
                conexion.rollback()
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error al actualizar contador_pdf tras {MAX_RETRIES} intentos: {e}")
                raise
            except sqlite3.Error as e:
                conexion.rollback()
                logger.error(f"Error inesperado al obtener/incrementar contador_pdf: {e}")
                raise

def save_cart(user_id, cart, timestamp):
    """Guarda o actualiza el carrito de un usuario en la tabla carts."""
    for attempt in range(MAX_RETRIES):
        with conectar_db("misc") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("BEGIN TRANSACTION;")
                cart_json = json.dumps(cart, ensure_ascii=False)
                cursor.execute("""
                    INSERT INTO carts (user_id, cart_json, timestamp)
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        cart_json = excluded.cart_json,
                        timestamp = excluded.timestamp;
                """, (user_id, cart_json, timestamp))
                conexion.commit()
                logger.info(f"Carrito guardado para user_id {user_id} con timestamp {timestamp}")
                return True
            except sqlite3.OperationalError as e:
                conexion.rollback()
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error al guardar carrito tras {MAX_RETRIES} intentos: {e}")
                return False
            except sqlite3.Error as e:
                conexion.rollback()
                logger.error(f"Error inesperado al guardar carrito: {e}")
                return False

def get_cart(user_id):
    for attempt in range(MAX_RETRIES):
        with conectar_db("misc") as conexion:
            cursor = conexion.cursor()
            try:
                cursor.execute("""
                    SELECT cart_json, timestamp
                    FROM carts WHERE user_id = ?
                """, (user_id,))
                result = cursor.fetchone()
                if result:
                    cart = json.loads(result[0])
                    timestamp = result[1]
                    logger.info(f"Carrito recuperado para user_id {user_id} con timestamp {timestamp}")
                    return {"cart": cart, "timestamp": timestamp}
                logger.info(f"No se encontró carrito para user_id {user_id}")
                return {"cart": {"items": [], "client": None, "quotation_id": None, "type": "new", "observations": ""}, "timestamp": None}
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e) and attempt < MAX_RETRIES - 1:
                    logger.warning(f"Base de datos bloqueada, reintentando ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"Error al recuperar carrito tras {MAX_RETRIES} intentos: {e}")
                return {"cart": {"items": [], "client": None, "quotation_id": None, "type": "new", "observations": ""}, "timestamp": None}
            except sqlite3.Error as e:
                logger.error(f"Error inesperado al recuperar carrito: {e}")
                return {"cart": {"items": [], "client": None, "quotation_id": None, "type": "new", "observations": ""}, "timestamp": None}
