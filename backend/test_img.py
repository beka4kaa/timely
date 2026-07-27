import os, sys, django
sys.path.append('.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from ai_engine.image_enrichment import _call_image_api
try:
    print(_call_image_api("a cube"))
except Exception as e:
    print("ERROR:", e)
