CREATE TABLE public.pending_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id UUID REFERENCES public.doctors(id) ON DELETE CASCADE,
    location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE, -- Optional, if edit is location-specific
    suggested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    new_data JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.pending_edits ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users (Reps) can insert their own suggestions
CREATE POLICY "Reps can insert their own suggestions" 
ON public.pending_edits 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = suggested_by);

-- Policy: Authenticated users (Reps) can view their own suggestions
CREATE POLICY "Reps can view their own suggestions" 
ON public.pending_edits 
FOR SELECT 
TO authenticated 
USING (auth.uid() = suggested_by);

-- (Note: An admin policy to view/update all suggestions will be needed later when building the Admin UI)
