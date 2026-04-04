import asyncio
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from bot import TradingBot

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

bot = TradingBot()
bot_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global bot_task
    bot_task = asyncio.create_task(bot.run_loop(interval=10))
    logger.info("Bot background loop started")
    yield
    bot.stop()
    if bot_task:
        bot_task.cancel()
        try:
            await bot_task
        except asyncio.CancelledError:
            pass
    logger.info("Bot stopped")


app = FastAPI(title="Crypto Trading Bot", version="1.0.0", lifespan=lifespan)

# Origins allowed to call the API.
# In production set ALLOWED_ORIGINS=https://your-app.vercel.app on Railway.
# The local dev origins are always included so the frontend works out of the box.
_env_origins = os.getenv("ALLOWED_ORIGINS", "")
_extra = [o.strip() for o in _env_origins.split(",") if o.strip()]
allowed_origins = list(
    {
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        *_extra,
    }
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"status": "ok", "message": "Crypto Trading Bot API"}


@app.get("/status")
def get_status():
    return {"assets": bot.get_status()}


@app.get("/health")
def health():
    return {"healthy": True}
