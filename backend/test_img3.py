import os, sys, django, requests, json
sys.path.append('.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from django.conf import settings

api_key = settings.OPENROUTER_API_KEY
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json",
    "X-OR-Provider-Tier": "standard"
}
payload = {
    "model": "google/gemini-pro-image",
    "modalities": ["image", "text"],
    "messages": [
        {
            "role": "user",
            "content": "a cube"
        }
    ]
}
resp = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload)
print("STATUS:", resp.status_code)
print(json.dumps(resp.json(), indent=2, ensure_ascii=False))
