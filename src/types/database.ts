export type UserRole = 'user' | 'admin' | 'super_admin'
export type PlanType = 'start' | 'smart' | 'elite'
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused'
export type TipStatus = 'draft' | 'published' | 'won' | 'lost' | 'void'
export type TipResult = 'pending' | 'won' | 'lost' | 'void' | 'half_won' | 'half_lost'
export type LocaleType = 'cs' | 'en' | 'sk'
export type EntitlementSource = 'stripe' | 'manual' | 'trial'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: UserRole
  locale: LocaleType
  free_tip_used: boolean
  created_at: string
  updated_at: string
}

export interface Subscription {
  id: string
  user_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan: PlanType | null
  status: SubscriptionStatus
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  updated_at: string
}

export interface Category {
  id: string
  slug: string
  created_at: string
  updated_at: string
  translations?: CategoryTranslation[]
}

export interface CategoryTranslation {
  id: string
  category_id: string
  locale: LocaleType
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface Tip {
  id: string
  sport: string
  category_id: string | null
  required_plan: PlanType
  odds: number | null
  confidence: number | null
  match_date: string | null
  status: TipStatus
  result: TipResult
  created_by: string
  created_at: string
  updated_at: string
  published_at: string | null
  translations?: TipTranslation[]
  category?: Category
}

export interface TipTranslation {
  id: string
  tip_id: string
  locale: LocaleType
  title: string
  summary: string | null
  analysis: string | null
  prediction: string
  created_at: string
  updated_at: string
}

export interface UserEntitlement {
  id: string
  user_id: string
  plan: PlanType
  active: boolean
  source: EntitlementSource
  valid_until: string | null
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: string
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  metadata: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export interface StripeEvent {
  id: string
  stripe_event_id: string
  type: string
  processed: boolean
  payload: Record<string, unknown>
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: {
          id: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          role?: UserRole
          locale?: LocaleType
          free_tip_used?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          email?: string
          full_name?: string | null
          avatar_url?: string | null
          role?: UserRole
          locale?: LocaleType
          free_tip_used?: boolean
          updated_at?: string
        }
      }
      subscriptions: {
        Row: Subscription
        Insert: {
          id?: string
          user_id: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          plan?: PlanType | null
          status?: SubscriptionStatus
          current_period_start?: string | null
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          plan?: PlanType | null
          status?: SubscriptionStatus
          current_period_start?: string | null
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          updated_at?: string
        }
      }
      tips: {
        Row: {
          id: string
          sport: string
          category_id: string | null
          required_plan: PlanType
          odds: number | null
          confidence: number | null
          match_date: string | null
          status: TipStatus
          result: TipResult
          created_by: string
          created_at: string
          updated_at: string
          published_at: string | null
        }
        Insert: {
          id?: string
          sport: string
          category_id?: string | null
          required_plan?: PlanType
          odds?: number | null
          confidence?: number | null
          match_date?: string | null
          status?: TipStatus
          result?: TipResult
          created_by: string
          created_at?: string
          updated_at?: string
          published_at?: string | null
        }
        Update: {
          sport?: string
          category_id?: string | null
          required_plan?: PlanType
          odds?: number | null
          confidence?: number | null
          match_date?: string | null
          status?: TipStatus
          result?: TipResult
          published_at?: string | null
          updated_at?: string
        }
      }
      tip_translations: {
        Row: TipTranslation
        Insert: {
          id?: string
          tip_id: string
          locale: LocaleType
          title: string
          summary?: string | null
          analysis?: string | null
          prediction: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string
          summary?: string | null
          analysis?: string | null
          prediction?: string
          updated_at?: string
        }
      }
      categories: {
        Row: {
          id: string
          slug: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          slug: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          slug?: string
          updated_at?: string
        }
      }
      category_translations: {
        Row: CategoryTranslation
        Insert: {
          id?: string
          category_id: string
          locale: LocaleType
          name: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          updated_at?: string
        }
      }
      user_entitlements: {
        Row: UserEntitlement
        Insert: {
          id?: string
          user_id: string
          plan: PlanType
          active?: boolean
          source?: EntitlementSource
          valid_until?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          plan?: PlanType
          active?: boolean
          source?: EntitlementSource
          valid_until?: string | null
          updated_at?: string
        }
      }
      audit_logs: {
        Row: AuditLog
        Insert: {
          id?: string
          actor_id?: string | null
          action: string
          entity_type: string
          entity_id?: string | null
          metadata?: Record<string, unknown> | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Update: Record<string, never>
      }
      stripe_events: {
        Row: StripeEvent
        Insert: {
          id?: string
          stripe_event_id: string
          type: string
          processed?: boolean
          payload: Record<string, unknown>
          created_at?: string
        }
        Update: {
          processed?: boolean
        }
      }
    }
    Functions: {
      is_admin: { Args: Record<never, never>; Returns: boolean }
      is_super_admin: { Args: Record<never, never>; Returns: boolean }
      has_plan_access: { Args: { required_plan: PlanType }; Returns: boolean }
      get_user_role: { Args: { user_id: string }; Returns: UserRole }
    }
  }
}
