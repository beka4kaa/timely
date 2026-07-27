import os, sys, django, requests, json
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("OPENROUTER_API_KEY")

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}
prompt = "Простая графическая схема: куб, над которым расположен круг. В центре куба и круга размести соответствующие подписи. Дизайн должен быть минималистичным и понятным. Scientific illustration style, clean white background, no text labels, no watermarks, educational diagram."
payload = {
    "model": "google/gemini-3-pro-image-preview",
    "modalities": ["image", "text"],
    "messages": [
        {
            "role": "user",
            "content": prompt
        }
    ]
}

resp = requests.post("https://openrouter.ai/api/v1/chat/completions", json=payload, headers=headers)
print(resp.status_code)
d = resp.json()['choices'][0]['message']
print(list(d.keys()))
