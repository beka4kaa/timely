import os, sys, django, requests, json
from dotenv import load_dotenv

sys.path.append('.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from ai_engine.image_enrichment import _API_KEY, _API_URL, _TIER, _MODEL
from django.conf import settings

headers = {
    "Authorization": f"Bearer {_API_KEY}",
    "Content-Type": "application/json",
    "X-OR-Provider-Tier": _TIER,
    "HTTP-Referer": "https://timelyplan.me",
    "X-Title": "Timely AI Tutor Board",
}

payload = {
    "model": _MODEL,
    "modalities": ["image", "text"],
    "messages": [
        {
            "role": "user",
            "content": "a cube. Scientific illustration style, clean white background, no text labels, no watermarks, educational diagram."
        }
    ]
}

resp = requests.post(_API_URL, headers=headers, json=payload)
print("STATUS:", resp.status_code)
print(json.dumps(resp.json(), indent=2, ensure_ascii=False))
