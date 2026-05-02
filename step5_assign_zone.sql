-- To assign a zone, we just update the assigned_zone_id column in the profiles table.
-- First, find the exact ID of the zone you want from the zones table.
-- For example, if the zone 'Central Zone' has the id 'ZONE_CEN', you would run:

-- UPDATE public.profiles
-- SET assigned_zone_id = 'ZONE_CEN'
-- WHERE first_name = 'John Doe'; -- Or filter by id / email

-- Here is a helper query to see all your users and their current zones:
SELECT p.id, p.role, p.assigned_zone_id, au.email 
FROM public.profiles p
JOIN auth.users au ON p.id = au.id;

-- And here is a query to see all available zones:
SELECT id, name FROM public.zones;
