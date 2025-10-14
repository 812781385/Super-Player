import base64
import json
import random
import socket
import logging
from typing import Dict, Any, Optional, List
from binascii import hexlify

import requests
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from bs4 import BeautifulSoup
from Crypto.Cipher import AES
import uvicorn
import os

# ======================
# 配置与日志
# ======================
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("netease_music_proxy")

# 动态获取服务器 IP（但建议在生产环境通过环境变量指定）
def get_server_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"

SERVER_HOST = "0.0.0.0"
SERVER_PORT = int(os.getenv("PORT", 9090))
PUBLIC_HOST = os.getenv("PUBLIC_HOST", get_server_ip())  # 支持外部指定公网地址
PUBLIC_URL = f"http://{PUBLIC_HOST}:{SERVER_PORT}"

# ======================
# 网易云音乐 API 封装
# ======================
class NeteaseMusicAPI:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://music.163.com/',
            'Origin': 'https://music.163.com'
        })
        self.urls = {
            'search': 'https://interface.music.163.com/weapi/search/get',
            'lyric': 'https://music.163.com/weapi/song/lyric',
            'toplist': 'https://music.163.com/discover/toplist'
        }

    def _encrypt_data(self, data: Dict[str, Any]) -> Dict[str, str]:
        """加密请求参数（模拟网易云 Web 端）"""
        d = json.dumps(data, separators=(',', ':'))
        e = '010001'
        f = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7'
        g = '0CoJUm6Qyw8W8jud'
        i = self._random_str(16)

        def _aes_encrypt(text: str, key: str) -> str:
            iv = b'0102030405060708'
            pad = 16 - len(text) % 16
            text += chr(pad) * pad
            cipher = AES.new(key.encode(), AES.MODE_CBC, iv)
            return base64.b64encode(cipher.encrypt(text.encode())).decode()

        params = _aes_encrypt(d, g)
        params = _aes_encrypt(params, i)
        enc_sec_key = self._rsa_encrypt(i, e, f)
        return {'params': params, 'encSecKey': enc_sec_key}

    @staticmethod
    def _random_str(length: int = 16) -> str:
        chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        return ''.join(random.choice(chars) for _ in range(length))

    @staticmethod
    def _rsa_encrypt(text: str, pub_key: str, modulus: str) -> str:
        text = text[::-1]
        rs = pow(int(hexlify(text.encode()), 16), int(pub_key, 16), int(modulus, 16))
        return format(rs, 'x').zfill(131)

    def search_songs(self, keyword: str, limit: int = 30) -> List[Dict[str, Any]]:
        try:
            payload = {'s': keyword, 'type': 1, 'limit': limit, 'offset': 0}
            encrypted = self._encrypt_data(payload)
            resp = self.session.post(self.urls['search'], data=encrypted, timeout=5)
            resp.raise_for_status()
            result = resp.json().get('result', {}).get('songs', [])
            songs = []
            for song in result:
                if song.get('fee') != 1:  # 过滤收费歌曲
                    song['music_url'] = f"{PUBLIC_URL}/playMusic?id={song['id']}"
                    songs.append(song)
            return songs
        except Exception as e:
            logger.error(f"Search error: {e}")
            return []

    def get_lyric(self, song_id: int) -> Optional[Dict[str, Any]]:
        try:
            payload = {'id': song_id, 'lv': -1, 'tv': -1}
            encrypted = self._encrypt_data(payload)
            resp = self.session.post(self.urls['lyric'], data=encrypted, timeout=5)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f"Lyric error for {song_id}: {e}")
            return None

    def get_hot_list(self) -> List[Dict[str, Any]]:
        try:
            resp = self.session.get(self.urls['toplist'])
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")
            textarea = soup.find("textarea", {"id": "song-list-pre-data"})
            if not textarea:
                return []
            data = json.loads(textarea.get_text(strip=True))
            songs = []
            for item in data:
                if item.get('fee') != 1:
                    songs.append({
                        "id": item["id"],
                        "name": item["name"],
                        "music_url": f"{PUBLIC_URL}/playMusic?id={item['id']}",
                        "artists": item.get("artists", []),
                        "album": item.get("album", {}),
                        "duration": item.get("duration", 0),
                        "copyrightId": item.get("copyrightId", 0),
                        "status": item.get("status", 0),
                    })
            return songs
        except Exception as e:
            logger.error(f"Hotlist error: {e}")
            return []

# ======================
# FastAPI 应用
# ======================
app = FastAPI(
    title="Netease Music Proxy API",
    description="Proxy for Netease Music with search, lyric, hotlist and streaming."
)

# CORS 配置（生产环境应限制 origin）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局实例（单例）
music_api = NeteaseMusicAPI()

# 统一响应格式
def success_response(data: Any) -> Dict[str, Any]:
    return {"code": 0, "data": data, "msg": "成功"}

def error_response(msg: str = "参数错误") -> Dict[str, Any]:
    return {"code": 1, "data": {}, "msg": msg}

@app.get("/getKeyword")
async def get_keyword(name: str = Query(..., min_length=1)):
    songs = music_api.search_songs(name)
    return success_response(songs)

@app.get("/getLyric")
async def get_lyric(id: int = Query(..., gt=0)):
    lyric = music_api.get_lyric(id)
    return success_response(lyric or {})

@app.get("/getHotList")
async def get_hot_list():
    songs = music_api.get_hot_list()
    return success_response(songs)

@app.get("/playMusic")
async def play_music(id: int = Query(..., gt=0)):
    url = f"https://music.163.com/song/media/outer/url?id={id}.mp3"
    logger.info(f"Fetching audio: {url}")
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                logger.warning(f"Audio fetch failed: {resp.status_code} for {url}")
                raise HTTPException(status_code=404, detail="Audio not found or unavailable")
            
            return StreamingResponse(
                resp.aiter_bytes(),
                media_type="audio/mpeg",
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "public, max-age=86400"
                }
            )
    except httpx.RequestError as e:
        logger.error(f"Network error fetching audio: {e}")
        raise HTTPException(status_code=502, detail="Upstream request failed")
    except Exception as e:
        logger.exception("Unexpected error in play_music")
        raise HTTPException(status_code=500, detail="Internal server error")

# ======================
# 启动
# ======================
if __name__ == "__main__":
    logger.info(f"Starting server on {SERVER_HOST}:{SERVER_PORT}")
    logger.info(f"Public URL base: {PUBLIC_URL}")
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT)