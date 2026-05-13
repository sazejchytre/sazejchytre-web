-- ============================================================
-- SázejChytře - Migration 003: Rename plans FREE/START/SMART/ELITE
-- ============================================================
-- Run in Supabase SQL Editor
-- ============================================================

-- Step 1: Rename enum values basic→start, pro→smart
ALTER TYPE public.plan_type RENAME VALUE 'basic' TO 'start';
ALTER TYPE public.plan_type RENAME VALUE 'pro' TO 'smart';

-- Step 2: Add free_tip_used tracking to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS free_tip_used BOOLEAN NOT NULL DEFAULT FALSE;

-- Step 3: Update has_plan_access with new hierarchy (elite > smart > start)
CREATE OR REPLACE FUNCTION public.has_plan_access(required_plan public.plan_type)
RETURNS BOOLEAN AS $$
DECLARE
  user_plan public.plan_type;
  is_active BOOLEAN;
  valid_time TIMESTAMPTZ;
BEGIN
  IF public.is_admin() THEN
    RETURN TRUE;
  END IF;

  SELECT plan, active, valid_until
  INTO user_plan, is_active, valid_time
  FROM public.user_entitlements
  WHERE user_id = auth.uid();

  IF NOT FOUND OR NOT is_active THEN
    RETURN FALSE;
  END IF;

  IF valid_time IS NOT NULL AND valid_time < NOW() THEN
    RETURN FALSE;
  END IF;

  RETURN CASE required_plan
    WHEN 'start' THEN user_plan IN ('start', 'smart', 'elite')
    WHEN 'smart' THEN user_plan IN ('smart', 'elite')
    WHEN 'elite' THEN user_plan = 'elite'
    ELSE FALSE
  END;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
