import logging
import os
import sys
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory

# Add MyAlgo root to python path
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from core.config import (
    KOTAK_UCC,
    MOBILE_NUMBER,
    MPIN,
    TOTP_SECRET,
)
from core.kotak_client import KotakNeoClient
from core.option_chain import build_option_chain
from core.symbol_db import get_supported_indices, get_expiries_for_symbol

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ZeroAlgo")

app = Flask(__name__, static_folder="static")
client = KotakNeoClient()


# ---------------------------------------------------------
# Static Frontend Serving
# ---------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/<path:path>")
def static_proxy(path):
    return send_from_directory(app.static_folder, path)


# ---------------------------------------------------------
# Session & Authentication Endpoints
# ---------------------------------------------------------
@app.route("/api/session", methods=["GET"])
def get_session():
    """Return status of Kotak Neo connection and active session."""
    is_auth = client.is_authenticated()
    return jsonify({
        "status": "success",
        "authenticated": is_auth,
        "ucc": client.ucc,
        "mobile": MOBILE_NUMBER,
        "base_url": client.base_url,
    })

@app.route("/api/login", methods=["POST"])
def login():
    """Login to Kotak Neo via TOTP and MPIN."""
    data = request.json or {}
    mobile = data.get("mobile") or MOBILE_NUMBER
    mpin = data.get("mpin") or MPIN
    totp = data.get("totp", "").strip()

    # If TOTP not supplied in request, attempt auto-generation via TOTP_SECRET
    if not totp and TOTP_SECRET:
        try:
            import pyotp
            totp = pyotp.TOTP(TOTP_SECRET.strip()).now()
            logger.info("Generated TOTP using TOTP_SECRET from configuration")
        except Exception as e:
            logger.warning(f"Could not auto-generate TOTP: {e}")

    if not mobile or not mpin or not totp:
        return jsonify({
            "status": "error",
            "message": "Mobile Number, MPIN, and 6-digit TOTP code are required."
        }), 400

    success, msg = client.login(mobile=mobile, mpin=mpin, totp=totp)
    if success:
        return jsonify({"status": "success", "message": msg, "ucc": client.ucc})
    return jsonify({"status": "error", "message": msg}), 400


# ---------------------------------------------------------
# Account & Funds
# ---------------------------------------------------------
@app.route("/api/funds", methods=["GET"])
def get_funds():
    funds = client.get_funds()
    return jsonify(funds)


# ---------------------------------------------------------
# Static IP & Proxy Settings Endpoints
# ---------------------------------------------------------
@app.route("/api/static-ip", methods=["GET"])
def get_static_ip_settings():
    """Get current Static IP and Proxy configuration."""
    status = client.get_proxy_status()
    return jsonify({
        "status": "success",
        "settings": status
    })

@app.route("/api/static-ip", methods=["POST"])
def update_static_ip_settings():
    """Save Static IP and Proxy settings."""
    data = request.json or {}
    static_ip = data.get("static_ip", "")
    proxy_url = data.get("proxy_url", "")
    use_proxy = bool(data.get("use_proxy", False))

    updated = client.save_settings(static_ip=static_ip, proxy_url=proxy_url, use_proxy=use_proxy)
    return jsonify({
        "status": "success",
        "message": "Static IP & Proxy configuration saved successfully",
        "settings": updated
    })

@app.route("/api/test-ip", methods=["GET"])
def test_ip():
    """Check the real outgoing public IP that external brokers see."""
    result = client.test_outgoing_ip()
    return jsonify(result)


# ---------------------------------------------------------
# Option Chain Endpoints
# ---------------------------------------------------------
@app.route("/api/option-chain", methods=["GET"])
def get_option_chain():
    symbol = request.args.get("symbol", "NIFTY").upper()
    expiry = request.args.get("expiry")
    count_arg = str(request.args.get("count", "10")).strip().upper()
    if count_arg in ("ALL", "-1", "0", "ALL STRIKES"):
        count = -1
    else:
        try:
            count = int(count_arg)
        except ValueError:
            count = 10
    chain = build_option_chain(client, underlying=symbol, expiry=expiry, strike_count=count)
    return jsonify(chain)

@app.route("/api/indices", methods=["GET"])
def get_indices():
    return jsonify({"status": "success", "indices": get_supported_indices()})

@app.route("/api/expiries", methods=["GET"])
def get_expiries():
    symbol = request.args.get("symbol", "NIFTY").upper()
    expiries = get_expiries_for_symbol(symbol)
    return jsonify({"status": "success", "symbol": symbol, "expiries": expiries})


# ---------------------------------------------------------
# Orders & Trades Endpoints
# ---------------------------------------------------------
@app.route("/api/orders", methods=["GET"])
def get_orders():
    orders = client.get_orders()
    trades = client.get_trades()
    return jsonify({
        "status": "success",
        "orders": orders,
        "trades": trades
    })

@app.route("/api/orders", methods=["POST"])
def place_order():
    data = request.json or {}
    symbol = data.get("symbol")
    exchange = data.get("exchange", "NFO")
    side = data.get("side", "BUY").upper()
    product = data.get("product", "MIS").upper()
    order_type = data.get("order_type", "MARKET").upper()
    quantity = int(data.get("quantity", 0))
    price = float(data.get("price", 0.0))
    trigger_price = float(data.get("trigger_price", 0.0))

    if not symbol or quantity <= 0:
        return jsonify({"status": "error", "message": "Valid symbol and quantity required"}), 400

    success, msg, order_id = client.place_order(
        symbol=symbol,
        exchange=exchange,
        side=side,
        product=product,
        order_type=order_type,
        quantity=quantity,
        price=price,
        trigger_price=trigger_price,
    )

    if success:
        return jsonify({"status": "success", "message": msg, "order_id": order_id})
    return jsonify({"status": "error", "message": msg}), 400

@app.route("/api/orders/<order_id>", methods=["DELETE"])
def cancel_order(order_id):
    success, msg = client.cancel_order(order_id)
    if success:
        return jsonify({"status": "success", "message": msg})
    return jsonify({"status": "error", "message": msg}), 400


# ---------------------------------------------------------
# Positions Endpoints
# ---------------------------------------------------------
@app.route("/api/positions", methods=["GET"])
def get_positions():
    positions = client.get_positions()
    
    # Stable deterministic sorting:
    # 1. Open positions (net_qty != 0) first, closed (net_qty == 0) last
    # 2. Within each group, sort alphabetically by symbol
    def pos_sort_key(p):
        is_closed = 1 if p.get("net_qty", 0) == 0 else 0
        return (is_closed, p.get("symbol", ""))
    
    positions.sort(key=pos_sort_key)

    total_unrealized = sum(p.get("pnl", 0.0) for p in positions if p.get("net_qty") != 0)
    total_realized = sum(p.get("pnl", 0.0) for p in positions if p.get("net_qty") == 0)
    return jsonify({
        "status": "success",
        "positions": positions,
        "total_unrealized_pnl": round(total_unrealized, 2),
        "total_realized_pnl": round(total_realized, 2),
        "total_pnl": round(total_unrealized + total_realized, 2),
    })

@app.route("/api/positions/exit", methods=["POST"])
def exit_position():
    data = request.json or {}
    symbol = data.get("symbol")
    exit_all = data.get("exit_all", False)
    
    positions = client.get_positions()
    results = []

    for p in positions:
        net_qty = p.get("net_qty", 0)
        if net_qty == 0:
            continue
        
        # If not exiting all and not this symbol, skip
        if not exit_all and p.get("symbol") != symbol:
            continue
            
        opposing_side = "SELL" if net_qty > 0 else "BUY"
        qty = abs(net_qty)
        
        success, msg, order_id = client.place_order(
            symbol=p["symbol"],
            exchange=p["exchange"],
            side=opposing_side,
            product=p["product"],
            order_type="MARKET",
            quantity=qty,
        )
        results.append({
            "symbol": p["symbol"],
            "success": success,
            "message": msg,
            "order_id": order_id
        })

    return jsonify({"status": "success", "results": results})


# ---------------------------------------------------------
# Main Entry Point
# ---------------------------------------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", os.getenv("MYALGO_PORT", 5050)))
    print(f"\n=======================================================")
    print(f"             ZeroAlgo Terminal is Ready                ")
    print(f"   URL: http://127.0.0.1:{port}                        ")
    print(f"=======================================================\n")
    app.run(host="0.0.0.0", port=port, debug=False)
