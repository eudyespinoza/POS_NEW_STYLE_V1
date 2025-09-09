import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional

from django.conf import settings


def _db_path() -> str:
    # Usa la db.sqlite3 de ESTE proyecto (settings.DATABASES)
    try:
        name = settings.DATABASES["default"]["NAME"]
        if name:
            return name
    except Exception:
        pass
    return "db.sqlite3"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    """Crea tablas mínimas si no existen para permitir administrar configuración.
    Nota: si ya existen (por haber importado desde V5), no modifica nada.
    """
    cur = conn.cursor()
    # BancosArgentina
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS BancosArgentina (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            CodigoEntidad TEXT,
            Denominacion TEXT,
            NombreComercial TEXT,
            Estado INTEGER
        )
        """
    )
    # RetailTenderType
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS RetailTenderType (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            PaymentMethodNumber TEXT,
            Name TEXT,
            DefaultFunction TEXT,
            Estado INTEGER
        )
        """
    )
    # Acquirer
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS Acquirer (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            Code TEXT,
            Name TEXT,
            Estado INTEGER
        )
        """
    )
    # RetailCardType
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS RetailCardType (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            Brand TEXT,
            CardTypeId TEXT,
            Banco_id INTEGER,
            Acquirer_id INTEGER,
            Estado INTEGER
        )
        """
    )
    # RetailTenderDiscount
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS RetailTenderDiscount (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            TenderType_id INTEGER,
            CardType_id INTEGER,
            Porcentaje REAL,
            ValidFrom TEXT,
            ValidTo TEXT,
            Estado INTEGER
        )
        """
    )
    # FinancingPlanHeader
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS FinancingPlanHeader (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            Codigo TEXT,
            Nombre TEXT,
            Metodo_id INTEGER,
            VigenciaDesde TEXT,
            VigenciaHasta TEXT,
            Estado INTEGER
        )
        """
    )
    # FinancingPlanRate
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS FinancingPlanRate (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            Plan_id INTEGER,
            Cuotas INTEGER,
            Coeficiente REAL
        )
        """
    )
    conn.commit()


def _find_table(conn: sqlite3.Connection, suffix: str) -> Optional[str]:
    # Busca tabla por sufijo (case-insensitive), p.ej. 'retailtendertype'
    cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    for row in cur.fetchall():
        name = row["name"]
        if name.lower().endswith(suffix.lower()):
            return name
    return None


def masters() -> Dict[str, Any]:
    """Devuelve métodos, marcas, bancos, adquirentes y vat_rate.
    Se adapta a las tablas si existen; caso contrario, listas vacías.
    """
    data = {"methods": [], "brands": [], "banks": [], "acquirers": [], "vat_rate": "0.21"}
    with _connect() as conn:
        _ensure_schema(conn)
        # Métodos de pago
        tt = _find_table(conn, "retailtendertype")
        if tt:
            q = f"SELECT PaymentMethodNumber AS code, Name AS name, COALESCE(DefaultFunction,'') AS function FROM {tt} ORDER BY Name"
            for r in conn.execute(q):
                data["methods"].append({"code": str(r["code"]), "name": r["name"], "function": r["function"]})

        # Marcas de tarjetas
        ct = _find_table(conn, "retailcardtype")
        if ct:
            q = f"SELECT DISTINCT TRIM(Brand) AS brand FROM {ct} WHERE COALESCE(Estado,1)=1 AND TRIM(Brand)<>'' ORDER BY Brand"
            data["brands"] = [row["brand"] for row in conn.execute(q) if row["brand"]]

        # Bancos
        bt = _find_table(conn, "bancosargentina")
        if bt:
            q = (
                f"SELECT CodigoEntidad AS code, COALESCE(NombreComercial, Denominacion,'') AS name "
                f"FROM {bt} WHERE COALESCE(Estado,1)=1 ORDER BY name"
            )
            data["banks"] = [{"code": str(r["code"]), "name": r["name"]} for r in conn.execute(q)]

        # Adquirentes
        aq = _find_table(conn, "acquirer")
        if aq:
            q = f"SELECT Code AS code, Name AS name FROM {aq} WHERE COALESCE(Estado,1)=1 ORDER BY Name"
            data["acquirers"] = [{"code": r["code"], "name": r["name"]} for r in conn.execute(q)]

    try:
        from services.tax import default_vat_rate

        data["vat_rate"] = str(default_vat_rate())
    except Exception:
        pass

    return data


# ==== Utilidades CRUD para pantallas de configuración ====
def bancos_list() -> List[Dict[str, Any]]:
    with _connect() as conn:
        _ensure_schema(conn)
        bt = _find_table(conn, "bancosargentina")
        if not bt:
            return []
        q = (
            f"SELECT id, CodigoEntidad AS code, Denominacion AS name, COALESCE(NombreComercial,'') AS commercial, COALESCE(Estado,1) AS enabled "
            f"FROM {bt} ORDER BY Denominacion"
        )
        return [dict(r) for r in conn.execute(q)]


def banco_get(pk: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        _ensure_schema(conn)
        bt = _find_table(conn, "bancosargentina")
        if not bt:
            return None
        r = conn.execute(f"SELECT id, CodigoEntidad AS code, Denominacion AS name, COALESCE(NombreComercial,'') AS commercial, COALESCE(Estado,1) AS enabled FROM {bt} WHERE id=?", (pk,)).fetchone()
        return dict(r) if r else None


def banco_create(code: str, name: str, commercial: str, enabled: bool) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        bt = _find_table(conn, "bancosargentina")
        if not bt:
            raise RuntimeError("Tabla BancosArgentina no encontrada")
        conn.execute(
            f"INSERT INTO {bt} (CodigoEntidad, Denominacion, NombreComercial, Estado) VALUES (?,?,?,?)",
            (code, name, commercial, 1 if enabled else 0),
        )
        conn.commit()


def banco_update(pk: str, code: str, name: str, commercial: str, enabled: bool) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        bt = _find_table(conn, "bancosargentina")
        if not bt:
            raise RuntimeError("Tabla BancosArgentina no encontrada")
        conn.execute(
            f"UPDATE {bt} SET CodigoEntidad=?, Denominacion=?, NombreComercial=?, Estado=? WHERE id=?",
            (code, name, commercial, 1 if enabled else 0, pk),
        )
        conn.commit()


def banco_toggle(pk: str) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        bt = _find_table(conn, "bancosargentina")
        if not bt:
            raise RuntimeError("Tabla BancosArgentina no encontrada")
        cur = conn.execute(f"SELECT COALESCE(Estado,1) AS enabled FROM {bt} WHERE id=?", (pk,)).fetchone()
        val = 0 if (cur and cur["enabled"]) else 1
        conn.execute(f"UPDATE {bt} SET Estado=? WHERE id=?", (val, pk))
        conn.commit()


def banco_delete(pk: str) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        bt = _find_table(conn, "bancosargentina")
        if not bt:
            raise RuntimeError("Tabla BancosArgentina no encontrada")
        conn.execute(f"DELETE FROM {bt} WHERE id=?", (pk,))
        conn.commit()


# Métodos de pago (RetailTenderType)
def methods_list() -> List[Dict[str, Any]]:
    with _connect() as conn:
        _ensure_schema(conn)
        tt = _find_table(conn, "retailtendertype")
        if not tt:
            return []
        q = f"SELECT id, PaymentMethodNumber AS code, Name AS name, COALESCE(DefaultFunction,'') AS function, COALESCE(Estado,1) AS enabled FROM {tt} ORDER BY Name"
        return [dict(r) for r in conn.execute(q)]


def method_get(pk: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        _ensure_schema(conn)
        tt = _find_table(conn, "retailtendertype")
        if not tt:
            return None
        r = conn.execute(
            f"SELECT id, PaymentMethodNumber AS code, Name AS name, COALESCE(DefaultFunction,'') AS function, COALESCE(Estado,1) AS enabled FROM {tt} WHERE id=?",
            (pk,),
        ).fetchone()
        return dict(r) if r else None


def method_create(code: str, name: str, function: str, enabled: bool) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        tt = _find_table(conn, "retailtendertype")
        if not tt:
            raise RuntimeError("Tabla RetailTenderType no encontrada")
        conn.execute(
            f"INSERT INTO {tt} (PaymentMethodNumber, Name, DefaultFunction, Estado) VALUES (?,?,?,?)",
            (code, name, function, 1 if enabled else 0),
        )
        conn.commit()


def method_update(pk: str, code: str, name: str, function: str, enabled: bool) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        tt = _find_table(conn, "retailtendertype")
        if not tt:
            raise RuntimeError("Tabla RetailTenderType no encontrada")
        conn.execute(
            f"UPDATE {tt} SET PaymentMethodNumber=?, Name=?, DefaultFunction=?, Estado=? WHERE id=?",
            (code, name, function, 1 if enabled else 0, pk),
        )
        conn.commit()


def method_toggle(pk: str) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        tt = _find_table(conn, "retailtendertype")
        if not tt:
            raise RuntimeError("Tabla RetailTenderType no encontrada")
        cur = conn.execute(f"SELECT COALESCE(Estado,1) AS enabled FROM {tt} WHERE id=?", (pk,)).fetchone()
        val = 0 if (cur and cur["enabled"]) else 1
        conn.execute(f"UPDATE {tt} SET Estado=? WHERE id=?", (val, pk))
        conn.commit()


def method_delete(pk: str) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        tt = _find_table(conn, "retailtendertype")
        if not tt:
            raise RuntimeError("Tabla RetailTenderType no encontrada")
        conn.execute(f"DELETE FROM {tt} WHERE id=?", (pk,))
        conn.commit()


# Adquirentes (Acquirer)
def acquirers_list() -> List[Dict[str, Any]]:
    with _connect() as conn:
        _ensure_schema(conn)
        aq = _find_table(conn, "acquirer")
        if not aq:
            return []
        q = f"SELECT id, Code AS code, Name AS name, COALESCE(Estado,1) AS enabled FROM {aq} ORDER BY Name"
        return [dict(r) for r in conn.execute(q)]


def acquirer_get(pk: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        _ensure_schema(conn)
        aq = _find_table(conn, "acquirer")
        if not aq:
            return None
        r = conn.execute(f"SELECT id, Code AS code, Name AS name, COALESCE(Estado,1) AS enabled FROM {aq} WHERE id=?", (pk,)).fetchone()
        return dict(r) if r else None


def acquirer_create(code: str, name: str, enabled: bool) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        aq = _find_table(conn, "acquirer")
        if not aq:
            raise RuntimeError("Tabla Acquirer no encontrada")
        conn.execute(f"INSERT INTO {aq} (Code, Name, Estado) VALUES (?,?,?)", (code, name, 1 if enabled else 0))
        conn.commit()


def acquirer_update(pk: str, code: str, name: str, enabled: bool) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        aq = _find_table(conn, "acquirer")
        if not aq:
            raise RuntimeError("Tabla Acquirer no encontrada")
        conn.execute(f"UPDATE {aq} SET Code=?, Name=?, Estado=? WHERE id=?", (code, name, 1 if enabled else 0, pk))
        conn.commit()


def acquirer_toggle(pk: str) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        aq = _find_table(conn, "acquirer")
        if not aq:
            raise RuntimeError("Tabla Acquirer no encontrada")
        cur = conn.execute(f"SELECT COALESCE(Estado,1) AS enabled FROM {aq} WHERE id=?", (pk,)).fetchone()
        val = 0 if (cur and cur["enabled"]) else 1
        conn.execute(f"UPDATE {aq} SET Estado=? WHERE id=?", (val, pk))
        conn.commit()


def acquirer_delete(pk: str) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        aq = _find_table(conn, "acquirer")
        if not aq:
            raise RuntimeError("Tabla Acquirer no encontrada")
        conn.execute(f"DELETE FROM {aq} WHERE id=?", (pk,))
        conn.commit()


# Tarjetas (RetailCardType)
def cards_list() -> List[Dict[str, Any]]:
    with _connect() as conn:
        _ensure_schema(conn)
        ct = _find_table(conn, "retailcardtype")
        if not ct:
            return []
        bt = _find_table(conn, "bancosargentina")
        aq = _find_table(conn, "acquirer")
        join_b = f"LEFT JOIN {bt} b ON b.id = c.Banco_id" if bt else ""
        join_a = f"LEFT JOIN {aq} a ON a.id = c.Acquirer_id" if aq else ""
        cols_b = ", b.CodigoEntidad AS bank_code, b.Denominacion AS bank_name" if bt else ", '' AS bank_code, '' AS bank_name"
        cols_a = ", a.Code AS acquirer_code, a.Name AS acquirer_name" if aq else ", '' AS acquirer_code, '' AS acquirer_name"
        q = (
            f"SELECT c.id, COALESCE(c.Brand,'') AS brand, COALESCE(c.CardTypeId,'') AS card_code, COALESCE(c.Estado,1) AS enabled, "
            f"COALESCE(c.Banco_id,'') AS bank_id, COALESCE(c.Acquirer_id,'') AS acquirer_id{cols_b}{cols_a} "
            f"FROM {ct} c {join_b} {join_a} ORDER BY brand"
        )
        return [dict(r) for r in conn.execute(q)]


def card_get(pk: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        _ensure_schema(conn)
        ct = _find_table(conn, "retailcardtype")
        if not ct:
            return None
        r = conn.execute(
            f"SELECT id, COALESCE(Brand,'') AS brand, COALESCE(CardTypeId,'') AS card_code, COALESCE(Banco_id,'') AS bank_id, COALESCE(Acquirer_id,'') AS acquirer_id, COALESCE(Estado,1) AS enabled FROM {ct} WHERE id=?",
            (pk,),
        ).fetchone()
        return dict(r) if r else None


def card_create(brand: str, card_code: str, bank_id: Optional[str], acquirer_id: Optional[str], enabled: bool) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        ct = _find_table(conn, "retailcardtype")
        if not ct:
            raise RuntimeError("Tabla RetailCardType no encontrada")
        conn.execute(
            f"INSERT INTO {ct} (Brand, CardTypeId, Banco_id, Acquirer_id, Estado) VALUES (?,?,?,?,?)",
            (brand, card_code, bank_id or None, acquirer_id or None, 1 if enabled else 0),
        )
        conn.commit()


def card_update(pk: str, brand: str, card_code: str, bank_id: Optional[str], acquirer_id: Optional[str], enabled: bool) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        ct = _find_table(conn, "retailcardtype")
        if not ct:
            raise RuntimeError("Tabla RetailCardType no encontrada")
        conn.execute(
            f"UPDATE {ct} SET Brand=?, CardTypeId=?, Banco_id=?, Acquirer_id=?, Estado=? WHERE id=?",
            (brand, card_code, bank_id or None, acquirer_id or None, 1 if enabled else 0, pk),
        )
        conn.commit()


def card_toggle(pk: str) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        ct = _find_table(conn, "retailcardtype")
        if not ct:
            raise RuntimeError("Tabla RetailCardType no encontrada")
        cur = conn.execute(f"SELECT COALESCE(Estado,1) AS enabled FROM {ct} WHERE id=?", (pk,)).fetchone()
        val = 0 if (cur and cur["enabled"]) else 1
        conn.execute(f"UPDATE {ct} SET Estado=? WHERE id=?", (val, pk))
        conn.commit()


def card_delete(pk: str) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        ct = _find_table(conn, "retailcardtype")
        if not ct:
            raise RuntimeError("Tabla RetailCardType no encontrada")
        conn.execute(f"DELETE FROM {ct} WHERE id=?", (pk,))
        conn.commit()


# Descuentos (RetailTenderDiscount)
def discounts_admin_list() -> List[Dict[str, Any]]:
    with _connect() as conn:
        _ensure_schema(conn)
        dt = _find_table(conn, "retailtenderdiscount")
        if not dt:
            return []
        tt = _find_table(conn, "retailtendertype")
        ct = _find_table(conn, "retailcardtype")
        join_t = f"LEFT JOIN {tt} t ON t.id = d.TenderType_id" if tt else ""
        join_c = f"LEFT JOIN {ct} c ON c.id = d.CardType_id" if ct else ""
        cols_t = ", t.Name AS method_name, t.PaymentMethodNumber AS method_code" if tt else ", '' AS method_name, '' AS method_code"
        cols_c = ", c.Brand AS brand" if ct else ", '' AS brand"
        q = (
            f"SELECT d.id, COALESCE(d.Porcentaje,0) AS pct, COALESCE(d.Estado,1) AS enabled, d.ValidFrom, d.ValidTo, d.TenderType_id AS method_id, d.CardType_id AS card_id"
            f"{cols_t}{cols_c} FROM {dt} d {join_t} {join_c} ORDER BY d.id DESC"
        )
        return [dict(r) for r in conn.execute(q)]


def discount_get(pk: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        _ensure_schema(conn)
        dt = _find_table(conn, "retailtenderdiscount")
        if not dt:
            return None
        r = conn.execute(
            f"SELECT id, Porcentaje AS pct, COALESCE(Estado,1) AS enabled, ValidFrom, ValidTo, TenderType_id AS method_id, CardType_id AS card_id FROM {dt} WHERE id=?",
            (pk,),
        ).fetchone()
        return dict(r) if r else None


def discount_create(method_id: str, card_id: Optional[str], pct: float, valid_from: Optional[str], valid_to: Optional[str], enabled: bool) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        dt = _find_table(conn, "retailtenderdiscount")
        if not dt:
            raise RuntimeError("Tabla RetailTenderDiscount no encontrada")
        conn.execute(
            f"INSERT INTO {dt} (TenderType_id, CardType_id, Porcentaje, ValidFrom, ValidTo, Estado) VALUES (?,?,?,?,?,?)",
            (method_id, card_id or None, pct, valid_from or None, valid_to or None, 1 if enabled else 0),
        )
        conn.commit()


def discount_update(pk: str, method_id: str, card_id: Optional[str], pct: float, valid_from: Optional[str], valid_to: Optional[str], enabled: bool) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        dt = _find_table(conn, "retailtenderdiscount")
        if not dt:
            raise RuntimeError("Tabla RetailTenderDiscount no encontrada")
        conn.execute(
            f"UPDATE {dt} SET TenderType_id=?, CardType_id=?, Porcentaje=?, ValidFrom=?, ValidTo=?, Estado=? WHERE id=?",
            (method_id, card_id or None, pct, valid_from or None, valid_to or None, 1 if enabled else 0, pk),
        )
        conn.commit()


def discount_toggle(pk: str) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        dt = _find_table(conn, "retailtenderdiscount")
        if not dt:
            raise RuntimeError("Tabla RetailTenderDiscount no encontrada")
        cur = conn.execute(f"SELECT COALESCE(Estado,1) AS enabled FROM {dt} WHERE id=?", (pk,)).fetchone()
        val = 0 if (cur and cur["enabled"]) else 1
        conn.execute(f"UPDATE {dt} SET Estado=? WHERE id=?", (val, pk))
        conn.commit()


def discount_delete(pk: str) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        dt = _find_table(conn, "retailtenderdiscount")
        if not dt:
            raise RuntimeError("Tabla RetailTenderDiscount no encontrada")
        conn.execute(f"DELETE FROM {dt} WHERE id=?", (pk,))
        conn.commit()


# Planes (FinancingPlanHeader + FinancingPlanRate)
def plans_headers_list_admin() -> List[Dict[str, Any]]:
    with _connect() as conn:
        _ensure_schema(conn)
        hd = _find_table(conn, "financingplanheader")
        if not hd:
            return []
        tt = _find_table(conn, "retailtendertype")
        join_t = f"LEFT JOIN {tt} t ON t.id = h.Metodo_id" if tt else ""
        cols_t = ", t.Name AS method_name, t.PaymentMethodNumber AS method_code" if tt else ", '' AS method_name, '' AS method_code"
        q = (
            f"SELECT h.id, h.Codigo AS code, h.Nombre AS name, h.VigenciaDesde, h.VigenciaHasta, COALESCE(h.Estado,1) AS enabled, h.Metodo_id AS method_id{cols_t} "
            f"FROM {hd} h {join_t} ORDER BY h.Codigo"
        )
        return [dict(r) for r in conn.execute(q)]


def plan_header_get(pk: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        _ensure_schema(conn)
        hd = _find_table(conn, "financingplanheader")
        if not hd:
            return None
        r = conn.execute(
            f"SELECT id, Codigo AS code, Nombre AS name, VigenciaDesde, VigenciaHasta, COALESCE(Estado,1) AS enabled, Metodo_id AS method_id FROM {hd} WHERE id=?",
            (pk,),
        ).fetchone()
        return dict(r) if r else None


def plan_header_create(code: str, name: str, method_id: Optional[str], vd: Optional[str], vh: Optional[str], enabled: bool) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        hd = _find_table(conn, "financingplanheader")
        if not hd:
            raise RuntimeError("Tabla FinancingPlanHeader no encontrada")
        conn.execute(
            f"INSERT INTO {hd} (Codigo, Nombre, Metodo_id, VigenciaDesde, VigenciaHasta, Estado) VALUES (?,?,?,?,?,?)",
            (code, name, method_id or None, vd or None, vh or None, 1 if enabled else 0),
        )
        conn.commit()


def plan_header_update(pk: str, code: str, name: str, method_id: Optional[str], vd: Optional[str], vh: Optional[str], enabled: bool) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        hd = _find_table(conn, "financingplanheader")
        if not hd:
            raise RuntimeError("Tabla FinancingPlanHeader no encontrada")
        conn.execute(
            f"UPDATE {hd} SET Codigo=?, Nombre=?, Metodo_id=?, VigenciaDesde=?, VigenciaHasta=?, Estado=? WHERE id=?",
            (code, name, method_id or None, vd or None, vh or None, 1 if enabled else 0, pk),
        )
        conn.commit()


def plan_header_toggle(pk: str) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        hd = _find_table(conn, "financingplanheader")
        if not hd:
            raise RuntimeError("Tabla FinancingPlanHeader no encontrada")
        cur = conn.execute(f"SELECT COALESCE(Estado,1) AS enabled FROM {hd} WHERE id=?", (pk,)).fetchone()
        val = 0 if (cur and cur["enabled"]) else 1
        conn.execute(f"UPDATE {hd} SET Estado=? WHERE id=?", (val, pk))
        conn.commit()


def plan_header_delete(pk: str) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        hd = _find_table(conn, "financingplanheader")
        if not hd:
            raise RuntimeError("Tabla FinancingPlanHeader no encontrada")
        conn.execute(f"DELETE FROM {hd} WHERE id=?", (pk,))
        conn.commit()


def plan_rates_list(plan_id: str) -> List[Dict[str, Any]]:
    with _connect() as conn:
        _ensure_schema(conn)
        rt = _find_table(conn, "financingplanrate")
        if not rt:
            return []
        q = f"SELECT id, COALESCE(Cuotas,1) AS fees, COALESCE(Coeficiente,1) AS coef FROM {rt} WHERE Plan_id=? ORDER BY fees"
        return [dict(r) for r in conn.execute(q, (plan_id,))]


def plan_rate_get(pk: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        _ensure_schema(conn)
        rt = _find_table(conn, "financingplanrate")
        if not rt:
            return None
        r = conn.execute(f"SELECT id, COALESCE(Cuotas,1) AS fees, COALESCE(Coeficiente,1) AS coef, Plan_id AS plan_id FROM {rt} WHERE id=?", (pk,)).fetchone()
        return dict(r) if r else None


def plan_rate_create(plan_id: str, fees: int, coef: float) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        rt = _find_table(conn, "financingplanrate")
        if not rt:
            raise RuntimeError("Tabla FinancingPlanRate no encontrada")
        conn.execute(f"INSERT INTO {rt} (Plan_id, Cuotas, Coeficiente) VALUES (?,?,?)", (plan_id, fees, coef))
        conn.commit()


def plan_rate_update(pk: str, fees: int, coef: float) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        rt = _find_table(conn, "financingplanrate")
        if not rt:
            raise RuntimeError("Tabla FinancingPlanRate no encontrada")
        conn.execute(f"UPDATE {rt} SET Cuotas=?, Coeficiente=? WHERE id=?", (fees, coef, pk))
        conn.commit()


def plan_rate_delete(pk: str) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        rt = _find_table(conn, "financingplanrate")
        if not rt:
            raise RuntimeError("Tabla FinancingPlanRate no encontrada")
        conn.execute(f"DELETE FROM {rt} WHERE id=?", (pk,))
        conn.commit()


def plans(method: Optional[str], brand: Optional[str], bank: Optional[str], acquirer: Optional[str], tasa1: bool) -> List[Dict[str, Any]]:
    """Devuelve planes vigentes con coeficiente y cuotas.
    Se basa en FinancingPlanRate + FinancingPlanHeader + RetailCardType si existen.
    """
    with _connect() as conn:
        rt = _find_table(conn, "financingplanrate")
        hd = _find_table(conn, "financingplanheader")
        ct = _find_table(conn, "retailcardtype")
        if not rt or not hd:
            return []

        now = datetime.utcnow().isoformat(" ")
        # Construimos JOIN condicional
        join_card = f"LEFT JOIN {ct} c ON c.id = r.Tarjeta_id" if ct else ""
        cols_card = (
            ", COALESCE(c.Brand,'') AS brand, COALESCE(c.CardTypeId,'') AS card, COALESCE(c.Acquirer_id,'') AS acq, COALESCE(c.Banco_id,'') AS bank"
            if ct
            else ", '' AS brand, '' AS card, '' AS acq, '' AS bank"
        )
        q = (
            f"SELECT r.id, h.Codigo AS code, h.Nombre AS name, COALESCE(r.Cuotas,1) AS fees, COALESCE(r.Coeficiente,1) AS coef"
            f"{cols_card} "
            f"FROM {rt} r JOIN {hd} h ON h.id = r.Plan_id {join_card} "
            f"WHERE COALESCE(r.Estado,1)=1 AND COALESCE(h.Estado,1)=1 "
            f"AND (h.VigenciaDesde IS NULL OR h.VigenciaDesde <= '{now}') "
            f"AND (h.VigenciaHasta IS NULL OR h.VigenciaHasta >= '{now}')"
        )

        filters = []
        if method:
            # h.Metodo_id puede ser numérico o FK, intentamos por codigo en header si existe
            filters.append(f"(h.Metodo_id = '{method}' OR h.Metodo_id IN (SELECT id FROM {_find_table(conn,'retailtendertype')} WHERE PaymentMethodNumber='{method}'))")
        if brand:
            filters.append("LOWER(brand) = LOWER(?)")
        if bank:
            filters.append("CAST(bank AS TEXT) = ?")
        if acquirer:
            filters.append("CAST(acq AS TEXT) = ?")
        if tasa1:
            filters.append("CAST(COALESCE(r.Coeficiente,1) AS TEXT) = '1' ")

        if filters:
            q += " AND " + " AND ".join(filters)

        q += " ORDER BY h.Codigo, r.Cuotas"
        params: List[Any] = []
        if brand:
            params.append(brand)
        if bank:
            params.append(str(bank))
        if acquirer:
            params.append(str(acquirer))

        out: List[Dict[str, Any]] = []
        for r in conn.execute(q, params):
            out.append(
                {
                    "id": str(r["id"]),
                    "code": r["code"],
                    "name": r["name"],
                    "fees": int(r["fees"] or 1),
                    "coef": str(r["coef"]),
                    "brand": r["brand"],
                    "card": r["card"],
                    "bank": str(r["bank"]),
                }
            )
        return out


def discounts(method: Optional[str], brand: Optional[str], bank: Optional[str]) -> List[Dict[str, Any]]:
    with _connect() as conn:
        dt = _find_table(conn, "retailtenderdiscount")
        if not dt:
            return []
        now = datetime.utcnow().isoformat(" ")
        q = (
            f"SELECT Porcentaje AS pct, TenderType_id AS method_id, CardType_id AS card_id FROM {dt} "
            f"WHERE COALESCE(Estado,1)=1 AND (ValidFrom IS NULL OR ValidFrom <= '{now}') AND (ValidTo IS NULL OR ValidTo >= '{now}')"
        )
        # Nota: Por compatibilidad mínima, filtramos por brand/bank si podemos join con RetailCardType
        ct = _find_table(conn, "retailcardtype")
        if ct:
            q = (
                f"SELECT d.Porcentaje AS pct, d.TenderType_id AS method_id, d.CardType_id AS card_id,"
                f" COALESCE(c.Brand,'') AS brand, COALESCE(c.Banco_id,'') AS bank "
                f"FROM {dt} d LEFT JOIN {ct} c ON c.id = d.CardType_id "
                f"WHERE COALESCE(d.Estado,1)=1 AND (d.ValidFrom IS NULL OR d.ValidFrom <= '{now}') AND (d.ValidTo IS NULL OR d.ValidTo >= '{now}')"
            )
        res: List[Dict[str, Any]] = []
        for r in conn.execute(q):
            if brand and ct and (r.get("brand") or "").lower() != (brand or "").lower():
                continue
            if bank and ct and str(r.get("bank") or "") != str(bank or ""):
                continue
            res.append({"pct": str(r["pct"] or 0)})
        return res


def simulate(cart_amount: float, lines: List[Dict[str, Any]], tasa1: bool = False) -> Dict[str, Any]:
    """Aplica descuentos y coeficientes de planes. IVA se delega a services.tax.
    Estructura compatible con el simulador V5.
    """
    from services.tax import vat_rate_for_line

    def _to_float(x: Any) -> float:
        try:
            return float(x)
        except Exception:
            return 0.0

    items = []
    subtotal_base = 0.0
    total_interest = 0.0
    change_amount = 0.0
    remaining = 0.0

    # Pre-cargamos coeficientes por plan si vienen id
    coef_by_plan: Dict[str, float] = {}
    if lines:
        # Podemos resolver coef por plan consultando la tabla
        with _connect() as conn:
            rt = _find_table(conn, "financingplanrate")
            if rt:
                ids = [l.get("plan_id") for l in lines if l.get("plan_id")]
                if ids:
                    placeholders = ",".join(["?"] * len(ids))
                    q = f"SELECT id, COALESCE(Coeficiente,1) AS coef, COALESCE(Cuotas,1) AS fees FROM {rt} WHERE id IN ({placeholders})"
                    for r in conn.execute(q, ids):
                        coef_by_plan[str(r["id"])] = float(r["coef"] or 1.0)

    for raw in lines or []:
        amount = _to_float(raw.get("amount"))
        method_code = str(raw.get("method_code") or "")
        brand = raw.get("brand")
        bank_code = raw.get("bank_code")
        plan_id = str(raw.get("plan_id") or "")

        # Descuento: tomamos el mayor pct aplicable simple (como en V5 demo)
        disc_list = discounts(method_code, brand, bank_code) or []
        disc_pct = max([_to_float(d.get("pct")) for d in disc_list] or [0.0])
        disc_amount = amount * (disc_pct / 100.0)
        net_after_disc = max(0.0, amount - disc_amount)

        # IVA por línea (configurable)
        vat_rate = vat_rate_for_line(method_code=method_code, brand=brand, bank_code=bank_code)
        vat_line = net_after_disc * vat_rate

        # Interés por plan: coeficiente
        coef = 1.0
        if plan_id and plan_id in coef_by_plan:
            coef = coef_by_plan[plan_id]
        if tasa1:
            coef = 1.0
        amount_final = net_after_disc * coef + vat_line

        items.append(
            {
                "method": method_code,
                "amount_base": round(amount, 2),
                "discounts_pct": round(disc_pct, 2),
                "discounts_amount": round(disc_amount, 2),
                "net_after_discounts": round(net_after_disc, 2),
                "vat_rate": vat_rate,
                "vat_line": round(vat_line, 2),
                "coef_applied": coef,
                "amount_final": round(amount_final, 2),
                "plan_id": plan_id or None,
            }
        )
        subtotal_base += amount
        total_interest += max(0.0, amount_final - net_after_disc - vat_line)

    total_to_charge = sum(i["amount_final"] for i in items)

    return {
        "items": items,
        "subtotal_base": round(subtotal_base, 2),
        "total_interest": round(total_interest, 2),
        "total_to_charge": round(total_to_charge, 2),
        "change_amount": round(change_amount, 2),
        "remaining": round(max(0.0, cart_amount - total_to_charge), 2),
    }
