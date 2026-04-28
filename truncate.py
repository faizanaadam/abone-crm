import requests
import time

KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpydmdoY3h0cnBkbXloZ2p5cG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDA4ODIsImV4cCI6MjA5MjY3Njg4Mn0.UVlzfHUnkpWQPt-RAmK9m2cpoX20GQNsEPs9m1w8bto'
H = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Prefer': 'return=minimal'}
URL = 'https://jrvghcxtrpdmyhgjypms.supabase.co/rest/v1'

print("Deleting ALL doctors (id is not null)...")
r = requests.delete(f'{URL}/doctors?id=not.is.null', headers=H)
print(f"  Status: {r.status_code}")

# Verify
time.sleep(1)
r2 = requests.get(f'{URL}/doctors?select=id', headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Prefer': 'count=exact', 'Range': '0-0'})
remaining = r2.headers.get('content-range', 'unknown')
print(f"  Remaining after delete: {remaining}")

if '/' in remaining:
    count = int(remaining.split('/')[1])
    if count > 0:
        print(f"  Still {count} left, trying again...")
        r3 = requests.delete(f'{URL}/doctors?id=not.is.null', headers=H)
        print(f"  Second delete status: {r3.status_code}")
        time.sleep(1)
        r4 = requests.get(f'{URL}/doctors?select=id', headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Prefer': 'count=exact', 'Range': '0-0'})
        print(f"  Now remaining: {r4.headers.get('content-range')}")
