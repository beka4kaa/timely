import os, sys, django, requests, json
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("OPENROUTER_API_KEY")

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}
payload = {
    "model": "google/gemini-pro-image",
    "messages": [{"role": "user", "content": "a cube"}]
}
resp = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload)
print(json.dumps(resp.json(), indent=2, ensure_ascii=False))
