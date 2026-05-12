-- ============================================================
-- SázejChytře - Row Level Security Policies
-- ============================================================
-- CRITICAL: All RLS must be enabled and verified before production.
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tip_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PROFILES POLICIES
-- ============================================================

-- Users can read their own profile
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- Admins can read all profiles
CREATE POLICY "profiles_select_admin" ON public.profiles
  FOR SELECT USING (public.is_admin());

-- Users can update their own profile (but NOT role)
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- Prevent role escalation: user cannot change their own role
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

-- Super admin can update any profile (including role changes)
CREATE POLICY "profiles_update_super_admin" ON public.profiles
  FOR UPDATE USING (public.is_super_admin());

-- No direct inserts from client (handled by trigger)
-- Service role handles inserts via trigger

-- ============================================================
-- SUBSCRIPTIONS POLICIES
-- ============================================================

-- Users can read their own subscription
CREATE POLICY "subscriptions_select_own" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Admins can read all subscriptions
CREATE POLICY "subscriptions_select_admin" ON public.subscriptions
  FOR SELECT USING (public.is_admin());

-- No direct insert/update from client - handled by webhook server-side
-- Service role handles subscription upserts via webhook

-- ============================================================
-- TIPS POLICIES
-- ============================================================

-- Anyone can read published tips metadata (but not full content if plan-restricted)
-- Full content access is controlled in app layer + entitlements check
CREATE POLICY "tips_select_published" ON public.tips
  FOR SELECT USING (
    status = 'published'
    AND public.has_plan_access(required_plan)
  );

-- Admins can read all tips (including drafts)
CREATE POLICY "tips_select_admin" ON public.tips
  FOR SELECT USING (public.is_admin());

-- Admins can insert tips
CREATE POLICY "tips_insert_admin" ON public.tips
  FOR INSERT WITH CHECK (public.is_admin());

-- Admins can update tips
CREATE POLICY "tips_update_admin" ON public.tips
  FOR UPDATE USING (public.is_admin());

-- Admins can delete tips
CREATE POLICY "tips_delete_admin" ON public.tips
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- TIP TRANSLATIONS POLICIES
-- ============================================================

CREATE POLICY "tip_translations_select_published" ON public.tip_translations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tips t
      WHERE t.id = tip_id
      AND t.status = 'published'
      AND public.has_plan_access(t.required_plan)
    )
  );

CREATE POLICY "tip_translations_select_admin" ON public.tip_translations
  FOR SELECT USING (public.is_admin());

CREATE POLICY "tip_translations_insert_admin" ON public.tip_translations
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "tip_translations_update_admin" ON public.tip_translations
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "tip_translations_delete_admin" ON public.tip_translations
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- CATEGORIES POLICIES
-- ============================================================

-- Everyone can read categories
CREATE POLICY "categories_select_all" ON public.categories
  FOR SELECT USING (TRUE);

-- Only admins can manage categories
CREATE POLICY "categories_insert_admin" ON public.categories
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "categories_update_admin" ON public.categories
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "categories_delete_admin" ON public.categories
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- CATEGORY TRANSLATIONS POLICIES
-- ============================================================

CREATE POLICY "category_translations_select_all" ON public.category_translations
  FOR SELECT USING (TRUE);

CREATE POLICY "category_translations_insert_admin" ON public.category_translations
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "category_translations_update_admin" ON public.category_translations
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "category_translations_delete_admin" ON public.category_translations
  FOR DELETE USING (public.is_admin());

-- ============================================================
-- AUDIT LOGS POLICIES
-- ============================================================

-- Only super_admin can read audit logs
CREATE POLICY "audit_logs_select_super_admin" ON public.audit_logs
  FOR SELECT USING (public.is_super_admin());

-- No direct inserts from client - only via service role (server-side)

-- ============================================================
-- STRIPE EVENTS POLICIES
-- ============================================================

-- Only super_admin can read stripe events (for debugging)
CREATE POLICY "stripe_events_select_super_admin" ON public.stripe_events
  FOR SELECT USING (public.is_super_admin());

-- No direct inserts/updates from client - only via service role (webhook)

-- ============================================================
-- USER ENTITLEMENTS POLICIES
-- ============================================================

-- Users can read their own entitlement
CREATE POLICY "user_entitlements_select_own" ON public.user_entitlements
  FOR SELECT USING (auth.uid() = user_id);

-- Admins can read all entitlements
CREATE POLICY "user_entitlements_select_admin" ON public.user_entitlements
  FOR SELECT USING (public.is_admin());

-- No direct inserts/updates from client - only via service role (webhook/server)

-- ============================================================
-- GRANT PERMISSIONS
-- ============================================================

-- Allow authenticated users to call helper functions
GRANT EXECUTE ON FUNCTION public.get_user_role TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_plan_access TO authenticated;
