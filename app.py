import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent / "backend"))
from main import app  # noqa: E402  (Vercel FastAPI entrypoint)
