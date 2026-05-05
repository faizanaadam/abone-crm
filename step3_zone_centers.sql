-- ==============================================================================
-- Step 1: Zone Centers — Add center coordinates to the zones table
-- Run this in the Supabase SQL Editor.
-- ==============================================================================

-- 1. Add the new columns
ALTER TABLE public.zones 
ADD COLUMN IF NOT EXISTS center_lat NUMERIC,
ADD COLUMN IF NOT EXISTS center_lng NUMERIC;

-- 2. Update each zone with its geographic center.
--    IMPORTANT: Run this query first to see your zone IDs and names:
--
--    SELECT id, name FROM public.zones ORDER BY id;
--
--    Then update the WHERE clauses below to match YOUR actual zone IDs.
--    The coordinates below are accurate central points for major Bangalore areas.

-- ── Bangalore Zone Centers (Update the id values to match yours) ──────────────

-- Indiranagar / East Central
UPDATE public.zones SET center_lat = 12.9784, center_lng = 77.6408 WHERE name ILIKE '%Indiranagar%';

-- Whitefield / East
UPDATE public.zones SET center_lat = 12.9698, center_lng = 77.7500 WHERE name ILIKE '%Whitefield%';

-- Koramangala / South East
UPDATE public.zones SET center_lat = 12.9352, center_lng = 77.6245 WHERE name ILIKE '%Koramangala%';

-- Jayanagar / South
UPDATE public.zones SET center_lat = 12.9308, center_lng = 77.5838 WHERE name ILIKE '%Jayanagar%';

-- Rajajinagar / North West
UPDATE public.zones SET center_lat = 12.9900, center_lng = 77.5550 WHERE name ILIKE '%Rajajinagar%';

-- Malleshwaram / North
UPDATE public.zones SET center_lat = 13.0035, center_lng = 77.5700 WHERE name ILIKE '%Malleshwaram%';

-- BTM Layout / South
UPDATE public.zones SET center_lat = 12.9166, center_lng = 77.6101 WHERE name ILIKE '%BTM%';

-- HSR Layout / South East
UPDATE public.zones SET center_lat = 12.9121, center_lng = 77.6446 WHERE name ILIKE '%HSR%';

-- Electronic City / Far South
UPDATE public.zones SET center_lat = 12.8456, center_lng = 77.6603 WHERE name ILIKE '%Electronic%';

-- Hebbal / North
UPDATE public.zones SET center_lat = 13.0358, center_lng = 77.5970 WHERE name ILIKE '%Hebbal%';

-- Bannerghatta / South
UPDATE public.zones SET center_lat = 12.8879, center_lng = 77.5969 WHERE name ILIKE '%Bannerghatta%';

-- JP Nagar / South
UPDATE public.zones SET center_lat = 12.9063, center_lng = 77.5857 WHERE name ILIKE '%JP Nagar%';

-- Yelahanka / Far North
UPDATE public.zones SET center_lat = 13.1005, center_lng = 77.5963 WHERE name ILIKE '%Yelahanka%';

-- Marathahalli / East
UPDATE public.zones SET center_lat = 12.9591, center_lng = 77.6974 WHERE name ILIKE '%Marathahalli%';

-- Banashankari / South West
UPDATE public.zones SET center_lat = 12.9255, center_lng = 77.5468 WHERE name ILIKE '%Banashankari%';

-- MG Road / Central
UPDATE public.zones SET center_lat = 12.9758, center_lng = 77.6063 WHERE name ILIKE '%MG Road%' OR name ILIKE '%Central%';

-- Peenya / North West Industrial
UPDATE public.zones SET center_lat = 13.0300, center_lng = 77.5200 WHERE name ILIKE '%Peenya%';

-- KR Puram / East
UPDATE public.zones SET center_lat = 13.0070, center_lng = 77.6960 WHERE name ILIKE '%KR Puram%';

-- ── FALLBACK: Set any remaining zones without centers to Bangalore city center ──
UPDATE public.zones 
SET center_lat = 12.9716, center_lng = 77.5946 
WHERE center_lat IS NULL OR center_lng IS NULL;

-- 3. Verify the update
SELECT id, name, center_lat, center_lng FROM public.zones ORDER BY id;
