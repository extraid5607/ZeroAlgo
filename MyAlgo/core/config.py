import os
from pathlib import Path
from dotenv import load_dotenv

# Base paths
BASE_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BASE_DIR.parent

# Load .env from MyAlgo if present, otherwise from root project
myalgo_env = BASE_DIR / ".env"
root_env = ROOT_DIR / ".env"
root_env_my = ROOT_DIR / ".env my"

if myalgo_env.exists():
    load_dotenv(myalgo_env)
if root_env.exists():
    load_dotenv(root_env)
if root_env_my.exists():
    load_dotenv(root_env_my)

# Kotak Neo credentials
KOTAK_UCC = os.getenv("UCC") or os.getenv("BROKER_API_KEY", "")
KOTAK_ACCESS_TOKEN = os.getenv("CONSUMER_KEY") or os.getenv("BROKER_API_SECRET", "")
MOBILE_NUMBER = os.getenv("MOBILE_NUMBER", "")
MPIN = os.getenv("MPIN", "")
TOTP_SECRET = os.getenv("TOTP_SECRET", "")

# SQLite Database path for Symbol Master (standalone & root support)
local_db = BASE_DIR / "db" / "openalgo.db"
root_db = ROOT_DIR / "db" / "openalgo.db"

if os.getenv("DB_PATH"):
    DB_PATH = Path(os.getenv("DB_PATH"))
elif local_db.exists():
    DB_PATH = local_db
elif root_db.exists():
    DB_PATH = root_db
else:
    DB_PATH = local_db
SESSION_FILE = BASE_DIR / "session.json"
SETTINGS_FILE = BASE_DIR / "settings.json"

STATIC_IP = os.getenv("STATIC_IP", "")
PROXY_URL = os.getenv("PROXY_URL", "") or os.getenv("HTTP_PROXY", "") or os.getenv("HTTPS_PROXY", "")
