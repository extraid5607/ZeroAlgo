import sqlite3
from datetime import datetime
from typing import List, Dict, Any, Optional
from .config import DB_PATH

def get_connection():
    return sqlite3.connect(str(DB_PATH))

def get_supported_indices() -> List[str]:
    return ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"]

def get_expiries_for_symbol(name: str) -> List[str]:
    """Return sorted available expiry dates for the underlying index/stock (today onwards)."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT DISTINCT expiry FROM symtoken WHERE name=? AND instrumenttype IN ('CE', 'PE') "
        "AND expiry IS NOT NULL AND expiry != '' ORDER BY expiry ASC",
        (name,)
    )
    rows = [r[0] for r in cur.fetchall()]
    conn.close()
    
    today = datetime.now().date()
    
    # Sort expiries chronologically
    def parse_exp(exp_str):
        try:
            return datetime.strptime(exp_str, "%d-%b-%y")
        except Exception:
            return datetime.max
            
    future_expiries = [e for e in rows if parse_exp(e) != datetime.max and parse_exp(e).date() >= today]
    if not future_expiries:
        return sorted(rows, key=parse_exp)
    return sorted(future_expiries, key=parse_exp)

def get_spot_token(name: str) -> Optional[Dict[str, Any]]:
    """Return token and exchange details for index spot price."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT symbol, brsymbol, exchange, brexchange, token FROM symtoken WHERE name=? AND instrumenttype='INDEX' LIMIT 1",
        (name,)
    )
    row = cur.fetchone()
    conn.close()
    if row:
        return {
            "symbol": row[0],
            "brsymbol": row[1],
            "exchange": row[2],
            "brexchange": row[3],
            "token": row[4]
        }
    return None

def get_option_chain_contracts(name: str, expiry: str) -> List[Dict[str, Any]]:
    """Fetch all CE and PE contracts for a specific underlying and expiry."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT strike, instrumenttype, symbol, brsymbol, token, lotsize, exchange, brexchange "
        "FROM symtoken WHERE name=? AND expiry=? AND instrumenttype IN ('CE', 'PE') "
        "ORDER BY strike ASC",
        (name, expiry)
    )
    rows = cur.fetchall()
    conn.close()
    
    contracts = []
    for r in rows:
        contracts.append({
            "strike": float(r[0]),
            "type": r[1],
            "symbol": r[2],
            "brsymbol": r[3],
            "token": str(r[4]),
            "lotsize": int(r[5] or 1),
            "exchange": r[6],
            "brexchange": r[7]
        })
    return contracts

def get_contract_by_symbol(symbol: str) -> Optional[Dict[str, Any]]:
    """Look up contract info by symbol or brsymbol."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT symbol, brsymbol, exchange, brexchange, token, lotsize, strike, instrumenttype, name "
        "FROM symtoken WHERE symbol=? OR brsymbol=? LIMIT 1",
        (symbol, symbol)
    )
    r = cur.fetchone()
    conn.close()
    if not r:
        return None
    return {
        "symbol": r[0],
        "brsymbol": r[1],
        "exchange": r[2],
        "brexchange": r[3],
        "token": str(r[4]),
        "lotsize": int(r[5] or 1),
        "strike": float(r[6] or 0),
        "type": r[7],
        "name": r[8]
    }
