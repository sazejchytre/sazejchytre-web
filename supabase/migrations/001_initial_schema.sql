-- ============================================================
-- SázejChytře - Initial Database Schema
-- ============================================================
-- Run this migration in your Supabase SQL editor.
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE public.user_role AS ENUM ('user', 'admin', 'super_admin');
CREATE TYPE public.plan_type AS ENUM ('basic', 'pro', 'elite');
CREATE TYPE public.subscription_status AS ENUM (
  'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'
);
CREATE TYPE public.tip_status AS ENUM ('draft', 'published', 'won', 'lost', 'void');
CREATE TYPE public.tip_result AS ENUM ('pending', 'won', 'lost', 'void', 'half_won', 'half_lost');
CREATE TYPE public.locale_type AS ENUM ('cs', 'en', 'sk');
CREATE TYPE public.entitlement_source AS ENUM ('stripe', 'manual', 'trial');

-- ============================================================
-- PROFILES TABLE
-- ============================================================

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  role public.user_role NOT NULL DEFAULT 'user',
  locale public.locale_type NOT NULL DEFAULT 'cs',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SUBSCRIPTIONS TABLE
-- ============================================================

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  plan public.plan_type,
  status public.subscription_status NOT NULL DEFAULT 'incomplete',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_customer_id ON public.subscriptions(stripe_customer_id);
CREATE INDEX idx_subscriptions_stripe_subscription_id ON public.subscriptions(stripe_subscription_id);

-- ============================================================
-- CATEGORIES TABLE
-- ============================================================

CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.category_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  locale public.locale_type NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(category_id, locale)
);

CREATE INDEX idx_category_translations_category_id ON public.category_translations(category_id);

-- ============================================================
-- TIPS TABLE
-- ============================================================

CREATE TABLE public.tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  required_plan public.plan_type NOT NULL DEFAULT 'basic',
  odds DECIMAL(8, 2),
  confidence SMALLINT CHECK (confidence >= 1 AND confidence <= 5),
  match_date TIMESTAMPTZ,
  status public.tip_status NOT NULL DEFAULT 'draft',
  result public.tip_result NOT NULL DEFAULT 'pending',
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX idx_tips_status ON public.tips(status);
CREATE INDEX idx_tips_required_plan ON public.tips(required_plan);
CREATE INDEX idx_tips_match_date ON public.tips(match_date);
CREATE INDEX idx_tips_created_by ON public.tips(created_by);
CREATE INDEX idx_tips_published_at ON public.tips(published_at DESC);

CREATE TABLE public.tip_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_id UUID NOT NULL REFERENCES public.tips(id) ON DELETE CASCADE,
  locale public.locale_type NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  analysis TEXT,
  prediction TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tip_id, locale)
);

CREATE INDEX idx_tip_translations_tip_id ON public.tip_translations(tip_id);

-- ============================================================
-- USER ENTITLEMENTS TABLE
-- ============================================================

CREATE TABLE public.user_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan public.plan_type NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source public.entitlement_source NOT NULL DEFAULT 'stripe',
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX idx_user_entitlements_user_id ON public.user_entitlements(user_id);
CREATE INDEX idx_user_entitlements_active ON public.user_entitlements(active);

-- ============================================================
-- AUDIT LOGS TABLE
-- ============================================================

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_actor_id ON public.audit_logs(actor_id);
CREATE INDEX idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX idx_audit_logs_entity_type ON public.audit_logs(entity_type);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- ============================================================
-- STRIPE EVENTS TABLE
-- ============================================================

CREATE TABLE public.stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stripe_events_type ON public.stripe_events(type);
CREATE INDEX idx_stripe_events_processed ON public.stripe_events(processed);
CREATE INDEX idx_stripe_events_stripe_event_id ON public.stripe_events(stripe_event_id);

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trigger_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trigger_categories_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trigger_category_translations_updated_at
  BEFORE UPDATE ON public.category_translations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trigger_tips_updated_at
  BEFORE UPDATE ON public.tips
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trigger_tip_translations_updated_at
  BEFORE UPDATE ON public.tip_translations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trigger_user_entitlements_updated_at
  BEFORE UPDATE ON public.user_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, role, locale)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url',
    'user',
    'cs'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- HELPER FUNCTIONS (used in RLS)
-- ============================================================

-- Get current user's role
CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS public.user_role AS $$
  SELECT role FROM public.profiles WHERE id = user_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if current user is admin or super_admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if current user is super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if user has entitlement for a given plan
CREATE OR REPLACE FUNCTION public.has_plan_access(required_plan public.plan_type)
RETURNS BOOLEAN AS $$
DECLARE
  user_plan public.plan_type;
  is_active BOOLEAN;
  valid_time TIMESTAMPTZ;
BEGIN
  -- Admins and super_admins always have access
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

  -- Check expiry
  IF valid_time IS NOT NULL AND valid_time < NOW() THEN
    RETURN FALSE;
  END IF;

  -- Plan hierarchy: elite > pro > basic
  RETURN CASE required_plan
    WHEN 'basic' THEN user_plan IN ('basic', 'pro', 'elite')
    WHEN 'pro' THEN user_plan IN ('pro', 'elite')
    WHEN 'elite' THEN user_plan = 'elite'
    ELSE FALSE
  END;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- SEED DEFAULT CATEGORIES
-- ============================================================

INSERT INTO public.categories (id, slug) VALUES
  (gen_random_uuid(), 'football'),
  (gen_random_uuid(), 'basketball'),
  (gen_random_uuid(), 'tennis'),
  (gen_random_uuid(), 'hockey'),
  (gen_random_uuid(), 'other');

-- We'll add translations in the seed file
