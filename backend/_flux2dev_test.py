import requests, base64, io, time, json
from PIL import Image

H = "http://100.74.104.27:8003"
body = {
    "prompt": "a single ripe red apple on a plain white table, soft studio lighting, photorealistic",
    "num_inference_steps": 16,
    "width": 768,
    "height": 768,
    "seed": 7,
    "guidance_scale": 3.5,
}
print("POST /api/generate/ …", json.dumps(body))
t = time.time()
r = requests.post(f"{H}/api/generate/", json=body, timeout=900)
dt = time.time() - t
ct = r.headers.get("content-type", "")
print(f"HTTP {r.status_code} | {dt:.1f}s | content-type={ct} | bytes={len(r.content)}")

if r.status_code != 200:
    print("BODY:", r.text[:500])
    raise SystemExit(1)

saved = None
if ct.startswith("image/"):
    Image.open(io.BytesIO(r.content)).save("/tmp/flux2dev.png")
    saved = "raw image bytes"
else:
    d = r.json()
    # ищем base64 или url в типичных полях
    b64 = None
    for k in ("image", "image_base64", "b64_json", "base64", "img"):
        v = d.get(k)
        if isinstance(v, str) and len(v) > 100:
            b64 = v.split(",", 1)[-1]; saved = f"json[{k}]"; break
    if not b64 and isinstance(d.get("images"), list) and d["images"]:
        v = d["images"][0]
        b64 = (v if isinstance(v, str) else v.get("b64_json") or v.get("image", "")).split(",", 1)[-1]
        saved = "json[images][0]"
    if b64:
        Image.open(io.BytesIO(base64.b64decode(b64))).save("/tmp/flux2dev.png")
    else:
        print("?? неизвестный JSON-формат, ключи:", list(d.keys()))
        raise SystemExit(1)

print(f"✓ сохранено /tmp/flux2dev.png  (источник: {saved})")
print("  размер:", Image.open('/tmp/flux2dev.png').size)
