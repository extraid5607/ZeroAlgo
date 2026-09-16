import logging
from typing import Dict, Any, List, Optional
from .symbol_db import get_expiries_for_symbol, get_option_chain_contracts, get_spot_token
from .kotak_client import KotakNeoClient

logger = logging.getLogger("ZeroAlgo.OptionChain")

INDEX_CANDIDATES = {
    "NIFTY": ("nse_cm", "Nifty 50"),
    "BANKNIFTY": ("nse_cm", "Nifty Bank"),
    "FINNIFTY": ("nse_cm", "Nifty Fin Service"),
    "MIDCPNIFTY": ("nse_cm", "Nifty Mid Select"),
    "SENSEX": ("bse_cm", "SENSEX"),
}

DEFAULT_STRIKE_STEPS = {
    "NIFTY": 50,
    "BANKNIFTY": 100,
    "FINNIFTY": 50,
    "MIDCPNIFTY": 25,
    "SENSEX": 100,
    "CRUDEOIL": 50,
    "CRUDEOILM": 50,
    "GOLD": 100,
    "GOLDM": 100,
    "SILVER": 500,
    "SILVERM": 500,
    "NATURALGAS": 5,
    "NATGASMINI": 5,
    "COPPER": 5,
    "ZINC": 2,
    "ALUMINIUM": 2,
}

def get_underlying_spot(client: KotakNeoClient, underlying: str) -> float:
    """Fetch live spot price for an index or commodity from Kotak Neo."""
    spot_info = get_spot_token(underlying.upper())
    if spot_info and client.is_authenticated():
        seg = spot_info.get("brexchange") or "nse_cm"
        token = spot_info.get("token") or spot_info.get("symbol")
        try:
            quotes = client.get_quotes([f"{seg}|{token}"])
            if quotes:
                if str(token) in quotes and quotes[str(token)].get("ltp"):
                    return float(quotes[str(token)]["ltp"])
                if underlying.upper() in quotes and quotes[underlying.upper()].get("ltp"):
                    return float(quotes[underlying.upper()]["ltp"])
                first_q = next(iter(quotes.values()))
                if first_q and first_q.get("ltp"):
                    return float(first_q["ltp"])
        except Exception as e:
            logger.warning(f"Error fetching spot quote for {underlying}: {e}")

    cand = INDEX_CANDIDATES.get(underlying.upper())
    if cand and client.is_authenticated():
        seg, neo_name = cand
        query = f"{seg}|{neo_name}"
        quotes = client.get_quotes([query])
        if quotes and neo_name in quotes:
            return float(quotes[neo_name].get("ltp") or 0.0)
    return 0.0

def build_option_chain(
    client: KotakNeoClient,
    underlying: str = "NIFTY",
    expiry: Optional[str] = None,
    strike_count: int = 10,
) -> Dict[str, Any]:
    """Build full live option chain for the underlying and expiry."""
    underlying = underlying.upper()
    expiries = get_expiries_for_symbol(underlying)
    
    if not expiries:
        return {
            "status": "error",
            "message": f"No option contracts found for {underlying}",
            "underlying": underlying,
            "expiries": [],
            "chain": [],
        }

    selected_expiry = expiry if expiry and expiry in expiries else expiries[0]
    contracts = get_option_chain_contracts(underlying, selected_expiry)

    if not contracts:
        return {
            "status": "error",
            "message": f"No strikes found for {underlying} on {selected_expiry}",
            "underlying": underlying,
            "expiry": selected_expiry,
            "expiries": expiries,
            "chain": [],
        }

    # Group contracts by strike
    strikes_map: Dict[float, Dict[str, Any]] = {}
    tokens_to_fetch = []
    token_to_strike = {}  # token -> (strike, type)

    for c in contracts:
        s = c["strike"]
        t = c["type"].upper()
        if s not in strikes_map:
            strikes_map[s] = {"strike": s, "ce": None, "pe": None}
        
        query_seg = c.get("brexchange") or ("bse_fo" if underlying == "SENSEX" else "nse_fo")
        contract_info = {
            "symbol": c["symbol"],
            "brsymbol": c["brsymbol"],
            "token": c["token"],
            "lotsize": c["lotsize"],
            "ex_seg": query_seg,
            "ltp": 0.0,
            "oi": 0,
            "change": 0.0,
        }
        if t == "CE":
            strikes_map[s]["ce"] = contract_info
        elif t == "PE":
            strikes_map[s]["pe"] = contract_info

        if c["token"]:
            token_to_strike[str(c["token"])] = (s, t)

    all_strikes = sorted(strikes_map.keys())

    # Get live spot price
    spot_price = get_underlying_spot(client, underlying)
    
    # If spot price is zero or unavailable, estimate from mid strike
    if spot_price <= 0 and all_strikes:
        spot_price = all_strikes[len(all_strikes) // 2]

    # Find ATM strike
    step = DEFAULT_STRIKE_STEPS.get(underlying, 50)
    atm_strike = min(all_strikes, key=lambda x: abs(x - spot_price))

    # Slice strikes around ATM (or show all strikes when strike_count <= 0)
    if strike_count <= 0 or strike_count >= len(all_strikes):
        selected_strikes = all_strikes
    else:
        atm_idx = all_strikes.index(atm_strike)
        start_idx = max(0, atm_idx - strike_count)
        end_idx = min(len(all_strikes), atm_idx + strike_count + 1)
        selected_strikes = all_strikes[start_idx:end_idx]

    # Batch-fetch live quotes for the selected strikes
    selected_queries = []
    for s in selected_strikes:
        ce_item = strikes_map[s]["ce"]
        pe_item = strikes_map[s]["pe"]
        if ce_item and ce_item["token"]:
            seg = ce_item.get("ex_seg", "bse_fo" if underlying == "SENSEX" else "nse_fo")
            selected_queries.append(f"{seg}|{ce_item['token']}")
        if pe_item and pe_item["token"]:
            seg = pe_item.get("ex_seg", "bse_fo" if underlying == "SENSEX" else "nse_fo")
            selected_queries.append(f"{seg}|{pe_item['token']}")

    if selected_queries and client.is_authenticated():
        quotes_data = client.get_quotes(selected_queries)
        for token, quote_info in quotes_data.items():
            if str(token) in token_to_strike:
                s, t = token_to_strike[str(token)]
                side_key = "ce" if t == "CE" else "pe"
                if strikes_map[s][side_key]:
                    strikes_map[s][side_key]["ltp"] = quote_info.get("ltp", 0.0)
                    strikes_map[s][side_key]["oi"] = quote_info.get("oi", 0)

    # Format final chain ladder
    chain = []
    for s in selected_strikes:
        chain.append({
            "strike": s,
            "is_atm": (s == atm_strike),
            "ce": strikes_map[s]["ce"],
            "pe": strikes_map[s]["pe"],
        })

    return {
        "status": "success",
        "underlying": underlying,
        "expiry": selected_expiry,
        "expiries": expiries,
        "spot_price": spot_price,
        "atm_strike": atm_strike,
        "chain": chain,
    }
