import logging
import os
import sys
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory

# Add MyAlgo root to python path
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from core.account_manager import AccountManager
from core.option_chain import build_option_chain
from core.symbol_db import get_supported_indices, get_expiries_for_symbol

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ZeroAlgo")

app = Flask(__name__, static_folder="static")
account_mgr = AccountManager()


def get_active_client():
    return account_mgr.get_active_client()


# ---------------------------------------------------------
# Static Frontend & PWA Serving
# ---------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/manifest.json")
def manifest():
    return send_from_directory(app.static_folder, "manifest.json", mimetype="application/manifest+json")

@app.route("/sw.js")
def service_worker():
    response = send_from_directory(app.static_folder, "sw.js", mimetype="application/javascript")
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache"
    return response

@app.route("/<path:path>")
def static_proxy(path):
    return send_from_directory(app.static_folder, path)


# ---------------------------------------------------------
# Multi-Account Management Endpoints
# ---------------------------------------------------------
@app.route("/api/accounts", methods=["GET"])
def get_accounts():
    """List all configured Kotak Neo accounts with live status."""
    return jsonify({
        "status": "success",
        "accounts": account_mgr.list_accounts(mask_secrets=True),
        "active_id": account_mgr.active_id,
    })

@app.route("/api/accounts", methods=["POST"])
def add_account():
    """Add a new Kotak Neo account."""
    data = request.json or {}
    success, msg, acc = account_mgr.add_account(data)
    if success:
        return jsonify({
            "status": "success",
            "message": msg,
            "account": acc,
            "accounts": account_mgr.list_accounts(mask_secrets=True),
            "active_id": account_mgr.active_id,
        })
    return jsonify({"status": "error", "message": msg}), 400

@app.route("/api/accounts/<acc_id>", methods=["PUT"])
def update_account(acc_id):
    """Update details of a specific account."""
    data = request.json or {}
    success, msg = account_mgr.update_account(acc_id, data)
    if success:
        return jsonify({
            "status": "success",
            "message": msg,
            "accounts": account_mgr.list_accounts(mask_secrets=True),
        })
    return jsonify({"status": "error", "message": msg}), 400

@app.route("/api/accounts/<acc_id>", methods=["DELETE"])
def delete_account(acc_id):
    """Remove a Kotak Neo account."""
    success, msg = account_mgr.delete_account(acc_id)
    if success:
        return jsonify({
            "status": "success",
            "message": msg,
            "accounts": account_mgr.list_accounts(mask_secrets=True),
            "active_id": account_mgr.active_id,
        })
    return jsonify({"status": "error", "message": msg}), 400

@app.route("/api/accounts/switch", methods=["POST"])
def switch_account():
    """Switch the current active trading account."""
    data = request.json or {}
    acc_id = data.get("account_id")
    if not acc_id or not account_mgr.set_active_account(acc_id):
        return jsonify({"status": "error", "message": "Invalid account ID"}), 400
    
    client = account_mgr.get_active_client()
    return jsonify({
        "status": "success",
        "message": f"Switched to {client.ucc}",
        "active_id": acc_id,
        "ucc": client.ucc,
        "authenticated": client.is_authenticated(),
        "accounts": account_mgr.list_accounts(mask_secrets=True),
    })

@app.route("/api/accounts/login-all", methods=["POST"])
def login_all_accounts():
    """1-Click automated login for all configured accounts using TOTP secrets."""
    result = account_mgr.login_all()
    result["accounts"] = account_mgr.list_accounts(mask_secrets=True)
    return jsonify(result)

@app.route("/api/accounts/login", methods=["POST"])
def login_single_account():
    """Login a specific account with TOTP and MPIN."""
    data = request.json or {}
    acc_id = data.get("account_id") or account_mgr.active_id
    mobile = data.get("mobile", "")
    mpin = data.get("mpin", "")
    totp = data.get("totp", "")

    success, msg = account_mgr.login_account(acc_id, mobile=mobile, mpin=mpin, totp=totp)
    if success:
        return jsonify({
            "status": "success",
            "message": msg,
            "account_id": acc_id,
            "accounts": account_mgr.list_accounts(mask_secrets=True),
        })
    return jsonify({"status": "error", "message": msg, "account_id": acc_id}), 400


# ---------------------------------------------------------
# Session & Authentication Endpoints
# ---------------------------------------------------------
@app.route("/api/session", methods=["GET"])
def get_session():
    """Return status of Kotak Neo connection, active account, and accounts list."""
    client = get_active_client()
    is_auth = client.is_authenticated()
    return jsonify({
        "status": "success",
        "authenticated": is_auth,
        "ucc": client.ucc,
        "mobile": client.mobile,
        "base_url": client.base_url,
        "active_id": account_mgr.active_id,
        "accounts": account_mgr.list_accounts(mask_secrets=True),
    })

@app.route("/api/login", methods=["POST"])
def login():
    """Legacy/default login endpoint for active account."""
    data = request.json or {}
    acc_id = data.get("account_id") or account_mgr.active_id
    mobile = data.get("mobile", "")
    mpin = data.get("mpin", "")
    totp = data.get("totp", "")

    success, msg = account_mgr.login_account(acc_id, mobile=mobile, mpin=mpin, totp=totp)
    client = account_mgr.get_client(acc_id) or get_active_client()
    if success:
        return jsonify({
            "status": "success",
            "message": msg,
            "ucc": client.ucc,
            "active_id": acc_id,
            "accounts": account_mgr.list_accounts(mask_secrets=True),
        })
    return jsonify({"status": "error", "message": msg}), 400


# ---------------------------------------------------------
# Account & Funds
# ---------------------------------------------------------
@app.route("/api/funds", methods=["GET"])
def get_funds():
    acc_id = request.args.get("account_id")
    client = account_mgr.get_client(acc_id) if acc_id else get_active_client()
    if not client:
        return jsonify({"status": "error", "message": "Account client not found"}), 404
    funds = client.get_funds()
    return jsonify(funds)


# ---------------------------------------------------------
# Static IP & Proxy Settings Endpoints
# ---------------------------------------------------------
@app.route("/api/static-ip", methods=["GET"])
def get_static_ip_settings():
    """Get current Static IP and Proxy configuration."""
    client = get_active_client()
    status = client.get_proxy_status()
    return jsonify({
        "status": "success",
        "settings": status
    })

@app.route("/api/static-ip", methods=["POST"])
def update_static_ip_settings():
    """Save Static IP and Proxy settings across all clients."""
    data = request.json or {}
    static_ip = data.get("static_ip", "")
    proxy_url = data.get("proxy_url", "")
    use_proxy = bool(data.get("use_proxy", False))

    updated = None
    for c in account_mgr.clients.values():
        updated = c.save_settings(static_ip=static_ip, proxy_url=proxy_url, use_proxy=use_proxy)

    return jsonify({
        "status": "success",
        "message": "Static IP & Proxy configuration saved successfully",
        "settings": updated
    })

@app.route("/api/test-ip", methods=["GET"])
def test_ip():
    """Check the real outgoing public IP that external brokers see."""
    client = get_active_client()
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
    client = get_active_client()
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
    acc_id = request.args.get("account_id")
    client = account_mgr.get_client(acc_id) if acc_id else get_active_client()
    if not client:
        return jsonify({"status": "error", "message": "Account client not found"}), 404
    orders = client.get_orders()
    trades = client.get_trades()
    return jsonify({
        "status": "success",
        "orders": orders,
        "trades": trades,
        "ucc": client.ucc,
        "account_id": acc_id or account_mgr.active_id,
    })

@app.route("/api/orders", methods=["POST"])
def place_order():
    data = request.json or {}
    symbol = data.get("symbol")
    quantity = int(data.get("quantity", 0))
    target_mode = data.get("target_mode", "active")  # 'active' | 'all' | 'custom'
    account_ids = data.get("account_ids")

    if not symbol or quantity <= 0:
        return jsonify({"status": "error", "message": "Valid symbol and quantity required"}), 400

    # Multi-account order execution
    if target_mode == "all" or (target_mode == "custom" and len(account_ids or []) > 1):
        results = account_mgr.place_order_multi(target_mode, account_ids, data)
        success_count = sum(1 for r in results if r.get("success"))
        all_success = (success_count == len(results)) and len(results) > 0
        return jsonify({
            "status": "success" if success_count > 0 else "error",
            "multi": True,
            "success_count": success_count,
            "total_count": len(results),
            "results": results,
            "message": f"Multi-Order Executed: {success_count}/{len(results)} accounts placed successfully."
        })

    # Single active account
    client = get_active_client()
    success, msg, order_id = client.place_order(
        symbol=symbol,
        exchange=data.get("exchange", "NFO"),
        side=data.get("side", "BUY").upper(),
        product=data.get("product", "MIS").upper(),
        order_type=data.get("order_type", "MARKET").upper(),
        quantity=quantity,
        price=float(data.get("price", 0.0)),
        trigger_price=float(data.get("trigger_price", 0.0)),
    )

    if success:
        return jsonify({"status": "success", "message": msg, "order_id": order_id, "ucc": client.ucc})
    return jsonify({"status": "error", "message": msg, "ucc": client.ucc}), 400

@app.route("/api/orders/<order_id>", methods=["DELETE"])
def cancel_order(order_id):
    acc_id = request.args.get("account_id")
    client = account_mgr.get_client(acc_id) if acc_id else get_active_client()
    success, msg = client.cancel_order(order_id)
    if success:
        return jsonify({"status": "success", "message": msg})
    return jsonify({"status": "error", "message": msg}), 400


# ---------------------------------------------------------
# Positions Endpoints
# ---------------------------------------------------------
@app.route("/api/positions", methods=["GET"])
def get_positions():
    acc_id = request.args.get("account_id")
    client = account_mgr.get_client(acc_id) if acc_id else get_active_client()
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
        "ucc": client.ucc,
        "account_id": acc_id or account_mgr.active_id,
    })

@app.route("/api/positions/exit", methods=["POST"])
def exit_position():
    data = request.json or {}
    symbol = data.get("symbol")
    exit_all = data.get("exit_all", False)
    acc_id = data.get("account_id")
    target_mode = data.get("target_mode", "active")
    
    clients_to_exit = []
    if target_mode == "all":
        clients_to_exit = list(account_mgr.clients.values())
    elif acc_id:
        c = account_mgr.get_client(acc_id)
        if c:
            clients_to_exit = [c]
    else:
        clients_to_exit = [get_active_client()]

    all_results = []
    for cl in clients_to_exit:
        positions = cl.get_positions()
        for p in positions:
            net_qty = p.get("net_qty", 0)
            if net_qty == 0:
                continue
            if not exit_all and p.get("symbol") != symbol:
                continue
                
            opposing_side = "SELL" if net_qty > 0 else "BUY"
            qty = abs(net_qty)
            
            success, msg, order_id = cl.place_order(
                symbol=p["symbol"],
                exchange=p["exchange"],
                side=opposing_side,
                product=p["product"],
                order_type="MARKET",
                quantity=qty,
            )
            all_results.append({
                "ucc": cl.ucc,
                "symbol": p["symbol"],
                "success": success,
                "message": msg,
                "order_id": order_id
            })

    return jsonify({"status": "success", "results": all_results})


# ---------------------------------------------------------
# Main Entry Point
# ---------------------------------------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", os.getenv("MYALGO_PORT", 5050)))
    print(f"\n=======================================================")
    print(f"             ZeroAlgo Terminal is Ready                ")
    print(f"   URL: http://127.0.0.1:{port}                        ")
    print(f"   Accounts Configured: {len(account_mgr.accounts)}    ")
    print(f"=======================================================\n")
    app.run(host="0.0.0.0", port=port, debug=False)
