import subprocess
import sys

print("Starting geocoding (this will take 20-25 mins)...")
p1 = subprocess.run([sys.executable, "geocode_and_cluster.py"])
if p1.returncode != 0:
    print("Geocoding failed.")
    sys.exit(1)

print("Geocoding complete. Now seeding Supabase...")
p2 = subprocess.run([sys.executable, "seed_supabase.py"])
if p2.returncode != 0:
    print("Seeding failed.")
    sys.exit(1)

print("Pipeline finished successfully.")
