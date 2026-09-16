import json
import logging
import time
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from .config import (
    BASE_DIR,
    KOTAK_UCC,
    KOTAK_ACCESS_TOKEN,
    MOBILE_NUMBER,
    MPIN,
    TOTP_SECRET,
    STATIC_IP,
    PROXY_URL,
    SESSION_FILE,
)
from .kotak_client import KotakNeoClient

logger = logging.getLogger("ZeroAlgo.AccountManager")
ACCOUNTS_FILE = BASE_DIR / "accounts.json"


class AccountManager:
    def __init__(self):
        self.accounts: List[Dict[str, Any]] = []
        self.clients: Dict[str, KotakNeoClient] = {}
        self.active_id: str = ""
        self.load_accounts()

    def _bootstrap_from_env(self) -> List[Dict[str, Any]]:
        """Create accounts from environment variables (.env / Render)."""
        import os
        accounts = []

        # Account 1 (Default)
        if KOTAK_UCC or MOBILE_NUMBER:
            accounts.append({
                "id": "acc_1",
                "name": os.getenv("ACCOUNT1_NAME", "Main Account"),
                "ucc": KOTAK_UCC or "ACCOUNT1",
                "access_token": KOTAK_ACCESS_TOKEN or "",
                "mobile": MOBILE_NUMBER or "",
                "mpin": MPIN or "",
                "totp_secret": TOTP_SECRET or "",
                "is_active": True,
                "created_at": int(time.time()),
            })

        # Account 2
        acc2_ucc = os.getenv("ACCOUNT2_UCC") or os.getenv("ACC2_UCC")
        if acc2_ucc:
            accounts.append({
                "id": "acc_2",
                "name": os.getenv("ACCOUNT2_NAME", f"Account 2 ({acc2_ucc})"),
                "ucc": acc2_ucc.strip().upper(),
                "access_token": (os.getenv("ACCOUNT2_CONSUMER_KEY") or os.getenv("ACC2_CONSUMER_KEY") or "").strip(),
                "mobile": (os.getenv("ACCOUNT2_MOBILE") or os.getenv("ACC2_MOBILE") or "").strip(),
                "mpin": (os.getenv("ACCOUNT2_MPIN") or os.getenv("ACC2_MPIN") or "").strip(),
                "totp_secret": (os.getenv("ACCOUNT2_TOTP_SECRET") or os.getenv("ACC2_TOTP_SECRET") or "").strip().upper(),
                "is_active": False,
                "created_at": int(time.time()),
            })

        # Account 3
        acc3_ucc = os.getenv("ACCOUNT3_UCC") or os.getenv("ACC3_UCC")
        if acc3_ucc:
            accounts.append({
                "id": "acc_3",
                "name": os.getenv("ACCOUNT3_NAME", f"Account 3 ({acc3_ucc})"),
                "ucc": acc3_ucc.strip().upper(),
                "access_token": (os.getenv("ACCOUNT3_CONSUMER_KEY") or os.getenv("ACC3_CONSUMER_KEY") or "").strip(),
                "mobile": (os.getenv("ACCOUNT3_MOBILE") or os.getenv("ACC3_MOBILE") or "").strip(),
                "mpin": (os.getenv("ACCOUNT3_MPIN") or os.getenv("ACC3_MPIN") or "").strip(),
                "totp_secret": (os.getenv("ACCOUNT3_TOTP_SECRET") or os.getenv("ACC3_TOTP_SECRET") or "").strip().upper(),
                "is_active": False,
                "created_at": int(time.time()),
            })

        if not accounts:
            accounts.append({
                "id": "acc_1",
                "name": "Main Account",
                "ucc": "XYH4V",
                "access_token": "",
                "mobile": "",
                "mpin": "",
                "totp_secret": "",
                "is_active": True,
                "created_at": int(time.time()),
            })
        return accounts

    def load_accounts(self):
        """Load accounts from accounts.json or bootstrap from .env."""
        if ACCOUNTS_FILE.exists():
            try:
                with open(ACCOUNTS_FILE, "r") as f:
                    self.accounts = json.load(f)
            except Exception as e:
                logger.error(f"Failed to read accounts.json: {e}")
                self.accounts = []

        if not self.accounts:
            self.accounts = self._bootstrap_from_env()
            self.save_accounts()
        else:
            # Check if any new environment accounts (e.g. on Render) need to be merged
            env_accounts = self._bootstrap_from_env()
            existing_uccs = {a.get("ucc") for a in self.accounts}
            for ea in env_accounts:
                if ea.get("ucc") and ea.get("ucc") not in existing_uccs:
                    self.accounts.append(ea)
            self.save_accounts()

        # Determine active account
        active = next((a for a in self.accounts if a.get("is_active")), None)
        if not active and self.accounts:
            self.accounts[0]["is_active"] = True
            active = self.accounts[0]
        self.active_id = active["id"] if active else ""

        # Initialize clients for all accounts
        self.clients.clear()
        for acc in self.accounts:
            self._init_client(acc)

    def _init_client(self, acc: Dict[str, Any]) -> KotakNeoClient:
        acc_id = acc["id"]
        ucc = acc.get("ucc", "")
        session_file = BASE_DIR / f"session_{acc_id}.json"
        
        # If legacy session.json strictly matches this UCC, copy/use it
        if not session_file.exists() and SESSION_FILE.exists():
            try:
                with open(SESSION_FILE, "r") as f:
                    s_data = json.load(f)
                    if s_data.get("ucc") and ucc and s_data.get("ucc").strip().upper() == ucc.strip().upper():
                        with open(session_file, "w") as sf:
                            json.dump(s_data, sf, indent=2)
            except Exception:
                pass

        client = KotakNeoClient(
            ucc=ucc,
            access_token=acc.get("access_token", ""),
            mobile=acc.get("mobile", ""),
            mpin=acc.get("mpin", ""),
            totp_secret=acc.get("totp_secret", ""),
            session_file=session_file,
            static_ip=STATIC_IP,
            proxy_url=PROXY_URL,
        )
        self.clients[acc_id] = client
        return client

    def save_accounts(self):
        """Persist accounts list to accounts.json."""
        try:
            with open(ACCOUNTS_FILE, "w") as f:
                json.dump(self.accounts, f, indent=2)
            logger.info(f"Saved {len(self.accounts)} accounts to accounts.json")
        except Exception as e:
            logger.error(f"Failed to save accounts.json: {e}")

    def list_accounts(self, mask_secrets: bool = True) -> List[Dict[str, Any]]:
        """Return list of accounts with connection status and masked secrets."""
        result = []
        for acc in self.accounts:
            acc_id = acc["id"]
            client = self.clients.get(acc_id)
            is_auth = client.is_authenticated() if client else False
            
            token = acc.get("access_token", "")
            mpin = acc.get("mpin", "")
            totp_sec = acc.get("totp_secret", "")
            
            if mask_secrets:
                token = f"{token[:8]}...{token[-4:]}" if len(token) > 12 else ("****" if token else "")
                mpin = "******" if mpin else ""
                totp_sec = f"{totp_sec[:4]}...{totp_sec[-4:]}" if len(totp_sec) > 8 else ("****" if totp_sec else "")

            raw_sec = (acc.get("totp_secret") or "").strip()
            has_valid_totp = bool(raw_sec) and len(raw_sec) > 8 and not raw_sec.isdigit()

            result.append({
                "id": acc_id,
                "name": acc.get("name", f"Account ({acc.get('ucc')})"),
                "ucc": acc.get("ucc", ""),
                "mobile": acc.get("mobile", ""),
                "access_token": token,
                "mpin": mpin,
                "totp_secret": totp_sec,
                "has_totp_secret": has_valid_totp,
                "is_active": (acc_id == self.active_id),
                "is_authenticated": is_auth,
            })
        return result

    def get_active_client(self) -> KotakNeoClient:
        """Return KotakNeoClient for current active account."""
        if self.active_id in self.clients:
            return self.clients[self.active_id]
        if self.clients:
            first_id = next(iter(self.clients.keys()))
            return self.clients[first_id]
        # Fallback to fresh client
        return KotakNeoClient()

    def get_client(self, acc_id: str) -> Optional[KotakNeoClient]:
        return self.clients.get(acc_id)

    def set_active_account(self, acc_id: str) -> bool:
        """Set active account by id."""
        found = False
        for acc in self.accounts:
            if acc["id"] == acc_id:
                acc["is_active"] = True
                self.active_id = acc_id
                found = True
            else:
                acc["is_active"] = False
        if found:
            self.save_accounts()
        return found

    def add_account(self, data: Dict[str, Any]) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """Add a new Kotak Neo account."""
        ucc = (data.get("ucc") or "").strip().upper()
        if not ucc:
            return False, "Kotak Client Code (UCC) is required.", None

        # Generate unique ID
        existing_ids = {a["id"] for a in self.accounts}
        idx = 1
        while f"acc_{idx}" in existing_ids:
            idx += 1
        new_id = f"acc_{idx}"

        totp_sec = (data.get("totp_secret") or "").strip().replace(" ", "").upper()
        if len(totp_sec) == 6 and totp_sec.isdigit():
            # User entered temporary 6-digit OTP instead of permanent secret key
            totp_sec = ""

        new_acc = {
            "id": new_id,
            "name": (data.get("name") or f"Account {len(self.accounts) + 1} ({ucc})").strip(),
            "ucc": ucc,
            "access_token": (data.get("access_token") or "").strip(),
            "mobile": (data.get("mobile") or "").strip(),
            "mpin": (data.get("mpin") or "").strip(),
            "totp_secret": totp_sec,
            "is_active": len(self.accounts) == 0,
            "created_at": int(time.time()),
        }

        self.accounts.append(new_acc)
        self._init_client(new_acc)
        if len(self.accounts) == 1:
            self.active_id = new_id

        self.save_accounts()
        return True, f"Account {new_acc['name']} added successfully.", new_acc

    def update_account(self, acc_id: str, data: Dict[str, Any]) -> Tuple[bool, str]:
        """Update existing account details."""
        target = next((a for a in self.accounts if a["id"] == acc_id), None)
        if not target:
            return False, f"Account {acc_id} not found."

        if "name" in data and data["name"].strip():
            target["name"] = data["name"].strip()
        if "ucc" in data and data["ucc"].strip():
            target["ucc"] = data["ucc"].strip().upper()
        if "access_token" in data and data["access_token"].strip() and not data["access_token"].startswith("***"):
            target["access_token"] = data["access_token"].strip()
        if "mobile" in data and data["mobile"].strip():
            target["mobile"] = data["mobile"].strip()
        if "mpin" in data and data["mpin"].strip() and not data["mpin"].startswith("***"):
            target["mpin"] = data["mpin"].strip()
        if "totp_secret" in data and data["totp_secret"].strip() and not data["totp_secret"].startswith("***"):
            target["totp_secret"] = data["totp_secret"].strip().replace(" ", "").upper()

        self._init_client(target)
        self.save_accounts()
        return True, f"Account {target['name']} updated successfully."

    def delete_account(self, acc_id: str) -> Tuple[bool, str]:
        """Delete an account."""
        if len(self.accounts) <= 1:
            return False, "Cannot delete the only configured account."

        target = next((a for a in self.accounts if a["id"] == acc_id), None)
        if not target:
            return False, f"Account {acc_id} not found."

        self.accounts = [a for a in self.accounts if a["id"] != acc_id]
        if acc_id in self.clients:
            del self.clients[acc_id]

        if self.active_id == acc_id and self.accounts:
            self.accounts[0]["is_active"] = True
            self.active_id = self.accounts[0]["id"]

        self.save_accounts()
        return True, "Account deleted successfully."

    def login_account(self, acc_id: str, mobile: str = "", mpin: str = "", totp: str = "") -> Tuple[bool, str]:
        """Authenticate a single account."""
        acc = next((a for a in self.accounts if a["id"] == acc_id), None)
        if not acc:
            return False, f"Account {acc_id} not found."

        client = self.clients.get(acc_id)
        if not client:
            client = self._init_client(acc)

        mob = mobile or acc.get("mobile", "")
        pin = mpin or acc.get("mpin", "")
        t_code = totp.strip() if totp else ""

        success, msg = client.login(mobile=mob, mpin=pin, totp=t_code)
        return success, msg

    def login_all(self) -> Dict[str, Any]:
        """Attempt automated login for all accounts that have MPIN & TOTP secret."""
        results = []
        for acc in self.accounts:
            acc_id = acc["id"]
            client = self.clients.get(acc_id)
            if not client:
                client = self._init_client(acc)

            name = acc.get("name", acc_id)
            ucc = acc.get("ucc", "")

            # If already authenticated, mark success
            if client.is_authenticated():
                results.append({
                    "id": acc_id,
                    "name": name,
                    "ucc": ucc,
                    "success": True,
                    "message": "Already authenticated",
                    "status": "online"
                })
                continue

            success, msg = client.login()
            results.append({
                "id": acc_id,
                "name": name,
                "ucc": ucc,
                "success": success,
                "message": msg,
                "status": "online" if success else "failed"
            })

        return {
            "status": "success",
            "results": results,
            "all_authenticated": all(r["success"] for r in results)
        }

    def place_order_multi(
        self,
        mode: str,
        account_ids: Optional[List[str]],
        order_params: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Place order across single account, specific accounts, or ALL accounts.
        mode: 'active' | 'all' | 'custom'
        """
        targets = []
        if mode == "all":
            targets = [acc["id"] for acc in self.accounts]
        elif mode == "custom" and account_ids:
            targets = account_ids
        else:
            targets = [self.active_id]

        results = []
        for aid in targets:
            acc = next((a for a in self.accounts if a["id"] == aid), None)
            client = self.clients.get(aid)
            name = acc.get("name", aid) if acc else aid
            ucc = acc.get("ucc", "") if acc else ""

            if not client:
                results.append({
                    "account_id": aid,
                    "name": name,
                    "ucc": ucc,
                    "success": False,
                    "message": "Client not initialized"
                })
                continue

            if not client.is_authenticated():
                results.append({
                    "account_id": aid,
                    "name": name,
                    "ucc": ucc,
                    "success": False,
                    "message": f"Account {name} ({ucc}) is not logged in. Please login first."
                })
                continue

            success, msg, order_id = client.place_order(
                symbol=order_params.get("symbol"),
                exchange=order_params.get("exchange", "NFO"),
                side=order_params.get("side", "BUY"),
                product=order_params.get("product", "MIS"),
                order_type=order_params.get("order_type", "MARKET"),
                quantity=int(order_params.get("quantity", 0)),
                price=float(order_params.get("price", 0.0)),
                trigger_price=float(order_params.get("trigger_price", 0.0)),
            )

            results.append({
                "account_id": aid,
                "name": name,
                "ucc": ucc,
                "success": success,
                "message": msg,
                "order_id": order_id
            })

        return results
