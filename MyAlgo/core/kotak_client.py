import json
import logging
import os
import urllib.parse
from typing import Dict, Any, List, Optional, Tuple
import httpx

from .config import (
    BASE_DIR,
    KOTAK_UCC,
    KOTAK_ACCESS_TOKEN,
    MOBILE_NUMBER,
    MPIN,
    TOTP_SECRET,
    SESSION_FILE,
    SETTINGS_FILE,
    STATIC_IP,
    PROXY_URL,
)
from .symbol_db import get_contract_by_symbol

logger = logging.getLogger("MyAlgo.KotakClient")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


class KotakNeoClient:
    def __init__(
        self,
        ucc: Optional[str] = None,
        access_token: Optional[str] = None,
        mobile: Optional[str] = None,
        mpin: Optional[str] = None,
        totp_secret: Optional[str] = None,
        session_file: Optional[Path] = None,
        static_ip: Optional[str] = None,
        proxy_url: Optional[str] = None,
        use_proxy: Optional[bool] = None,
    ):
        from pathlib import Path
        self.ucc: str = (ucc if ucc is not None else KOTAK_UCC) or ""
        self.access_token: str = (access_token if access_token is not None else KOTAK_ACCESS_TOKEN) or ""
        self.mobile: str = (mobile if mobile is not None else MOBILE_NUMBER) or ""
        self.mpin: str = (mpin if mpin is not None else MPIN) or ""
        self.totp_secret: str = (totp_secret if totp_secret is not None else TOTP_SECRET) or ""

        if session_file:
            self.session_file = Path(session_file)
        elif self.ucc:
            self.session_file = BASE_DIR / f"session_{self.ucc}.json"
        else:
            self.session_file = SESSION_FILE

        self.session_token: Optional[str] = None
        self.session_sid: Optional[str] = None
        self.base_url: Optional[str] = None
        self.static_ip: str = static_ip if static_ip is not None else (STATIC_IP or "")
        self.proxy_url: str = proxy_url if proxy_url is not None else (PROXY_URL or "")
        self.use_proxy: bool = use_proxy if use_proxy is not None else bool(PROXY_URL)
        self.load_settings()
        self._init_http_client()
        self.load_session()

    def load_settings(self):
        """Load persistent static IP and proxy settings from settings.json."""
        if SETTINGS_FILE.exists():
            try:
                with open(SETTINGS_FILE, "r") as f:
                    data = json.load(f)
                    self.static_ip = (data.get("static_ip") or self.static_ip or "").strip()
                    self.proxy_url = (data.get("proxy_url") or self.proxy_url or "").strip()
                    self.use_proxy = bool(data.get("use_proxy", self.use_proxy))
            except Exception as e:
                logger.warning(f"Failed to load settings.json: {e}")

    def save_settings(self, static_ip: str, proxy_url: str = "", use_proxy: bool = False) -> Dict[str, Any]:
        """Save static IP and proxy configuration and re-initialize HTTP client."""
        self.static_ip = (static_ip or "").strip()
        self.proxy_url = (proxy_url or "").strip()
        self.use_proxy = bool(use_proxy)
        data = {
            "static_ip": self.static_ip,
            "proxy_url": self.proxy_url,
            "use_proxy": self.use_proxy,
        }
        try:
            with open(SETTINGS_FILE, "w") as f:
                json.dump(data, f, indent=2)
            logger.info(f"Updated settings: static_ip={self.static_ip}, proxy_url={self.proxy_url}, use_proxy={self.use_proxy}")
        except Exception as e:
            logger.error(f"Failed to write settings.json: {e}")

        self._init_http_client()
        return self.get_proxy_status()

    def _init_http_client(self):
        """Create or re-create httpx.Client with proxy if enabled."""
        proxy = None
        if self.use_proxy and self.proxy_url:
            p = self.proxy_url.strip()
            if not (p.startswith("http://") or p.startswith("https://") or p.startswith("socks5://")):
                p = f"http://{p}"
            proxy = p
        elif self.use_proxy and self.static_ip and ":" in self.static_ip:
            # If static_ip was given with a port e.g. 103.15.24.12:8080
            p = self.static_ip.strip()
            if not (p.startswith("http://") or p.startswith("https://")):
                p = f"http://{p}"
            proxy = p

        try:
            if proxy:
                self.client = httpx.Client(proxy=proxy, timeout=15.0)
                logger.info(f"Initialized HTTP client with proxy: {proxy}")
            else:
                transport = httpx.HTTPTransport(local_address="0.0.0.0", retries=1)
                self.client = httpx.Client(transport=transport, timeout=15.0)
                logger.info("Initialized direct HTTP client bound strictly to IPv4 (0.0.0.0)")
        except Exception as e:
            logger.error(f"Error initializing HTTP client with proxy {proxy}: {e}. Falling back to IPv4 client.")
            transport = httpx.HTTPTransport(local_address="0.0.0.0", retries=1)
            self.client = httpx.Client(transport=transport, timeout=15.0)

    def get_proxy_status(self) -> Dict[str, Any]:
        """Return current proxy and static IP configuration."""
        return {
            "static_ip": self.static_ip,
            "proxy_url": self.proxy_url,
            "use_proxy": self.use_proxy,
        }

    def test_outgoing_ip(self) -> Dict[str, Any]:
        """Test current public outgoing IP seen by external servers."""
        try:
            r = self.client.get("https://api.ipify.org?format=json", timeout=8.0)
            if r.status_code == 200:
                detected_ip = r.json().get("ip", "")
                is_match = bool(self.static_ip and (self.static_ip == detected_ip or self.static_ip.startswith(detected_ip)))
                return {
                    "status": "success",
                    "outgoing_ip": detected_ip,
                    "configured_static_ip": self.static_ip,
                    "is_static_match": is_match,
                    "use_proxy": self.use_proxy,
                    "proxy_url": self.proxy_url,
                }
            return {
                "status": "error",
                "message": f"HTTP {r.status_code} from IP service",
                "outgoing_ip": "Unknown",
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e),
                "outgoing_ip": "Connection Failed",
            }

    def save_session(self, session_token: str, session_sid: str, base_url: str):
        self.session_token = session_token
        self.session_sid = session_sid
        self.base_url = base_url.rstrip("/")
        data = {
            "session_token": self.session_token,
            "session_sid": self.session_sid,
            "base_url": self.base_url,
            "ucc": self.ucc,
        }
        target = getattr(self, "session_file", None) or SESSION_FILE
        try:
            with open(target, "w") as f:
                json.dump(data, f, indent=2)
            logger.info(f"Session saved to {target}")
            if target != SESSION_FILE and (not KOTAK_UCC or self.ucc == KOTAK_UCC):
                try:
                    with open(SESSION_FILE, "w") as f:
                        json.dump(data, f, indent=2)
                except Exception:
                    pass
        except Exception as e:
            logger.error(f"Failed to save session to {target}: {e}")

    def load_session(self) -> bool:
        target = getattr(self, "session_file", None) or SESSION_FILE
        if target.exists():
            try:
                with open(target, "r") as f:
                    data = json.load(f)
                    file_ucc = (data.get("ucc") or "").strip().upper()
                    if file_ucc and self.ucc and file_ucc != self.ucc.strip().upper():
                        logger.warning(f"Session in {target} has UCC={file_ucc}, but client is {self.ucc}. Discarding.")
                        return False
                    self.session_token = data.get("session_token")
                    self.session_sid = data.get("session_sid")
                    self.base_url = (data.get("base_url") or "").rstrip("/")
                    return bool(self.session_token and self.session_sid and self.base_url)
            except Exception as e:
                logger.warning(f"Failed to load session from {target}: {e}")
        elif SESSION_FILE.exists():
            try:
                with open(SESSION_FILE, "r") as f:
                    data = json.load(f)
                    file_ucc = (data.get("ucc") or "").strip().upper()
                    if file_ucc and self.ucc and file_ucc == self.ucc.strip().upper():
                        self.session_token = data.get("session_token")
                        self.session_sid = data.get("session_sid")
                        self.base_url = (data.get("base_url") or "").rstrip("/")
                        return bool(self.session_token and self.session_sid and self.base_url)
            except Exception as e:
                pass
        return False

    def is_authenticated(self) -> bool:
        return bool(self.session_token and self.session_sid and self.base_url)

    def login(self, mobile: Optional[str] = None, mpin: Optional[str] = None, totp: Optional[str] = None) -> Tuple[bool, str]:
        """Perform 2-step Kotak Neo Trade API authentication (TOTP + MPIN)."""
        try:
            mob = (mobile or getattr(self, "mobile", "") or "").strip()
            pin = (mpin or getattr(self, "mpin", "") or "").strip()
            code = (totp or "").strip()

            # Auto-generate TOTP if not provided but secret is present
            if not code and getattr(self, "totp_secret", ""):
                sec = str(self.totp_secret).strip().replace(" ", "").upper()
                if len(sec) == 6 and sec.isdigit():
                    logger.warning(f"Configured totp_secret for {self.ucc} is a 6-digit number ({sec}), not a permanent Base32 secret key.")
                else:
                    try:
                        import pyotp
                        code = pyotp.TOTP(sec).now()
                        logger.info(f"Auto-generated TOTP using TOTP_SECRET for {self.ucc}")
                    except Exception as e:
                        logger.warning(f"Could not auto-generate TOTP for {self.ucc}: {e}")

            if not mob:
                return False, "Registered mobile number is required."
            if not pin:
                return False, "6-digit trading MPIN is required."
            if not code:
                return False, "6-digit TOTP code is required. Please enter the current code from your Authenticator app."

            mob = mob.replace("+91", "").replace(" ", "")
            if mob.startswith("91") and len(mob) == 12:
                mob = mob[2:]
            mob = f"+91{mob}"

            # Step 1: Login with TOTP
            payload_step1 = json.dumps({"mobileNumber": mob, "ucc": self.ucc, "totp": str(code).strip()})
            headers_step1 = {
                "Authorization": self.access_token,
                "neo-fin-key": "neotradeapi",
                "Content-Type": "application/json",
            }
            logger.info(f"Initiating Kotak TOTP login for UCC={self.ucc}")
            resp1 = self.client.post(
                "https://mis.kotaksecurities.com/login/1.0/tradeApiLogin",
                headers=headers_step1,
                content=payload_step1,
            )
            data1 = resp1.json()

            if "data" not in data1 or data1.get("data", {}).get("status") != "success":
                err_list = data1.get("error")
                if isinstance(err_list, list) and err_list and isinstance(err_list[0], dict):
                    msg = err_list[0].get("message") or err_list[0].get("errMsg") or str(err_list[0])
                else:
                    msg = data1.get("errMsg", data1.get("message", "TOTP validation failed"))
                return False, f"Step 1 Failed: {msg}"

            view_token = data1["data"]["token"]
            view_sid = data1["data"]["sid"]

            # Step 2: Validate with MPIN
            payload_step2 = json.dumps({"mpin": str(pin).strip()})
            headers_step2 = {
                "Authorization": self.access_token,
                "neo-fin-key": "neotradeapi",
                "sid": view_sid,
                "Auth": view_token,
                "Content-Type": "application/json",
            }
            logger.info(f"TOTP validated for {self.ucc}. Validating MPIN...")
            resp2 = self.client.post(
                "https://mis.kotaksecurities.com/login/1.0/tradeApiValidate",
                headers=headers_step2,
                content=payload_step2,
            )
            data2 = resp2.json()

            if "data" not in data2 or data2.get("data", {}).get("status") != "success":
                err_list = data2.get("error")
                if isinstance(err_list, list) and err_list and isinstance(err_list[0], dict):
                    msg = err_list[0].get("message") or err_list[0].get("errMsg") or str(err_list[0])
                else:
                    msg = data2.get("errMsg", data2.get("message", "MPIN validation failed"))
                return False, f"Step 2 Failed: {msg}"

            trading_token = data2["data"]["token"]
            trading_sid = data2["data"]["sid"]
            base_url = data2["data"].get("baseUrl", "https://cis.kotaksecurities.com")

            self.save_session(trading_token, trading_sid, base_url)
            return True, "Login successful"
        except Exception as e:
            logger.exception(f"Exception during Kotak login for {self.ucc}")
            return False, str(e)

    def _auth_headers(self, content_type: str = "application/json") -> Dict[str, str]:
        headers = {
            "accept": "application/json",
            "Sid": self.session_sid or "",
            "Auth": self.session_token or "",
            "neo-fin-key": "neotradeapi",
            "Content-Type": content_type,
        }
        return headers

    def get_funds(self) -> Dict[str, Any]:
        """Fetch account margin and balance limits."""
        if not self.is_authenticated():
            return {"error": "Not authenticated with Kotak Neo"}
        try:
            url = f"{self.base_url}/quick/user/limits"
            payload = "jData=%7B%22seg%22%3A%22ALL%22%2C%22exch%22%3A%22ALL%22%2C%22prod%22%3A%22ALL%22%7D"
            headers = self._auth_headers(content_type="application/x-www-form-urlencoded")
            r = self.client.post(url, headers=headers, content=payload)
            data = r.json()
            
            # Extract standard limits
            limits = {}
            if isinstance(data, list) and data:
                # Find ALL or equity segment
                for seg in data:
                    if seg.get("segment") in ("ALL", "equity", "FO"):
                        limits = seg
                        break
                if not limits:
                    limits = data[0]
            elif isinstance(data, dict):
                limits = data.get("data", data)
                
            def _parse_val(keys):
                for k in keys:
                    v = limits.get(k)
                    if v is not None and v != "":
                        try:
                            return float(v)
                        except (ValueError, TypeError):
                            pass
                return 0.0

            avail_margin = _parse_val(["Net", "net", "cash", "availableMargin", "AvailableMargin"])
            used_margin = _parse_val(["MarginUsed", "marginUsed", "utilizedMargin", "MarginUsedPrsnt"])
            collateral = _parse_val(["Collateral", "collateral", "CollateralValue"])
            
            return {
                "status": "success",
                "available_margin": round(avail_margin, 2),
                "used_margin": round(used_margin, 2),
                "collateral": round(collateral, 2),
                "total_balance": round(avail_margin + used_margin, 2),
                "raw": limits
            }
        except Exception as e:
            logger.error(f"Error fetching funds: {e}")
            return {"status": "error", "message": str(e), "available_margin": 0.0, "used_margin": 0.0}

    def get_orders(self) -> List[Dict[str, Any]]:
        """Fetch Order Book."""
        if not self.is_authenticated():
            return []
        try:
            url = f"{self.base_url}/quick/user/orders"
            r = self.client.get(url, headers=self._auth_headers())
            data = r.json()
            if isinstance(data, dict) and data.get("stat") == "Ok":
                return data.get("data", [])
            elif isinstance(data, list):
                return data
            return []
        except Exception as e:
            logger.error(f"Error fetching orders: {e}")
            return []

    def get_trades(self) -> List[Dict[str, Any]]:
        """Fetch Executed Trade Book."""
        if not self.is_authenticated():
            return []
        try:
            url = f"{self.base_url}/quick/user/trades"
            r = self.client.get(url, headers=self._auth_headers())
            data = r.json()
            if isinstance(data, dict) and data.get("stat") == "Ok":
                return data.get("data", [])
            elif isinstance(data, list):
                return data
            return []
        except Exception as e:
            logger.error(f"Error fetching trades: {e}")
            return []

    def place_order(
        self,
        symbol: str,
        exchange: str,
        side: str,              # BUY / SELL
        product: str,           # MIS / NRML / CNC
        order_type: str,        # MKT / L / SL / SL-M
        quantity: int,
        price: float = 0.0,
        trigger_price: float = 0.0,
    ) -> Tuple[bool, str, Optional[str]]:
        """Place an order with Kotak Neo."""
        if not self.is_authenticated():
            return False, "Not authenticated with Kotak Neo", None
        try:
            contract = get_contract_by_symbol(symbol)
            token_id = contract["token"] if contract else ""
            trd_sym = contract["brsymbol"] if contract else symbol
            
            # Exchange segment mapping from contract or argument
            if contract and contract.get("brexchange"):
                ex_seg = contract["brexchange"]
            else:
                ex_seg = "bse_fo" if "BSE" in exchange or "BFO" in exchange else "nse_fo"

            # Product mapping: MIS -> MIS, NRML -> NRML, CNC -> CNC
            prod = product.upper()

            # Transaction type: BUY -> B, SELL -> S
            trans_type = "B" if side.upper() == "BUY" else "S"

            # Price type: MKT -> MKT, L -> L, SL -> SL, SL-M -> SL-M
            prc_type = "MKT"
            if order_type.upper() in ("LIMIT", "L"):
                prc_type = "L"
            elif order_type.upper() in ("SL", "STOP_LOSS"):
                prc_type = "SL"
            elif order_type.upper() in ("SL-M", "SLM"):
                prc_type = "SL-M"

            order_payload = {
                "am": "NO",
                "dq": "0",
                "es": ex_seg,
                "mp": "0",
                "pc": prod,
                "pf": "N",
                "pr": str(price) if prc_type in ("L", "SL") else "0",
                "pt": prc_type,
                "qt": str(quantity),
                "rt": "DAY",
                "tp": str(trigger_price) if prc_type in ("SL", "SL-M") else "0",
                "ts": trd_sym,
                "tt": trans_type,
            }

            url = f"{self.base_url}/quick/order/rule/ms/place"
            payload_str = f"jData={urllib.parse.quote(json.dumps(order_payload))}"
            headers = self._auth_headers(content_type="application/x-www-form-urlencoded")

            logger.info(f"Placing order (via Static IP: {self.static_ip or 'direct'}, Proxy: {self.use_proxy}): {order_payload}")
            r = self.client.post(url, headers=headers, content=payload_str)
            try:
                res_data = r.json()
            except Exception:
                res_data = {"stat": "Not_Ok", "errMsg": r.text, "stCode": r.status_code}

            logger.info(f"Kotak Neo Order Response ({r.status_code}): {res_data}")

            if res_data.get("stat") == "Ok":
                order_id = res_data.get("nOrdNo")
                return True, "Order placed successfully", order_id
            else:
                st_code = res_data.get("stCode")
                err = res_data.get("errMsg") or res_data.get("emsg") or res_data.get("message") or res_data.get("error")
                
                if st_code == 1037 or "session ip" in str(err).lower():
                    err_msg = (
                        "Kotak Neo Session IP Mismatch (Code 1037). "
                        "Your current session was created under a different IP/network interface. "
                        "Please click 'Login / Session' in the top header and re-authenticate to refresh your session."
                    )
                    return False, err_msg, None
                elif st_code == 100008 or err == "unauthorized":
                    proxy_status = self.get_proxy_status()
                    detected_ip = proxy_status.get("detected_ip") or "your current IP"
                    err_msg = (
                        f"Kotak Neo IP Rejected (Error 100008: Unauthorized). "
                        f"Outgoing IP {detected_ip} is not whitelisted in your Kotak Neo Trade API settings. "
                        f"Please add {detected_ip} (or your Static IP Proxy) to your Kotak Neo allowed IPs."
                    )
                    return False, err_msg, None
                elif not err:
                    err = f"Order rejected by Kotak (Status {r.status_code}, Code: {st_code or 'Unknown'})"
                return False, str(err), None
        except Exception as e:
            logger.exception("Error in place_order")
            return False, str(e), None

    def cancel_order(self, order_id: str) -> Tuple[bool, str]:
        """Cancel an open order."""
        if not self.is_authenticated():
            return False, "Not authenticated"
        try:
            url = f"{self.base_url}/quick/order/cancel"
            payload = f"jData={urllib.parse.quote(json.dumps({'on': str(order_id), 'am': 'NO'}))}"
            headers = self._auth_headers(content_type="application/x-www-form-urlencoded")
            r = self.client.post(url, headers=headers, content=payload)
            res = r.json()
            if res.get("stat") == "Ok":
                return True, "Order cancelled successfully"
            return False, res.get("emsg", "Failed to cancel order")
        except Exception as e:
            logger.error(f"Error cancelling order: {e}")
            return False, str(e)

    def get_positions(self) -> List[Dict[str, Any]]:
        """Fetch Positions and calculate real-time PnL."""
        if not self.is_authenticated():
            return []
        try:
            url = f"{self.base_url}/quick/user/positions"
            r = self.client.get(url, headers=self._auth_headers())
            data = r.json()
            raw_positions = data.get("data", []) if isinstance(data, dict) else []
            
            positions = []
            symbols_to_quote = []

            for p in raw_positions:
                buy_qty = int(p.get("flBuyQty", 0)) + int(p.get("cfBuyQty", 0))
                sell_qty = int(p.get("flSellQty", 0)) + int(p.get("cfSellQty", 0))
                net_qty = buy_qty - sell_qty
                
                buy_amt = float(p.get("buyAmt", 0))
                sell_amt = float(p.get("sellAmt", 0))
                
                buy_avg = (buy_amt / buy_qty) if buy_qty > 0 else 0.0
                sell_avg = (sell_amt / sell_qty) if sell_qty > 0 else 0.0

                sym = p.get("trdSym", "")
                ex_seg = p.get("exSeg", "")
                prod = p.get("prod", "")
                tok = p.get("tok", "")

                pos_item = {
                    "symbol": sym,
                    "exchange": "NFO" if "fo" in ex_seg else "NSE",
                    "product": prod,
                    "net_qty": net_qty,
                    "buy_qty": buy_qty,
                    "sell_qty": sell_qty,
                    "buy_avg": round(buy_avg, 2),
                    "sell_avg": round(sell_avg, 2),
                    "token": tok,
                    "ex_seg": ex_seg,
                    "ltp": float(p.get("ltp", 0.0) or 0.0),
                    "pnl": float(p.get("rpnl", 0.0) or 0.0),
                }

                if net_qty != 0:
                    symbols_to_quote.append((pos_item, ex_seg, tok))

                positions.append(pos_item)

            # Backfill live LTP for open positions
            if symbols_to_quote:
                try:
                    queries = [f"{ex}|{tok}" for _, ex, tok in symbols_to_quote if tok]
                    if queries:
                        quotes = self.get_quotes(queries)
                        for pos, _, tok in symbols_to_quote:
                            q = quotes.get(str(tok))
                            if q and q.get("ltp"):
                                ltp = q["ltp"]
                                pos["ltp"] = ltp
                                if pos["net_qty"] > 0:
                                    pos["pnl"] = round((ltp - pos["buy_avg"]) * pos["net_qty"], 2)
                                elif pos["net_qty"] < 0:
                                    pos["pnl"] = round((pos["sell_avg"] - ltp) * abs(pos["net_qty"]), 2)
                except Exception as q_err:
                    logger.warning(f"Could not backfill position quotes: {q_err}")

            return positions
        except Exception as e:
            logger.error(f"Error fetching positions: {e}")
            return []

    def get_quotes(self, queries: List[str]) -> Dict[str, Dict[str, Any]]:
        """Fetch quotes in batch using Neo API v2 script-details/1.0/quotes/neosymbol/{query}/all."""
        if not self.base_url or not queries:
            return {}
        try:
            results = {}
            # Chunk into batches of 25 (Kotak Neo requires < 50 symbols per call)
            for i in range(0, len(queries), 25):
                batch = queries[i : i + 25]
                q_str = ",".join(batch)
                encoded_query = urllib.parse.quote(q_str, safe="|,")
                url = f"{self.base_url}/script-details/1.0/quotes/neosymbol/{encoded_query}/all"
                headers = {"Authorization": self.access_token, "Content-Type": "application/json"}
                r = self.client.get(url, headers=headers)
                if r.status_code == 200:
                    data = r.json()
                    if isinstance(data, list):
                        for item in data:
                            tok = str(item.get("exchange_token") or item.get("pSymbol") or "")
                            sym = str(item.get("display_symbol") or "")
                            ohlc = item.get("ohlc", {}) or {}
                            try:
                                oi_val = int(float(item.get("open_int") or 0))
                            except (ValueError, TypeError):
                                oi_val = 0
                            try:
                                ltp_val = float(item.get("ltp") or 0.0)
                            except (ValueError, TypeError):
                                ltp_val = 0.0
                            try:
                                chg_val = float(item.get("change") or 0.0)
                            except (ValueError, TypeError):
                                chg_val = 0.0

                            qdict = {
                                "ltp": ltp_val,
                                "open": float(ohlc.get("open") or 0.0),
                                "high": float(ohlc.get("high") or 0.0),
                                "low": float(ohlc.get("low") or 0.0),
                                "close": float(ohlc.get("close") or 0.0),
                                "oi": oi_val,
                                "volume": float(item.get("last_volume") or 0.0),
                                "change": chg_val,
                            }
                            if tok:
                                results[tok] = qdict
                            if sym:
                                results[sym] = qdict
                else:
                    logger.warning(f"Quote fetch error HTTP {r.status_code}: {r.text[:150]}")
            return results
        except Exception as e:
            logger.error(f"Error fetching quotes: {e}")
            return {}
