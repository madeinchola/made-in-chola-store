export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          archived_at: string | null
          city: string
          country: string
          created_at: string
          department: string | null
          for_billing: boolean
          for_shipping: boolean
          id: string
          is_default: boolean
          label: string
          lat: number | null
          line1: string
          line2: string | null
          lng: number | null
          phone_e164: string | null
          profile_id: string
          recipient: string
          reference_text: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          city: string
          country?: string
          created_at?: string
          department?: string | null
          for_billing?: boolean
          for_shipping?: boolean
          id?: string
          is_default?: boolean
          label: string
          lat?: number | null
          line1: string
          line2?: string | null
          lng?: number | null
          phone_e164?: string | null
          profile_id: string
          recipient: string
          reference_text?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          city?: string
          country?: string
          created_at?: string
          department?: string | null
          for_billing?: boolean
          for_shipping?: boolean
          id?: string
          is_default?: boolean
          label?: string
          lat?: number | null
          line1?: string
          line2?: string | null
          lng?: number | null
          phone_e164?: string | null
          profile_id?: string
          recipient?: string
          reference_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "addresses_country_fkey"
            columns: ["country"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "addresses_country_fkey"
            columns: ["country"]
            isOneToOne: false
            referencedRelation: "public_countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "addresses_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          diff: Json
          id: number
          occurred_at: string
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role: string
          diff: Json
          id?: never
          occurred_at?: string
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string
          diff?: Json
          id?: never
          occurred_at?: string
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      blocked_dates: {
        Row: {
          archived_at: string | null
          blocked_on: string
          created_at: string
          id: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          blocked_on: string
          created_at?: string
          id?: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          blocked_on?: string
          created_at?: string
          id?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cart_items: {
        Row: {
          added_at: string
          cart_id: string
          currency: string
          price_locked_until: string
          qty: number
          unit_price_at_add: number
          updated_at: string
          variant_id: string
        }
        Insert: {
          added_at?: string
          cart_id: string
          currency: string
          price_locked_until: string
          qty: number
          unit_price_at_add: number
          updated_at?: string
          variant_id: string
        }
        Update: {
          added_at?: string
          cart_id?: string
          currency?: string
          price_locked_until?: string
          qty?: number
          unit_price_at_add?: number
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "cart_items_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "public_currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "cart_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "admin_stock_overview"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "cart_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variant_availability"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      cart_removed_items: {
        Row: {
          added_at: string
          cart_id: string
          price_locked_until: string
          removed_at: string
          unit_price_at_add: number
          variant_id: string
        }
        Insert: {
          added_at: string
          cart_id: string
          price_locked_until: string
          removed_at?: string
          unit_price_at_add: number
          variant_id: string
        }
        Update: {
          added_at?: string
          cart_id?: string
          price_locked_until?: string
          removed_at?: string
          unit_price_at_add?: number
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_removed_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_removed_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "admin_stock_overview"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "cart_removed_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_removed_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_removed_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variant_availability"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      carts: {
        Row: {
          coupon_code: string | null
          created_at: string
          currency: string
          id: string
          ip_hash: string | null
          last_activity_at: string
          merged_into: string | null
          profile_id: string | null
          status: string
          token_hash: string | null
          updated_at: string
        }
        Insert: {
          coupon_code?: string | null
          created_at?: string
          currency: string
          id?: string
          ip_hash?: string | null
          last_activity_at?: string
          merged_into?: string | null
          profile_id?: string | null
          status?: string
          token_hash?: string | null
          updated_at?: string
        }
        Update: {
          coupon_code?: string | null
          created_at?: string
          currency?: string
          id?: string
          ip_hash?: string | null
          last_activity_at?: string
          merged_into?: string | null
          profile_id?: string | null
          status?: string
          token_hash?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carts_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "carts_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "public_currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "carts_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          parent_id: string | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "public_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          ends_at: string | null
          id: string
          name: string
          slug: string
          sort_order: number
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          name: string
          slug: string
          sort_order?: number
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          name?: string
          slug?: string
          sort_order?: number
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      countries: {
        Row: {
          code: string
          created_at: string
          currency_code: string
          enabled: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          currency_code: string
          enabled?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          currency_code?: string
          enabled?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "countries_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "countries_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "public_currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      coupons: {
        Row: {
          archived_at: string | null
          code: string
          code_normalized: string | null
          created_at: string
          discount_id: string
          ends_at: string | null
          id: string
          is_active: boolean
          starts_at: string | null
          updated_at: string
          usage_limit: number | null
        }
        Insert: {
          archived_at?: string | null
          code: string
          code_normalized?: string | null
          created_at?: string
          discount_id: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          starts_at?: string | null
          updated_at?: string
          usage_limit?: number | null
        }
        Update: {
          archived_at?: string | null
          code?: string
          code_normalized?: string | null
          created_at?: string
          discount_id?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          starts_at?: string | null
          updated_at?: string
          usage_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coupons_discount_id_fkey"
            columns: ["discount_id"]
            isOneToOne: false
            referencedRelation: "discounts"
            referencedColumns: ["id"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          created_at: string
          decimals: number
          enabled: boolean
          name: string
          symbol: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          decimals?: number
          enabled?: boolean
          name: string
          symbol: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          decimals?: number
          enabled?: boolean
          name?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_group_members: {
        Row: {
          archived_at: string | null
          created_at: string
          group_id: string
          id: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          group_id: string
          id?: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          group_id?: string
          id?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "customer_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_group_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_groups: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      delivery_bookings: {
        Row: {
          created_at: string
          delivery_date: string
          id: string
          owner_id: string
          owner_type: string
          slot_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_date: string
          id?: string
          owner_id: string
          owner_type: string
          slot_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_date?: string
          id?: string
          owner_id?: string
          owner_type?: string
          slot_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_bookings_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "delivery_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_slots: {
        Row: {
          archived_at: string | null
          capacity: number
          created_at: string
          end_time: string
          id: string
          is_active: boolean
          method_id: string
          start_time: string
          updated_at: string
          weekday: number
        }
        Insert: {
          archived_at?: string | null
          capacity: number
          created_at?: string
          end_time: string
          id?: string
          is_active?: boolean
          method_id: string
          start_time: string
          updated_at?: string
          weekday: number
        }
        Update: {
          archived_at?: string | null
          capacity?: number
          created_at?: string
          end_time?: string
          id?: string
          is_active?: boolean
          method_id?: string
          start_time?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_slots_method_id_fkey"
            columns: ["method_id"]
            isOneToOne: false
            referencedRelation: "public_shipping_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_slots_method_id_fkey"
            columns: ["method_id"]
            isOneToOne: false
            referencedRelation: "shipping_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_redemptions: {
        Row: {
          amount: number
          coupon_id: string | null
          created_at: string
          currency: string
          discount_id: string
          id: string
          owner_id: string
          owner_type: string
          profile_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          coupon_id?: string | null
          created_at?: string
          currency: string
          discount_id: string
          id?: string
          owner_id: string
          owner_type: string
          profile_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          coupon_id?: string | null
          created_at?: string
          currency?: string
          discount_id?: string
          id?: string
          owner_id?: string
          owner_type?: string
          profile_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discount_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_redemptions_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "discount_redemptions_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "public_currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "discount_redemptions_discount_id_fkey"
            columns: ["discount_id"]
            isOneToOne: false
            referencedRelation: "discounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_redemptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_targets: {
        Row: {
          archived_at: string | null
          category_id: string | null
          collection_id: string | null
          created_at: string
          discount_id: string
          id: string
          product_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          category_id?: string | null
          collection_id?: string | null
          created_at?: string
          discount_id: string
          id?: string
          product_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          category_id?: string | null
          collection_id?: string | null
          created_at?: string
          discount_id?: string
          id?: string
          product_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discount_targets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_targets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "public_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_targets_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_targets_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "public_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_targets_discount_id_fkey"
            columns: ["discount_id"]
            isOneToOne: false
            referencedRelation: "discounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_targets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_targets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "discount_targets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_targets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_targets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      discounts: {
        Row: {
          archived_at: string | null
          created_at: string
          currency: string
          customer_group_id: string | null
          ends_at: string | null
          exclude_sale_items: boolean
          id: string
          is_active: boolean
          kind: string
          min_order_amount: number | null
          name: string
          params: Json
          priority: number
          requires_coupon: boolean
          scope: string
          stackable_with_automatic: boolean
          starts_at: string | null
          updated_at: string
          usage_limit_per_customer: number | null
          usage_limit_total: number | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          currency?: string
          customer_group_id?: string | null
          ends_at?: string | null
          exclude_sale_items?: boolean
          id?: string
          is_active?: boolean
          kind: string
          min_order_amount?: number | null
          name: string
          params: Json
          priority?: number
          requires_coupon?: boolean
          scope?: string
          stackable_with_automatic?: boolean
          starts_at?: string | null
          updated_at?: string
          usage_limit_per_customer?: number | null
          usage_limit_total?: number | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          currency?: string
          customer_group_id?: string | null
          ends_at?: string | null
          exclude_sale_items?: boolean
          id?: string
          is_active?: boolean
          kind?: string
          min_order_amount?: number | null
          name?: string
          params?: Json
          priority?: number
          requires_coupon?: boolean
          scope?: string
          stackable_with_automatic?: boolean
          starts_at?: string | null
          updated_at?: string
          usage_limit_per_customer?: number | null
          usage_limit_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "discounts_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "discounts_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "public_currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "discounts_customer_group_id_fkey"
            columns: ["customer_group_id"]
            isOneToOne: false
            referencedRelation: "customer_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_rates: {
        Row: {
          created_at: string
          created_by: string | null
          from_currency: string
          id: number
          mode: string
          rate: number
          to_currency: string
          valid_from: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_currency?: string
          id?: never
          mode?: string
          rate: number
          to_currency: string
          valid_from?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_currency?: string
          id?: never
          mode?: string
          rate?: number
          to_currency?: string
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_rates_from_currency_fkey"
            columns: ["from_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "exchange_rates_from_currency_fkey"
            columns: ["from_currency"]
            isOneToOne: false
            referencedRelation: "public_currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "exchange_rates_to_currency_fkey"
            columns: ["to_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "exchange_rates_to_currency_fkey"
            columns: ["to_currency"]
            isOneToOne: false
            referencedRelation: "public_currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      home_section_items: {
        Row: {
          archived_at: string | null
          category_id: string | null
          collection_id: string | null
          created_at: string
          id: string
          label: string | null
          link_url: string | null
          media_alt: string | null
          media_kind: string
          media_path: string | null
          product_id: string | null
          section_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          category_id?: string | null
          collection_id?: string | null
          created_at?: string
          id?: string
          label?: string | null
          link_url?: string | null
          media_alt?: string | null
          media_kind?: string
          media_path?: string | null
          product_id?: string | null
          section_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          category_id?: string | null
          collection_id?: string | null
          created_at?: string
          id?: string
          label?: string | null
          link_url?: string | null
          media_alt?: string | null
          media_kind?: string
          media_path?: string | null
          product_id?: string | null
          section_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "home_section_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_section_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "public_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_section_items_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_section_items_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "public_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_section_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_section_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "home_section_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_section_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_section_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_section_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "home_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_section_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "public_home_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      home_sections: {
        Row: {
          archived_at: string | null
          body: string | null
          created_at: string
          cta_label: string | null
          cta_url: string | null
          id: string
          is_active: boolean
          item_limit: number
          kind: string
          media_alt: string | null
          media_kind: string
          media_path: string | null
          sort_order: number
          source_category_id: string | null
          source_collection_id: string | null
          source_type: string
          title: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          body?: string | null
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          id?: string
          is_active?: boolean
          item_limit?: number
          kind: string
          media_alt?: string | null
          media_kind?: string
          media_path?: string | null
          sort_order?: number
          source_category_id?: string | null
          source_collection_id?: string | null
          source_type?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          body?: string | null
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          id?: string
          is_active?: boolean
          item_limit?: number
          kind?: string
          media_alt?: string | null
          media_kind?: string
          media_path?: string | null
          sort_order?: number
          source_category_id?: string | null
          source_collection_id?: string | null
          source_type?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "home_sections_source_category_id_fkey"
            columns: ["source_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_sections_source_category_id_fkey"
            columns: ["source_category_id"]
            isOneToOne: false
            referencedRelation: "public_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_sections_source_collection_id_fkey"
            columns: ["source_collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_sections_source_collection_id_fkey"
            columns: ["source_collection_id"]
            isOneToOne: false
            referencedRelation: "public_collections"
            referencedColumns: ["id"]
          },
        ]
      }
      news_banners: {
        Row: {
          archived_at: string | null
          created_at: string
          ends_at: string | null
          id: string
          is_active: boolean
          link_url: string | null
          message: string
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          link_url?: string | null
          message: string
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          link_url?: string | null
          message?: string
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notification_outbox: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          dedupe_key: string
          id: number
          next_retry_at: string
          payload: Json
          recipient: string | null
          status: string
          type: string
        }
        Insert: {
          attempts?: number
          channel: string
          created_at?: string
          dedupe_key: string
          id?: never
          next_retry_at?: string
          payload?: Json
          recipient?: string | null
          status?: string
          type: string
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          dedupe_key?: string
          id?: never
          next_retry_at?: string
          payload?: Json
          recipient?: string | null
          status?: string
          type?: string
        }
        Relationships: []
      }
      order_counters: {
        Row: {
          last_value: number
          prefix: string
        }
        Insert: {
          last_value?: number
          prefix: string
        }
        Update: {
          last_value?: number
          prefix?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          color_hex: string | null
          color_name: string | null
          cost_unit: number | null
          discount: number
          discount_offers: Json
          final_total: number
          id: string
          image_path: string | null
          line_no: number
          line_total: number
          order_id: string
          product_id: string
          product_name: string
          qty: number
          size_label: string | null
          sku: string | null
          unit_price: number
          variant_id: string
        }
        Insert: {
          color_hex?: string | null
          color_name?: string | null
          cost_unit?: number | null
          discount?: number
          discount_offers?: Json
          final_total: number
          id?: string
          image_path?: string | null
          line_no: number
          line_total: number
          order_id: string
          product_id: string
          product_name: string
          qty: number
          size_label?: string | null
          sku?: string | null
          unit_price: number
          variant_id: string
        }
        Update: {
          color_hex?: string | null
          color_name?: string | null
          cost_unit?: number | null
          discount?: number
          discount_offers?: Json
          final_total?: number
          id?: string
          image_path?: string | null
          line_no?: number
          line_total?: number
          order_id?: string
          product_id?: string
          product_name?: string
          qty?: number
          size_label?: string | null
          sku?: string | null
          unit_price?: number
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "admin_stock_overview"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variant_availability"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          actor_id: string | null
          actor_kind: string
          created_at: string
          from_status: string | null
          id: number
          order_id: string
          reason: string | null
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          actor_kind: string
          created_at?: string
          from_status?: string | null
          id?: never
          order_id: string
          reason?: string | null
          to_status: string
        }
        Update: {
          actor_id?: string | null
          actor_kind?: string
          created_at?: string
          from_status?: string | null
          id?: never
          order_id?: string
          reason?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          base_currency: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cart_id: string | null
          contact_email: string | null
          contact_name: string
          contact_phone: string
          country: string
          coupon_code: string | null
          created_at: string
          currency: string
          delivery_slot: Json | null
          discount_total: number
          discounts: Json
          exchange_rate: number
          id: string
          idempotency_key: string
          number: string
          paid_at: string | null
          payment_expires_at: string | null
          payment_method: string
          payment_provider: string
          profile_id: string
          reminder_sent_at: string | null
          request_hash: string | null
          shipping_address: Json | null
          shipping_cost: number
          shipping_discount: number
          shipping_method: Json
          status: string
          subtotal: number
          tax_included: boolean
          tax_profile: Json | null
          total: number
          updated_at: string
        }
        Insert: {
          base_currency: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cart_id?: string | null
          contact_email?: string | null
          contact_name: string
          contact_phone: string
          country: string
          coupon_code?: string | null
          created_at?: string
          currency: string
          delivery_slot?: Json | null
          discount_total?: number
          discounts?: Json
          exchange_rate?: number
          id?: string
          idempotency_key: string
          number: string
          paid_at?: string | null
          payment_expires_at?: string | null
          payment_method: string
          payment_provider: string
          profile_id: string
          reminder_sent_at?: string | null
          request_hash?: string | null
          shipping_address?: Json | null
          shipping_cost?: number
          shipping_discount?: number
          shipping_method: Json
          status?: string
          subtotal: number
          tax_included?: boolean
          tax_profile?: Json | null
          total: number
          updated_at?: string
        }
        Update: {
          base_currency?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cart_id?: string | null
          contact_email?: string | null
          contact_name?: string
          contact_phone?: string
          country?: string
          coupon_code?: string | null
          created_at?: string
          currency?: string
          delivery_slot?: Json | null
          discount_total?: number
          discounts?: Json
          exchange_rate?: number
          id?: string
          idempotency_key?: string
          number?: string
          paid_at?: string | null
          payment_expires_at?: string | null
          payment_method?: string
          payment_provider?: string
          profile_id?: string
          reminder_sent_at?: string | null
          request_hash?: string | null
          shipping_address?: Json | null
          shipping_cost?: number
          shipping_discount?: number
          shipping_method?: Json
          status?: string
          subtotal?: number
          tax_included?: boolean
          tax_profile?: Json | null
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_base_currency_fkey"
            columns: ["base_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "orders_base_currency_fkey"
            columns: ["base_currency"]
            isOneToOne: false
            referencedRelation: "public_currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "orders_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_country_fkey"
            columns: ["country"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "orders_country_fkey"
            columns: ["country"]
            isOneToOne: false
            referencedRelation: "public_countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "orders_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "orders_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "public_currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "orders_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          account_details: string | null
          archived_at: string | null
          blocked_for_blacklisted: boolean
          code: string
          country: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          max_amount: number | null
          name: string
          provider: string
          qr_image_path: string | null
          sort_order: number
          updated_at: string
          window_minutes: number | null
        }
        Insert: {
          account_details?: string | null
          archived_at?: string | null
          blocked_for_blacklisted?: boolean
          code: string
          country: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          max_amount?: number | null
          name: string
          provider: string
          qr_image_path?: string | null
          sort_order?: number
          updated_at?: string
          window_minutes?: number | null
        }
        Update: {
          account_details?: string | null
          archived_at?: string | null
          blocked_for_blacklisted?: boolean
          code?: string
          country?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          max_amount?: number | null
          name?: string
          provider?: string
          qr_image_path?: string | null
          sort_order?: number
          updated_at?: string
          window_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_country_fkey"
            columns: ["country"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "payment_methods_country_fkey"
            columns: ["country"]
            isOneToOne: false
            referencedRelation: "public_countries"
            referencedColumns: ["code"]
          },
        ]
      }
      payment_proofs: {
        Row: {
          created_at: string
          duplicate_of: string | null
          file_hash: string
          file_path: string
          id: string
          mime: string
          order_id: string
          payment_id: string
          profile_id: string
          reason: string | null
          received_amount: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          size_bytes: number
          status: string
        }
        Insert: {
          created_at?: string
          duplicate_of?: string | null
          file_hash: string
          file_path: string
          id?: string
          mime: string
          order_id: string
          payment_id: string
          profile_id: string
          reason?: string | null
          received_amount?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes: number
          status?: string
        }
        Update: {
          created_at?: string
          duplicate_of?: string | null
          file_hash?: string
          file_path?: string
          id?: string
          mime?: string
          order_id?: string
          payment_id?: string
          profile_id?: string
          reason?: string | null
          received_amount?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_proofs_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "payment_proofs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_proofs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_proofs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_proofs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_proofs_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reviews: {
        Row: {
          detail: Json
          id: string
          note: string | null
          opened_at: string
          payment_id: string
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          detail?: Json
          id?: string
          note?: string | null
          opened_at?: string
          payment_id: string
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          detail?: Json
          id?: string
          note?: string | null
          opened_at?: string
          payment_id?: string
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reviews_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reviews_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          attempt: number
          created_at: string
          currency: string
          expires_at: string | null
          external_id: string | null
          id: string
          method: string
          order_id: string
          paid_at: string | null
          provider: string
          provider_ref: string | null
          received_amount: number | null
          reference: string | null
          reminder_sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          attempt?: number
          created_at?: string
          currency: string
          expires_at?: string | null
          external_id?: string | null
          id?: string
          method: string
          order_id: string
          paid_at?: string | null
          provider: string
          provider_ref?: string | null
          received_amount?: number | null
          reference?: string | null
          reminder_sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          attempt?: number
          created_at?: string
          currency?: string
          expires_at?: string | null
          external_id?: string | null
          id?: string
          method?: string
          order_id?: string
          paid_at?: string | null
          provider?: string
          provider_ref?: string | null
          received_amount?: number | null
          reference?: string | null
          reminder_sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "payments_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "public_currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          category_id: string
          created_at: string
          product_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          product_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "public_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_collections: {
        Row: {
          collection_id: string
          created_at: string
          product_id: string
          sort_order: number
        }
        Insert: {
          collection_id: string
          created_at?: string
          product_id: string
          sort_order?: number
        }
        Update: {
          collection_id?: string
          created_at?: string
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_collections_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_collections_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "public_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_collections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_collections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_collections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_collections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_collections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_colors: {
        Row: {
          archived_at: string | null
          created_at: string
          hex: string | null
          id: string
          name: string
          product_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          hex?: string | null
          id?: string
          name: string
          product_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          hex?: string | null
          id?: string
          name?: string
          product_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_colors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_colors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_colors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_colors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_colors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt: string | null
          archived_at: string | null
          color_id: string | null
          created_at: string
          id: string
          path: string
          product_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          alt?: string | null
          archived_at?: string | null
          color_id?: string | null
          created_at?: string
          id?: string
          path: string
          product_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          alt?: string | null
          archived_at?: string | null
          color_id?: string | null
          created_at?: string
          id?: string
          path?: string
          product_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_color_fk"
            columns: ["color_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_colors"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "product_images_color_fk"
            columns: ["color_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_colors"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_prices: {
        Row: {
          amount: number
          country: string | null
          created_at: string
          currency: string
          id: string
          product_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          country?: string | null
          created_at?: string
          currency: string
          id?: string
          product_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          country?: string | null
          created_at?: string
          currency?: string
          id?: string
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_prices_country_fkey"
            columns: ["country"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "product_prices_country_fkey"
            columns: ["country"]
            isOneToOne: false
            referencedRelation: "public_countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "product_prices_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "product_prices_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "public_currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_related: {
        Row: {
          created_at: string
          product_id: string
          related_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          product_id: string
          related_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          product_id?: string
          related_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_related_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_related_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_related_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_related_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_related_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_related_related_id_fkey"
            columns: ["related_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_related_related_id_fkey"
            columns: ["related_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_related_related_id_fkey"
            columns: ["related_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_related_related_id_fkey"
            columns: ["related_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_related_related_id_fkey"
            columns: ["related_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sizes: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          label: string
          product_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          label: string
          product_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          label?: string
          product_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_sizes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sizes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_sizes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sizes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sizes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_slug_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: number
          product_id: string
          slug: string
          was_public: boolean
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: never
          product_id: string
          slug: string
          was_public?: boolean
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: never
          product_id?: string
          slug?: string
          was_public?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "product_slug_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_slug_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_slug_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_slug_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_slug_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          archived_at: string | null
          color_id: string
          created_at: string
          critical_threshold: number | null
          id: string
          low_threshold: number | null
          product_id: string
          size_id: string | null
          sku: string
          stock_on_hand: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          color_id: string
          created_at?: string
          critical_threshold?: number | null
          id?: string
          low_threshold?: number | null
          product_id: string
          size_id?: string | null
          sku: string
          stock_on_hand?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          color_id?: string
          created_at?: string
          critical_threshold?: number | null
          id?: string
          low_threshold?: number | null
          product_id?: string
          size_id?: string | null
          sku?: string
          stock_on_hand?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_color_fk"
            columns: ["color_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_colors"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "product_variants_color_fk"
            columns: ["color_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_colors"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_size_fk"
            columns: ["size_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_sizes"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "product_variants_size_fk"
            columns: ["size_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_sizes"
            referencedColumns: ["id", "product_id"]
          },
        ]
      }
      products: {
        Row: {
          allow_converted_prices: boolean
          archived_at: string | null
          code: string
          cost_base: number | null
          created_at: string
          description: string
          id: string
          is_new: boolean
          materials: string | null
          model: string | null
          name: string
          out_of_stock_behavior: string
          slug: string
          status: string
          updated_at: string
          washcare: string | null
        }
        Insert: {
          allow_converted_prices?: boolean
          archived_at?: string | null
          code: string
          cost_base?: number | null
          created_at?: string
          description?: string
          id?: string
          is_new?: boolean
          materials?: string | null
          model?: string | null
          name: string
          out_of_stock_behavior?: string
          slug: string
          status?: string
          updated_at?: string
          washcare?: string | null
        }
        Update: {
          allow_converted_prices?: boolean
          archived_at?: string | null
          code?: string
          cost_base?: number | null
          created_at?: string
          description?: string
          id?: string
          is_new?: boolean
          materials?: string | null
          model?: string | null
          name?: string
          out_of_stock_behavior?: string
          slug?: string
          status?: string
          updated_at?: string
          washcare?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          anonymized_at: string | null
          blacklisted: boolean
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          phone_e164: string | null
          preferred_currency: string | null
          preferred_locale: string
          role: string
          updated_at: string
        }
        Insert: {
          anonymized_at?: string | null
          blacklisted?: boolean
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          is_active?: boolean
          phone_e164?: string | null
          preferred_currency?: string | null
          preferred_locale?: string
          role?: string
          updated_at?: string
        }
        Update: {
          anonymized_at?: string | null
          blacklisted?: boolean
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          phone_e164?: string | null
          preferred_currency?: string | null
          preferred_locale?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_preferred_currency_fkey"
            columns: ["preferred_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "profiles_preferred_currency_fkey"
            columns: ["preferred_currency"]
            isOneToOne: false
            referencedRelation: "public_currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      rate_limits: {
        Row: {
          hits: number
          key: string
          window_start: string
        }
        Insert: {
          hits?: number
          key: string
          window_start?: string
        }
        Update: {
          hits?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      shipping_methods: {
        Row: {
          archived_at: string | null
          code: string
          created_at: string
          description: string | null
          eta_max_days: number | null
          eta_min_days: number | null
          id: string
          is_active: boolean
          kind: string
          name: string
          pickup_location_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          code: string
          created_at?: string
          description?: string | null
          eta_max_days?: number | null
          eta_min_days?: number | null
          id?: string
          is_active?: boolean
          kind: string
          name: string
          pickup_location_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          code?: string
          created_at?: string
          description?: string | null
          eta_max_days?: number | null
          eta_min_days?: number | null
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          pickup_location_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_methods_pickup_location_id_fkey"
            columns: ["pickup_location_id"]
            isOneToOne: false
            referencedRelation: "store_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_rate_rules: {
        Row: {
          archived_at: string | null
          created_at: string
          currency: string
          id: string
          is_active: boolean
          kind: string
          max_order_amount: number | null
          method_id: string
          min_order_amount: number | null
          name: string
          params: Json
          priority: number
          updated_at: string
          valid_from: string | null
          valid_until: string | null
          zone_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          kind: string
          max_order_amount?: number | null
          method_id: string
          min_order_amount?: number | null
          name: string
          params: Json
          priority?: number
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
          zone_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          kind?: string
          max_order_amount?: number | null
          method_id?: string
          min_order_amount?: number | null
          name?: string
          params?: Json
          priority?: number
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_rate_rules_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "shipping_rate_rules_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "public_currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "shipping_rate_rules_method_id_fkey"
            columns: ["method_id"]
            isOneToOne: false
            referencedRelation: "public_shipping_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_rate_rules_method_id_fkey"
            columns: ["method_id"]
            isOneToOne: false
            referencedRelation: "shipping_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_rate_rules_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "shipping_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_zones: {
        Row: {
          allowed: boolean
          archived_at: string | null
          center_lat: number | null
          center_lng: number | null
          cities: string[] | null
          created_at: string
          id: string
          is_active: boolean
          kind: string
          name: string
          radius_km: number | null
          updated_at: string
        }
        Insert: {
          allowed?: boolean
          archived_at?: string | null
          center_lat?: number | null
          center_lng?: number | null
          cities?: string[] | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind: string
          name: string
          radius_km?: number | null
          updated_at?: string
        }
        Update: {
          allowed?: boolean
          archived_at?: string | null
          center_lat?: number | null
          center_lng?: number | null
          cities?: string[] | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          radius_km?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: number
          note: string | null
          reason: string
          ref: string | null
          stock_after: number
          variant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: never
          note?: string | null
          reason: string
          ref?: string | null
          stock_after: number
          variant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: never
          note?: string | null
          reason?: string
          ref?: string | null
          stock_after?: number
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "admin_stock_overview"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variant_availability"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      stock_reservations: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          owner_id: string
          owner_type: string
          qty: number
          status: string
          updated_at: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          owner_id: string
          owner_type: string
          qty: number
          status?: string
          updated_at?: string
          variant_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          owner_id?: string
          owner_type?: string
          qty?: number
          status?: string
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_reservations_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "admin_stock_overview"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "stock_reservations_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variant_availability"
            referencedColumns: ["variant_id"]
          },
        ]
      }
      store_locations: {
        Row: {
          address_text: string
          archived_at: string | null
          city: string
          created_at: string
          id: string
          is_active: boolean
          is_primary: boolean
          lat: number
          lng: number
          name: string
          pickup_hours: string | null
          updated_at: string
        }
        Insert: {
          address_text: string
          archived_at?: string | null
          city: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          lat: number
          lng: number
          name: string
          pickup_hours?: string | null
          updated_at?: string
        }
        Update: {
          address_text?: string
          archived_at?: string | null
          city?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          lat?: number
          lng?: number
          name?: string
          pickup_hours?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      store_settings: {
        Row: {
          created_at: string
          description: string | null
          is_public: boolean
          key: string
          updated_at: string
          value: Json
          value_type: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          is_public?: boolean
          key: string
          updated_at?: string
          value: Json
          value_type: string
        }
        Update: {
          created_at?: string
          description?: string | null
          is_public?: boolean
          key?: string
          updated_at?: string
          value?: Json
          value_type?: string
        }
        Relationships: []
      }
      tax_profiles: {
        Row: {
          archived_at: string | null
          created_at: string
          doc_number: string
          doc_type: string
          id: string
          is_default: boolean
          legal_name: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          doc_number: string
          doc_type: string
          id?: string
          is_default?: boolean
          legal_name: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          doc_number?: string
          doc_type?: string
          id?: string
          is_default?: boolean
          legal_name?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_profiles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          attempts: number
          error: string | null
          event_id: string | null
          id: number
          outcome: string | null
          payload: Json
          payment_id: string | null
          processed_at: string | null
          provider: string
          received_at: string
          signature_valid: boolean
        }
        Insert: {
          attempts?: number
          error?: string | null
          event_id?: string | null
          id?: never
          outcome?: string | null
          payload?: Json
          payment_id?: string | null
          processed_at?: string | null
          provider: string
          received_at?: string
          signature_valid: boolean
        }
        Update: {
          attempts?: number
          error?: string | null
          event_id?: string | null
          id?: never
          outcome?: string | null
          payload?: Json
          payment_id?: string | null
          processed_at?: string | null
          provider?: string
          received_at?: string
          signature_valid?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      admin_product_list: {
        Row: {
          archived_at: string | null
          category_ids: string[] | null
          code: string | null
          collection_ids: string[] | null
          cover_path: string | null
          created_at: string | null
          display_state: string | null
          id: string | null
          is_new: boolean | null
          name: string | null
          out_of_stock_behavior: string | null
          price_bob: number | null
          slug: string | null
          status: string | null
          total_available: number | null
          total_on_hand: number | null
          updated_at: string | null
          variants_count: number | null
          variants_out: number | null
          worst_light: string | null
        }
        Relationships: []
      }
      admin_product_stock: {
        Row: {
          archived_at: string | null
          code: string | null
          name: string | null
          product_id: string | null
          status: string | null
          total_available: number | null
          total_on_hand: number | null
          variants_count: number | null
          variants_out: number | null
          worst_light: string | null
        }
        Relationships: []
      }
      admin_stock_overview: {
        Row: {
          available: number | null
          color_name: string | null
          critical_threshold: number | null
          low_threshold: number | null
          product_code: string | null
          product_id: string | null
          product_name: string | null
          product_status: string | null
          reserved: number | null
          size_label: string | null
          sku: string | null
          stock_light: string | null
          stock_on_hand: number | null
          variant_archived_at: string | null
          variant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_usage: {
        Row: {
          amount: number | null
          customers: number | null
          discount_id: string | null
          used: number | null
        }
        Relationships: [
          {
            foreignKeyName: "discount_redemptions_discount_id_fkey"
            columns: ["discount_id"]
            isOneToOne: false
            referencedRelation: "discounts"
            referencedColumns: ["id"]
          },
        ]
      }
      public_categories: {
        Row: {
          description: string | null
          id: string | null
          name: string | null
          parent_id: string | null
          slug: string | null
          sort_order: number | null
        }
        Insert: {
          description?: string | null
          id?: string | null
          name?: string | null
          parent_id?: string | null
          slug?: string | null
          sort_order?: number | null
        }
        Update: {
          description?: string | null
          id?: string | null
          name?: string | null
          parent_id?: string | null
          slug?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "public_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      public_collections: {
        Row: {
          description: string | null
          ends_at: string | null
          id: string | null
          name: string | null
          slug: string | null
          sort_order: number | null
          starts_at: string | null
        }
        Insert: {
          description?: string | null
          ends_at?: string | null
          id?: string | null
          name?: string | null
          slug?: string | null
          sort_order?: number | null
          starts_at?: string | null
        }
        Update: {
          description?: string | null
          ends_at?: string | null
          id?: string | null
          name?: string | null
          slug?: string | null
          sort_order?: number | null
          starts_at?: string | null
        }
        Relationships: []
      }
      public_countries: {
        Row: {
          code: string | null
          currency_code: string | null
          name: string | null
        }
        Insert: {
          code?: string | null
          currency_code?: string | null
          name?: string | null
        }
        Update: {
          code?: string | null
          currency_code?: string | null
          name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "countries_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "countries_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "public_currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      public_currencies: {
        Row: {
          code: string | null
          decimals: number | null
          name: string | null
          symbol: string | null
        }
        Insert: {
          code?: string | null
          decimals?: number | null
          name?: string | null
          symbol?: string | null
        }
        Update: {
          code?: string | null
          decimals?: number | null
          name?: string | null
          symbol?: string | null
        }
        Relationships: []
      }
      public_home_section_items: {
        Row: {
          category_id: string | null
          collection_id: string | null
          id: string | null
          label: string | null
          link_url: string | null
          media_alt: string | null
          media_kind: string | null
          media_path: string | null
          product_id: string | null
          section_id: string | null
          sort_order: number | null
        }
        Relationships: [
          {
            foreignKeyName: "home_section_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "home_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_section_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "public_home_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      public_home_sections: {
        Row: {
          body: string | null
          cta_label: string | null
          cta_url: string | null
          id: string | null
          item_limit: number | null
          kind: string | null
          media_alt: string | null
          media_kind: string | null
          media_path: string | null
          sort_order: number | null
          source_category_id: string | null
          source_collection_id: string | null
          source_type: string | null
          title: string | null
        }
        Insert: {
          body?: string | null
          cta_label?: string | null
          cta_url?: string | null
          id?: string | null
          item_limit?: number | null
          kind?: string | null
          media_alt?: string | null
          media_kind?: string | null
          media_path?: string | null
          sort_order?: number | null
          source_category_id?: never
          source_collection_id?: never
          source_type?: string | null
          title?: string | null
        }
        Update: {
          body?: string | null
          cta_label?: string | null
          cta_url?: string | null
          id?: string | null
          item_limit?: number | null
          kind?: string | null
          media_alt?: string | null
          media_kind?: string | null
          media_path?: string | null
          sort_order?: number | null
          source_category_id?: never
          source_collection_id?: never
          source_type?: string | null
          title?: string | null
        }
        Relationships: []
      }
      public_news_banners: {
        Row: {
          ends_at: string | null
          id: string | null
          link_url: string | null
          message: string | null
          starts_at: string | null
        }
        Insert: {
          ends_at?: string | null
          id?: string | null
          link_url?: string | null
          message?: string | null
          starts_at?: string | null
        }
        Update: {
          ends_at?: string | null
          id?: string | null
          link_url?: string | null
          message?: string | null
          starts_at?: string | null
        }
        Relationships: []
      }
      public_product_categories: {
        Row: {
          category_id: string | null
          product_id: string | null
        }
        Insert: {
          category_id?: string | null
          product_id?: string | null
        }
        Update: {
          category_id?: string | null
          product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "public_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      public_product_collections: {
        Row: {
          collection_id: string | null
          product_id: string | null
          sort_order: number | null
        }
        Insert: {
          collection_id?: string | null
          product_id?: string | null
          sort_order?: number | null
        }
        Update: {
          collection_id?: string | null
          product_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_collections_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_collections_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "public_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_collections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_collections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_collections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_collections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_collections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      public_product_colors: {
        Row: {
          hex: string | null
          id: string | null
          name: string | null
          product_id: string | null
          sort_order: number | null
        }
        Insert: {
          hex?: string | null
          id?: string | null
          name?: string | null
          product_id?: string | null
          sort_order?: number | null
        }
        Update: {
          hex?: string | null
          id?: string | null
          name?: string | null
          product_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_colors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_colors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_colors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_colors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_colors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      public_product_detail: {
        Row: {
          colors_count: number | null
          cover_alt: string | null
          cover_path: string | null
          created_at: string | null
          description: string | null
          id: string | null
          is_new: boolean | null
          materials: string | null
          model: string | null
          name: string | null
          price_bob: number | null
          slug: string | null
          sold_out: boolean | null
          washcare: string | null
        }
        Relationships: []
      }
      public_product_images: {
        Row: {
          alt: string | null
          color_id: string | null
          id: string | null
          path: string | null
          product_id: string | null
          sort_order: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_color_fk"
            columns: ["color_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_colors"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "product_images_color_fk"
            columns: ["color_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_colors"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      public_product_related: {
        Row: {
          product_id: string | null
          related_id: string | null
          sort_order: number | null
        }
        Insert: {
          product_id?: string | null
          related_id?: string | null
          sort_order?: number | null
        }
        Update: {
          product_id?: string | null
          related_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_related_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_related_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_related_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_related_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_related_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_related_related_id_fkey"
            columns: ["related_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_related_related_id_fkey"
            columns: ["related_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_related_related_id_fkey"
            columns: ["related_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_related_related_id_fkey"
            columns: ["related_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_related_related_id_fkey"
            columns: ["related_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      public_product_sizes: {
        Row: {
          id: string | null
          label: string | null
          product_id: string | null
          sort_order: number | null
        }
        Insert: {
          id?: string | null
          label?: string | null
          product_id?: string | null
          sort_order?: number | null
        }
        Update: {
          id?: string | null
          label?: string | null
          product_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_sizes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sizes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_sizes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sizes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sizes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      public_product_slug_redirects: {
        Row: {
          current_slug: string | null
          old_slug: string | null
        }
        Relationships: []
      }
      public_product_variants: {
        Row: {
          color_id: string | null
          id: string | null
          product_id: string | null
          size_id: string | null
          stock_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_color_fk"
            columns: ["color_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_colors"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "product_variants_color_fk"
            columns: ["color_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_colors"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_size_fk"
            columns: ["size_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_sizes"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "product_variants_size_fk"
            columns: ["size_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_sizes"
            referencedColumns: ["id", "product_id"]
          },
        ]
      }
      public_products: {
        Row: {
          colors_count: number | null
          cover_alt: string | null
          cover_path: string | null
          created_at: string | null
          id: string | null
          is_new: boolean | null
          name: string | null
          price_bob: number | null
          slug: string | null
          sold_out: boolean | null
        }
        Relationships: []
      }
      public_shipping_methods: {
        Row: {
          code: string | null
          description: string | null
          eta_max_days: number | null
          eta_min_days: number | null
          id: string | null
          kind: string | null
          name: string | null
          pickup_address: string | null
          pickup_city: string | null
          pickup_hours: string | null
          pickup_name: string | null
          sort_order: number | null
        }
        Relationships: []
      }
      public_store_settings: {
        Row: {
          key: string | null
          value: Json | null
        }
        Insert: {
          key?: string | null
          value?: Json | null
        }
        Update: {
          key?: string | null
          value?: Json | null
        }
        Relationships: []
      }
      variant_availability: {
        Row: {
          availability_light: string | null
          available: number | null
          critical_threshold: number | null
          low_threshold: number | null
          product_id: string | null
          reserved: number | null
          stock_light: string | null
          stock_on_hand: number | null
          variant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_product_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_product_detail"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _apply_admin_rls: {
        Args: {
          p_insert_cols: string[]
          p_table: string
          p_update_cols: string[]
        }
        Returns: undefined
      }
      _cart_free_for: {
        Args: { p_cart_id: string; p_variant_id: string }
        Returns: number
      }
      _cart_ip_room: {
        Args: { p_cart_id: string; p_variant_id: string }
        Returns: number
      }
      _cart_lock: { Args: { p_cart_id: string }; Returns: undefined }
      _cart_lock_active: { Args: { p_cart_id: string }; Returns: boolean }
      _cart_resolve: {
        Args: {
          p_create: boolean
          p_ip_hash?: string
          p_profile_id: string
          p_token_hash: string
        }
        Returns: Record<string, unknown>
      }
      _cart_snapshot: { Args: { p_cart_id: string }; Returns: Json }
      _checkout_compute: {
        Args: {
          p_address_id: string
          p_cart_id: string
          p_delivery_date: string
          p_list_days?: number
          p_payment_method: string
          p_profile_id: string
          p_require_payment?: boolean
          p_shipping_method: string
          p_slot_id: string
          p_tax_profile_id: string
        }
        Returns: Json
      }
      _coupon_norm: { Args: { p_code: string }; Returns: string }
      _customer_order_count: { Args: { p_profile_id: string }; Returns: number }
      _discount_customer_reason: {
        Args: { p_group_id: string; p_kind: string; p_profile_id: string }
        Returns: string
      }
      _discount_distribute: {
        Args: { p_amount: number; p_weights: number[] }
        Returns: number[]
      }
      _discount_evaluate: {
        Args: {
          p_coupon?: string
          p_currency: string
          p_lines: Json
          p_now?: string
          p_profile_id: string
          p_shipping?: number
        }
        Returns: Json
      }
      _discount_line_eligible: {
        Args: { p_discount_id: string; p_product_id: string; p_scope: string }
        Returns: boolean
      }
      _discount_params_valid: {
        Args: { p_kind: string; p_params: Json }
        Returns: boolean
      }
      _discount_reductions: {
        Args: {
          p_base: number[]
          p_elig: boolean[]
          p_kind: string
          p_params: Json
          p_qty: number[]
          p_scale: number
          p_unit: number[]
        }
        Returns: number[]
      }
      _discount_usage: {
        Args: {
          p_coupon_id: string
          p_discount_id: string
          p_profile_id: string
        }
        Returns: number[]
      }
      _next_order_number: { Args: { p_prefix?: string }; Returns: string }
      _order_json: { Args: { p_order_id: string }; Returns: Json }
      _order_notify: {
        Args: {
          p_audience: string
          p_extra?: Json
          p_order_id: string
          p_suffix?: string
          p_type: string
        }
        Returns: undefined
      }
      _order_transition_ok: {
        Args: { p_actor_kind: string; p_from: string; p_to: string }
        Returns: boolean
      }
      _payment_alert: {
        Args: { p_dedupe: string; p_payload: Json; p_type: string }
        Returns: undefined
      }
      _payment_open_review: {
        Args: { p_detail: Json; p_payment_id: string; p_reason: string }
        Returns: string
      }
      _ship_norm: { Args: { p_text: string }; Returns: string }
      _ship_params_valid: {
        Args: { p_kind: string; p_params: Json }
        Returns: boolean
      }
      _ship_slot_ok: {
        Args: { p_day: string; p_now?: string; p_slot_id: string }
        Returns: string
      }
      _ship_slots: {
        Args: { p_days: number; p_from: string; p_method_id: string }
        Returns: Json
      }
      adjust_stock: {
        Args: {
          p_delta: number
          p_note?: string
          p_reason: string
          p_variant_id: string
        }
        Returns: number
      }
      admin_confirm_payment_manual: {
        Args: {
          p_note?: string
          p_payment_id: string
          p_received_amount?: number
        }
        Returns: Json
      }
      admin_delete_product_price: {
        Args: { p_country?: string; p_currency: string; p_product_id: string }
        Returns: undefined
      }
      admin_duplicate_product: {
        Args: { p_new_code: string; p_new_name: string; p_product_id: string }
        Returns: string
      }
      admin_generate_coupon_codes: {
        Args: {
          p_count: number
          p_discount_id: string
          p_length?: number
          p_prefix?: string
          p_usage_limit?: number
        }
        Returns: string[]
      }
      admin_resolve_review: {
        Args: { p_note: string; p_review_id: string }
        Returns: Json
      }
      admin_review_proof: {
        Args: {
          p_decision: string
          p_proof_id: string
          p_reason?: string
          p_received_amount?: number
        }
        Returns: Json
      }
      admin_set_primary_location: { Args: { p_id: string }; Returns: undefined }
      admin_set_product_categories: {
        Args: { p_category_ids: string[]; p_product_id: string }
        Returns: undefined
      }
      admin_set_product_collections: {
        Args: { p_collection_ids: string[]; p_product_id: string }
        Returns: undefined
      }
      admin_set_product_related: {
        Args: { p_product_id: string; p_related_ids: string[] }
        Returns: undefined
      }
      admin_set_stock: {
        Args: {
          p_expected: number
          p_new: number
          p_note?: string
          p_reason: string
          p_variant_id: string
        }
        Returns: number
      }
      admin_transition_order: {
        Args: { p_order_id: string; p_reason?: string; p_to: string }
        Returns: Json
      }
      apply_discounts: {
        Args: {
          p_cart_id: string
          p_coupon_code?: string
          p_now?: string
          p_shipping?: number
        }
        Returns: Json
      }
      apply_stock_change: {
        Args: {
          p_delta: number
          p_note?: string
          p_reason: string
          p_ref?: string
          p_user?: string
          p_variant_id: string
        }
        Returns: number
      }
      cancel_order_by_customer: {
        Args: { p_order_id: string; p_profile_id: string; p_reason?: string }
        Returns: Json
      }
      cart_abandon_stale: { Args: never; Returns: number }
      cart_accept_prices: {
        Args: {
          p_expected_price?: number
          p_profile_id: string
          p_token_hash: string
          p_variant_id?: string
        }
        Returns: Json
      }
      cart_clear: {
        Args: { p_profile_id: string; p_token_hash: string }
        Returns: Json
      }
      cart_get: {
        Args: { p_profile_id: string; p_token_hash: string }
        Returns: Json
      }
      cart_refresh: {
        Args: { p_profile_id: string; p_token_hash: string }
        Returns: Json
      }
      cart_remove_coupon: {
        Args: { p_profile_id: string; p_token_hash: string }
        Returns: Json
      }
      cart_remove_item: {
        Args: {
          p_profile_id: string
          p_token_hash: string
          p_variant_id: string
        }
        Returns: Json
      }
      cart_set_coupon: {
        Args: { p_code: string; p_profile_id: string; p_token_hash: string }
        Returns: Json
      }
      cart_set_item: {
        Args: {
          p_ip_hash?: string
          p_may_create?: boolean
          p_profile_id: string
          p_qty: number
          p_token_hash: string
          p_variant_id: string
        }
        Returns: Json
      }
      change_profile_contact: {
        Args: {
          p_email: string
          p_expect?: Json
          p_id: string
          p_phone: string
        }
        Returns: undefined
      }
      check_rate_limit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number }
        Returns: {
          allowed: boolean
          hit_count: number
          retry_after_seconds: number
        }[]
      }
      checkout_preview: {
        Args: {
          p_address_id: string
          p_delivery_date: string
          p_payment_method: string
          p_profile_id: string
          p_shipping_method: string
          p_slot_id: string
          p_tax_profile_id: string
        }
        Returns: Json
      }
      create_order: {
        Args: {
          p_address_id: string
          p_contact_email: string
          p_contact_name: string
          p_contact_phone: string
          p_delivery_date: string
          p_expected_total: number
          p_idempotency_key: string
          p_payment_method: string
          p_profile_id: string
          p_shipping_method: string
          p_slot_id: string
          p_tax_profile_id: string
        }
        Returns: Json
      }
      current_app_role: { Args: never; Returns: string }
      current_rate: { Args: { p_from: string; p_to: string }; Returns: number }
      customer_payment_view: { Args: { p_order_id: string }; Returns: Json }
      deactivate_profile: {
        Args: { p_anonymize?: boolean; p_id: string }
        Returns: undefined
      }
      discount_commit: {
        Args: { p_owner_id: string; p_owner_type: string }
        Returns: number
      }
      discount_release: {
        Args: { p_owner_id: string; p_owner_type: string }
        Returns: number
      }
      discount_reserve: {
        Args: {
          p_applied: Json
          p_owner_id: string
          p_owner_type: string
          p_profile_id: string
        }
        Returns: Json
      }
      enqueue_notification: {
        Args: {
          p_channel: string
          p_dedupe_key: string
          p_payload: Json
          p_recipient: string
          p_type: string
        }
        Returns: number
      }
      expire_pending_payments: { Args: never; Returns: number }
      expire_reservations: { Args: never; Returns: number }
      expire_unconfirmed_orders: { Args: never; Returns: number }
      f_unaccent: { Args: { p_text: string }; Returns: string }
      haversine_km: {
        Args: { p_lat1: number; p_lat2: number; p_lng1: number; p_lng2: number }
        Returns: number
      }
      healthcheck: { Args: never; Returns: Json }
      home_media_ok: {
        Args: { p_kind: string; p_path: string }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_safe_link: { Args: { p_url: string }; Returns: boolean }
      merge_guest_cart: {
        Args: { p_profile_id: string; p_token_hash: string }
        Returns: Json
      }
      payment_apply_event: {
        Args: {
          p_actor?: string
          p_amount: number
          p_currency: string
          p_event_id: string
          p_external_id?: string
          p_payload?: Json
          p_provider: string
          p_reference: string
          p_type: string
        }
        Returns: Json
      }
      payment_log_invalid_event: {
        Args: { p_payload?: Json; p_provider: string; p_reason: string }
        Returns: undefined
      }
      payment_proof_path_ok: { Args: { p_name: string }; Returns: boolean }
      payment_proof_register: {
        Args: {
          p_hash: string
          p_mime: string
          p_path: string
          p_payment_id: string
          p_profile_id: string
          p_size: number
        }
        Returns: Json
      }
      payment_retry: {
        Args: { p_order_id: string; p_profile_id: string }
        Returns: Json
      }
      price_for: {
        Args: { p_country?: string; p_currency?: string; p_product_id: string }
        Returns: number
      }
      promote_admin: { Args: { p_email: string }; Returns: string }
      public_list_products: {
        Args: {
          p_category_slug?: string
          p_collection_slug?: string
          p_colors?: string[]
          p_in_stock_only?: boolean
          p_limit?: number
          p_max_price?: number
          p_min_price?: number
          p_offset?: number
          p_sizes?: string[]
          p_sort?: string
        }
        Returns: Json
      }
      public_listing_facets: {
        Args: { p_category_slug?: string; p_collection_slug?: string }
        Returns: Json
      }
      public_price_for: {
        Args: { p_country?: string; p_currency?: string; p_product_id: string }
        Returns: number
      }
      public_search_products: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          colors_count: number | null
          cover_alt: string | null
          cover_path: string | null
          created_at: string | null
          id: string | null
          is_new: boolean | null
          name: string | null
          price_bob: number | null
          slug: string | null
          sold_out: boolean | null
        }[]
        SetofOptions: {
          from: "*"
          to: "public_products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      purge_old_carts: { Args: { p_older_than?: string }; Returns: number }
      purge_stock_reservations: {
        Args: { p_older_than?: string }
        Returns: number
      }
      quote_shipping: {
        Args: {
          p_city?: string
          p_currency?: string
          p_delivery_date?: string
          p_lat?: number
          p_list_days?: number
          p_lng?: number
          p_method_code?: string
          p_order_amount?: number
          p_slot_id?: string
        }
        Returns: Json
      }
      release_delivery_slot: {
        Args: { p_owner_id: string; p_owner_type: string }
        Returns: number
      }
      release_stock: {
        Args: {
          p_owner_id: string
          p_owner_type: string
          p_variant_id?: string
        }
        Returns: number
      }
      remind_expiring_payments: { Args: never; Returns: number }
      remind_pending_orders: { Args: never; Returns: number }
      reserve_delivery_slot: {
        Args: {
          p_day: string
          p_owner_id: string
          p_owner_type: string
          p_slot_id: string
        }
        Returns: Json
      }
      reserve_stock: {
        Args: {
          p_owner_id: string
          p_owner_type: string
          p_qty: number
          p_ttl_seconds?: number
          p_variant_id: string
        }
        Returns: Json
      }
      reset_rate_limit: { Args: { p_key: string }; Returns: undefined }
      resolve_login_email: {
        Args: { p_kind: string; p_value: string }
        Returns: string
      }
      set_user_role: {
        Args: { p_id: string; p_role: string }
        Returns: undefined
      }
      setting_bool: {
        Args: { p_default: boolean; p_key: string }
        Returns: boolean
      }
      setting_int: {
        Args: { p_default: number; p_key: string }
        Returns: number
      }
      slugify: { Args: { p_text: string }; Returns: string }
      stock_status: {
        Args: { p_available: number; p_critical: number; p_low: number }
        Returns: string
      }
      storage_path_ok: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      transition_order_status: {
        Args: {
          p_actor: string
          p_actor_kind: string
          p_order_id: string
          p_reason?: string
          p_to: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
