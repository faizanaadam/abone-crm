-- ==============================================================================
-- Abone Surgicals CRM - Admin User Management Database Migration
-- Run this in your Supabase SQL Editor first.
-- ==============================================================================

-- 1. Add email column to profiles if not exists
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. Update the new user trigger function to include email
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, role, email)
  VALUES (new.id, 'rep', new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Backfill any existing profiles with their emails from auth.users
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

-- 4. Create function to create a new rep user securely
CREATE OR REPLACE FUNCTION public.create_rep_user(
    p_email TEXT,
    p_password TEXT,
    p_zone_id TEXT,
    p_first_name TEXT,
    p_last_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_user_id UUID;
    v_encrypted_password TEXT;
BEGIN
    -- Check if caller is admin
    IF public.get_user_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only administrators can create users.';
    END IF;

    -- Check if email already exists
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
        RAISE EXCEPTION 'User with this email already exists.';
    END IF;

    -- Generate UUID and encrypt password using gen_salt (pgcrypto)
    v_user_id := gen_random_uuid();
    v_encrypted_password := crypt(p_password, gen_salt('bf', 10));

    -- Insert into auth.users
    INSERT INTO auth.users (
        id,
        instance_id,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        aud,
        role,
        created_at,
        updated_at,
        phone,
        is_sso_user
    ) VALUES (
        v_user_id,
        '00000000-0000-0000-0000-000000000000',
        p_email,
        v_encrypted_password,
        now(),
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        '{}'::jsonb,
        'authenticated',
        'authenticated',
        now(),
        now(),
        '',
        false
    );

    -- Insert into auth.identities
    INSERT INTO auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at,
        provider_id
    ) VALUES (
        v_user_id,
        v_user_id,
        json_build_object('sub', v_user_id, 'email', p_email)::jsonb,
        'email',
        now(),
        now(),
        now(),
        p_email
    );

    -- Update profiles (first_name, last_name, and zone_id)
    UPDATE public.profiles
    SET 
        role = 'rep',
        assigned_zone_id = p_zone_id,
        first_name = p_first_name,
        last_name = p_last_name
    WHERE id = v_user_id;

    RETURN v_user_id;
END;
$$;

-- 5. Create function to reset a rep user password
CREATE OR REPLACE FUNCTION public.admin_reset_password(
    p_user_id UUID,
    p_new_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
    -- Check if caller is admin
    IF public.get_user_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only administrators can reset passwords.';
    END IF;

    -- Update auth.users password
    UPDATE auth.users
    SET encrypted_password = crypt(p_new_password, gen_salt('bf', 10)),
        updated_at = now()
    WHERE id = p_user_id;

    RETURN TRUE;
END;
$$;

-- 6. Create function to delete a user securely
CREATE OR REPLACE FUNCTION public.admin_delete_user(
    p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
    -- Check if caller is admin
    IF public.get_user_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only administrators can delete users.';
    END IF;

    -- Delete from auth.users (cascades to identities and profiles)
    DELETE FROM auth.users WHERE id = p_user_id;

    RETURN TRUE;
END;
$$;
