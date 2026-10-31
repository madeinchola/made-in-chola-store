
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_role": string,"diff": NonNullable<Json>,"id": number,"occurred_at": string,"record_id": string | null,"table_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_role": string,"diff": NonNullable<Json>,"id"?: never,"occurred_at"?: string,"record_id"?: string | null,"table_name": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_role"?: string,"diff"?: NonNullable<Json>,"id"?: never,"occurred_at"?: string,"record_id"?: string | null,"table_name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"categories": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"description": string | null,"id": string,"name": string,"parent_id": string | null,"slug": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"name": string,"parent_id"?: string | null,"slug": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"name"?: string,"parent_id"?: string | null,"slug"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "categories_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "public_categories"
      referencedColumns: ["id"]
    }
                  ]
                },"collections": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"description": string | null,"ends_at": string | null,"id": string,"name": string,"slug": string,"sort_order": number,"starts_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"description"?: string | null,"ends_at"?: string | null,"id"?: string,"name": string,"slug": string,"sort_order"?: number,"starts_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"description"?: string | null,"ends_at"?: string | null,"id"?: string,"name"?: string,"slug"?: string,"sort_order"?: number,"starts_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"countries": {
                  Row: {
                    "code": string,"created_at": string,"currency_code": string,"enabled": boolean,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"currency_code": string,"enabled"?: boolean,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"currency_code"?: string,"enabled"?: boolean,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "countries_currency_code_fkey"
      columns: ["currency_code"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    }
                  ]
                },"currencies": {
                  Row: {
                    "code": string,"created_at": string,"decimals": number,"enabled": boolean,"name": string,"symbol": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"decimals"?: number,"enabled"?: boolean,"name": string,"symbol": string,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"decimals"?: number,"enabled"?: boolean,"name"?: string,"symbol"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"exchange_rates": {
                  Row: {
                    "created_at": string,"created_by": string | null,"from_currency": string,"id": number,"mode": string,"rate": number,"to_currency": string,"valid_from": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"from_currency"?: string,"id"?: never,"mode"?: string,"rate": number,"to_currency": string,"valid_from"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"from_currency"?: string,"id"?: never,"mode"?: string,"rate"?: number,"to_currency"?: string,"valid_from"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "exchange_rates_from_currency_fkey"
      columns: ["from_currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "exchange_rates_to_currency_fkey"
      columns: ["to_currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    }
                  ]
                },"home_section_items": {
                  Row: {
                    "archived_at": string | null,"category_id": string | null,"collection_id": string | null,"created_at": string,"id": string,"label": string | null,"link_url": string | null,"media_alt": string | null,"media_kind": string,"media_path": string | null,"product_id": string | null,"section_id": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"category_id"?: string | null,"collection_id"?: string | null,"created_at"?: string,"id"?: string,"label"?: string | null,"link_url"?: string | null,"media_alt"?: string | null,"media_kind"?: string,"media_path"?: string | null,"product_id"?: string | null,"section_id": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"category_id"?: string | null,"collection_id"?: string | null,"created_at"?: string,"id"?: string,"label"?: string | null,"link_url"?: string | null,"media_alt"?: string | null,"media_kind"?: string,"media_path"?: string | null,"product_id"?: string | null,"section_id"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "home_section_items_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "home_section_items_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "public_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "home_section_items_collection_id_fkey"
      columns: ["collection_id"]
isOneToOne: false
      referencedRelation: "collections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "home_section_items_collection_id_fkey"
      columns: ["collection_id"]
isOneToOne: false
      referencedRelation: "public_collections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "home_section_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "home_section_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "home_section_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "home_section_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "home_section_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "home_section_items_section_id_fkey"
      columns: ["section_id"]
isOneToOne: false
      referencedRelation: "home_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "home_section_items_section_id_fkey"
      columns: ["section_id"]
isOneToOne: false
      referencedRelation: "public_home_sections"
      referencedColumns: ["id"]
    }
                  ]
                },"home_sections": {
                  Row: {
                    "archived_at": string | null,"body": string | null,"created_at": string,"cta_label": string | null,"cta_url": string | null,"id": string,"is_active": boolean,"item_limit": number,"kind": string,"media_alt": string | null,"media_kind": string,"media_path": string | null,"sort_order": number,"source_category_id": string | null,"source_collection_id": string | null,"source_type": string,"title": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"body"?: string | null,"created_at"?: string,"cta_label"?: string | null,"cta_url"?: string | null,"id"?: string,"is_active"?: boolean,"item_limit"?: number,"kind": string,"media_alt"?: string | null,"media_kind"?: string,"media_path"?: string | null,"sort_order"?: number,"source_category_id"?: string | null,"source_collection_id"?: string | null,"source_type"?: string,"title"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"body"?: string | null,"created_at"?: string,"cta_label"?: string | null,"cta_url"?: string | null,"id"?: string,"is_active"?: boolean,"item_limit"?: number,"kind"?: string,"media_alt"?: string | null,"media_kind"?: string,"media_path"?: string | null,"sort_order"?: number,"source_category_id"?: string | null,"source_collection_id"?: string | null,"source_type"?: string,"title"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "home_sections_source_category_id_fkey"
      columns: ["source_category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "home_sections_source_category_id_fkey"
      columns: ["source_category_id"]
isOneToOne: false
      referencedRelation: "public_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "home_sections_source_collection_id_fkey"
      columns: ["source_collection_id"]
isOneToOne: false
      referencedRelation: "collections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "home_sections_source_collection_id_fkey"
      columns: ["source_collection_id"]
isOneToOne: false
      referencedRelation: "public_collections"
      referencedColumns: ["id"]
    }
                  ]
                },"news_banners": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"ends_at": string | null,"id": string,"is_active": boolean,"link_url": string | null,"message": string,"starts_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"ends_at"?: string | null,"id"?: string,"is_active"?: boolean,"link_url"?: string | null,"message": string,"starts_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"ends_at"?: string | null,"id"?: string,"is_active"?: boolean,"link_url"?: string | null,"message"?: string,"starts_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"notification_outbox": {
                  Row: {
                    "attempts": number,"channel": string,"created_at": string,"dedupe_key": string,"id": number,"next_retry_at": string,"payload": NonNullable<Json>,"recipient": string | null,"status": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"channel": string,"created_at"?: string,"dedupe_key": string,"id"?: never,"next_retry_at"?: string,"payload"?: NonNullable<Json>,"recipient"?: string | null,"status"?: string,"type": string
                  }
                  Update: {
                    "attempts"?: number,"channel"?: string,"created_at"?: string,"dedupe_key"?: string,"id"?: never,"next_retry_at"?: string,"payload"?: NonNullable<Json>,"recipient"?: string | null,"status"?: string,"type"?: string
                  }
                  Relationships: [
                    
                  ]
                },"product_categories": {
                  Row: {
                    "category_id": string,"created_at": string,"product_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id": string,"created_at"?: string,"product_id": string
                  }
                  Update: {
                    "category_id"?: string,"created_at"?: string,"product_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_categories_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "public_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_categories_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_collections": {
                  Row: {
                    "collection_id": string,"created_at": string,"product_id": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "collection_id": string,"created_at"?: string,"product_id": string,"sort_order"?: number
                  }
                  Update: {
                    "collection_id"?: string,"created_at"?: string,"product_id"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_collections_collection_id_fkey"
      columns: ["collection_id"]
isOneToOne: false
      referencedRelation: "collections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_collections_collection_id_fkey"
      columns: ["collection_id"]
isOneToOne: false
      referencedRelation: "public_collections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_collections_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_collections_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_collections_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_collections_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_collections_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_colors": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"hex": string | null,"id": string,"name": string,"product_id": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"hex"?: string | null,"id"?: string,"name": string,"product_id": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"hex"?: string | null,"id"?: string,"name"?: string,"product_id"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_colors_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_colors_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_colors_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_colors_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_colors_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_images": {
                  Row: {
                    "alt": string | null,"archived_at": string | null,"color_id": string | null,"created_at": string,"id": string,"path": string,"product_id": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alt"?: string | null,"archived_at"?: string | null,"color_id"?: string | null,"created_at"?: string,"id"?: string,"path": string,"product_id": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "alt"?: string | null,"archived_at"?: string | null,"color_id"?: string | null,"created_at"?: string,"id"?: string,"path"?: string,"product_id"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_images_color_fk"
      columns: ["color_id","product_id"]
isOneToOne: false
      referencedRelation: "product_colors"
      referencedColumns: ["id","product_id"]
    },{
      foreignKeyName: "product_images_color_fk"
      columns: ["color_id","product_id"]
isOneToOne: false
      referencedRelation: "public_product_colors"
      referencedColumns: ["id","product_id"]
    },{
      foreignKeyName: "product_images_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_images_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_images_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_images_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_images_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_prices": {
                  Row: {
                    "amount": number,"country": string | null,"created_at": string,"currency": string,"id": string,"product_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"country"?: string | null,"created_at"?: string,"currency": string,"id"?: string,"product_id": string,"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number,"country"?: string | null,"created_at"?: string,"currency"?: string,"id"?: string,"product_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_prices_country_fkey"
      columns: ["country"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "product_prices_currency_fkey"
      columns: ["currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "product_prices_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_prices_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_prices_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_prices_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_prices_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_related": {
                  Row: {
                    "created_at": string,"product_id": string,"related_id": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"product_id": string,"related_id": string,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"product_id"?: string,"related_id"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_related_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_related_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_related_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_related_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_related_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_related_related_id_fkey"
      columns: ["related_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_related_related_id_fkey"
      columns: ["related_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_related_related_id_fkey"
      columns: ["related_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_related_related_id_fkey"
      columns: ["related_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_related_related_id_fkey"
      columns: ["related_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_sizes": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"id": string,"label": string,"product_id": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"id"?: string,"label": string,"product_id": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"id"?: string,"label"?: string,"product_id"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_sizes_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_sizes_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_sizes_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_sizes_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_sizes_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_slug_history": {
                  Row: {
                    "changed_at": string,"changed_by": string | null,"id": number,"product_id": string,"slug": string,"was_public": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "changed_at"?: string,"changed_by"?: string | null,"id"?: never,"product_id": string,"slug": string,"was_public"?: boolean
                  }
                  Update: {
                    "changed_at"?: string,"changed_by"?: string | null,"id"?: never,"product_id"?: string,"slug"?: string,"was_public"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_slug_history_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_slug_history_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_slug_history_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_slug_history_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_slug_history_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_variants": {
                  Row: {
                    "archived_at": string | null,"color_id": string,"created_at": string,"critical_threshold": number | null,"id": string,"low_threshold": number | null,"product_id": string,"size_id": string | null,"sku": string,"stock_on_hand": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"color_id": string,"created_at"?: string,"critical_threshold"?: number | null,"id"?: string,"low_threshold"?: number | null,"product_id": string,"size_id"?: string | null,"sku": string,"stock_on_hand"?: number,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"color_id"?: string,"created_at"?: string,"critical_threshold"?: number | null,"id"?: string,"low_threshold"?: number | null,"product_id"?: string,"size_id"?: string | null,"sku"?: string,"stock_on_hand"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_variants_color_fk"
      columns: ["color_id","product_id"]
isOneToOne: false
      referencedRelation: "product_colors"
      referencedColumns: ["id","product_id"]
    },{
      foreignKeyName: "product_variants_color_fk"
      columns: ["color_id","product_id"]
isOneToOne: false
      referencedRelation: "public_product_colors"
      referencedColumns: ["id","product_id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variants_size_fk"
      columns: ["size_id","product_id"]
isOneToOne: false
      referencedRelation: "product_sizes"
      referencedColumns: ["id","product_id"]
    },{
      foreignKeyName: "product_variants_size_fk"
      columns: ["size_id","product_id"]
isOneToOne: false
      referencedRelation: "public_product_sizes"
      referencedColumns: ["id","product_id"]
    }
                  ]
                },"products": {
                  Row: {
                    "allow_converted_prices": boolean,"archived_at": string | null,"code": string,"cost_base": number | null,"created_at": string,"description": string,"id": string,"is_new": boolean,"materials": string | null,"model": string | null,"name": string,"out_of_stock_behavior": string,"slug": string,"status": string,"updated_at": string,"washcare": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "allow_converted_prices"?: boolean,"archived_at"?: string | null,"code": string,"cost_base"?: number | null,"created_at"?: string,"description"?: string,"id"?: string,"is_new"?: boolean,"materials"?: string | null,"model"?: string | null,"name": string,"out_of_stock_behavior"?: string,"slug": string,"status"?: string,"updated_at"?: string,"washcare"?: string | null
                  }
                  Update: {
                    "allow_converted_prices"?: boolean,"archived_at"?: string | null,"code"?: string,"cost_base"?: number | null,"created_at"?: string,"description"?: string,"id"?: string,"is_new"?: boolean,"materials"?: string | null,"model"?: string | null,"name"?: string,"out_of_stock_behavior"?: string,"slug"?: string,"status"?: string,"updated_at"?: string,"washcare"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "anonymized_at": string | null,"blacklisted": boolean,"created_at": string,"email": string | null,"full_name": string,"id": string,"is_active": boolean,"phone_e164": string | null,"role": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "anonymized_at"?: string | null,"blacklisted"?: boolean,"created_at"?: string,"email"?: string | null,"full_name": string,"id": string,"is_active"?: boolean,"phone_e164"?: string | null,"role"?: string,"updated_at"?: string
                  }
                  Update: {
                    "anonymized_at"?: string | null,"blacklisted"?: boolean,"created_at"?: string,"email"?: string | null,"full_name"?: string,"id"?: string,"is_active"?: boolean,"phone_e164"?: string | null,"role"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"rate_limits": {
                  Row: {
                    "hits": number,"key": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hits"?: number,"key": string,"window_start"?: string
                  }
                  Update: {
                    "hits"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"stock_movements": {
                  Row: {
                    "created_at": string,"created_by": string | null,"delta": number,"id": number,"note": string | null,"reason": string,"ref": string | null,"stock_after": number,"variant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"delta": number,"id"?: never,"note"?: string | null,"reason": string,"ref"?: string | null,"stock_after": number,"variant_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"delta"?: number,"id"?: never,"note"?: string | null,"reason"?: string,"ref"?: string | null,"stock_after"?: number,"variant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_movements_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "admin_stock_overview"
      referencedColumns: ["variant_id"]
    },{
      foreignKeyName: "stock_movements_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "product_variants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "public_product_variants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "variant_availability"
      referencedColumns: ["variant_id"]
    }
                  ]
                },"stock_reservations": {
                  Row: {
                    "created_at": string,"expires_at": string | null,"id": string,"owner_id": string,"owner_type": string,"qty": number,"status": string,"updated_at": string,"variant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at"?: string | null,"id"?: string,"owner_id": string,"owner_type": string,"qty": number,"status"?: string,"updated_at"?: string,"variant_id": string
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string | null,"id"?: string,"owner_id"?: string,"owner_type"?: string,"qty"?: number,"status"?: string,"updated_at"?: string,"variant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_reservations_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "admin_stock_overview"
      referencedColumns: ["variant_id"]
    },{
      foreignKeyName: "stock_reservations_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "product_variants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_reservations_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "public_product_variants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_reservations_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "variant_availability"
      referencedColumns: ["variant_id"]
    }
                  ]
                },"store_settings": {
                  Row: {
                    "created_at": string,"description": string | null,"is_public": boolean,"key": string,"updated_at": string,"value": NonNullable<Json>,"value_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"is_public"?: boolean,"key": string,"updated_at"?: string,"value": NonNullable<Json>,"value_type": string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"is_public"?: boolean,"key"?: string,"updated_at"?: string,"value"?: NonNullable<Json>,"value_type"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "admin_product_list": {
                  Row: {
                    "archived_at": string | null,"category_ids": (string)[] | null,"code": string | null,"collection_ids": (string)[] | null,"cover_path": string | null,"created_at": string | null,"display_state": string | null,"id": string | null,"is_new": boolean | null,"name": string | null,"out_of_stock_behavior": string | null,"price_bob": number | null,"slug": string | null,"status": string | null,"total_available": number | null,"total_on_hand": number | null,"updated_at": string | null,"variants_count": number | null,"variants_out": number | null,"worst_light": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"admin_product_stock": {
                  Row: {
                    "archived_at": string | null,"code": string | null,"name": string | null,"product_id": string | null,"status": string | null,"total_available": number | null,"total_on_hand": number | null,"variants_count": number | null,"variants_out": number | null,"worst_light": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"admin_stock_overview": {
                  Row: {
                    "available": number | null,"color_name": string | null,"critical_threshold": number | null,"low_threshold": number | null,"product_code": string | null,"product_id": string | null,"product_name": string | null,"product_status": string | null,"reserved": number | null,"size_label": string | null,"sku": string | null,"stock_light": string | null,"stock_on_hand": number | null,"variant_archived_at": string | null,"variant_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"public_categories": {
                  Row: {
                    "description": string | null,"id": string | null,"name": string | null,"parent_id": string | null,"slug": string | null,"sort_order": number | null
                  }
                  ComputedFields: never
                  Insert: {
                           "description"?: string | null,"id"?: string | null,"name"?: string | null,"parent_id"?: string | null,"slug"?: string | null,"sort_order"?: number | null
                         }
                        Update: {
                           "description"?: string | null,"id"?: string | null,"name"?: string | null,"parent_id"?: string | null,"slug"?: string | null,"sort_order"?: number | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "categories_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "categories_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "public_categories"
      referencedColumns: ["id"]
    }
                  ]
                },"public_collections": {
                  Row: {
                    "description": string | null,"ends_at": string | null,"id": string | null,"name": string | null,"slug": string | null,"sort_order": number | null,"starts_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "description"?: string | null,"ends_at"?: string | null,"id"?: string | null,"name"?: string | null,"slug"?: string | null,"sort_order"?: number | null,"starts_at"?: string | null
                         }
                        Update: {
                           "description"?: string | null,"ends_at"?: string | null,"id"?: string | null,"name"?: string | null,"slug"?: string | null,"sort_order"?: number | null,"starts_at"?: string | null
                         }
                        Relationships: [
                    
                  ]
                },"public_home_section_items": {
                  Row: {
                    "category_id": string | null,"collection_id": string | null,"id": string | null,"label": string | null,"link_url": string | null,"media_alt": string | null,"media_kind": string | null,"media_path": string | null,"product_id": string | null,"section_id": string | null,"sort_order": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "home_section_items_section_id_fkey"
      columns: ["section_id"]
isOneToOne: false
      referencedRelation: "home_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "home_section_items_section_id_fkey"
      columns: ["section_id"]
isOneToOne: false
      referencedRelation: "public_home_sections"
      referencedColumns: ["id"]
    }
                  ]
                },"public_home_sections": {
                  Row: {
                    "body": string | null,"cta_label": string | null,"cta_url": string | null,"id": string | null,"item_limit": number | null,"kind": string | null,"media_alt": string | null,"media_kind": string | null,"media_path": string | null,"sort_order": number | null,"source_category_id": string | null,"source_collection_id": string | null,"source_type": string | null,"title": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "body"?: string | null,"cta_label"?: string | null,"cta_url"?: string | null,"id"?: string | null,"item_limit"?: number | null,"kind"?: string | null,"media_alt"?: string | null,"media_kind"?: string | null,"media_path"?: string | null,"sort_order"?: number | null,"source_category_id"?: never,"source_collection_id"?: never,"source_type"?: string | null,"title"?: string | null
                         }
                        Update: {
                           "body"?: string | null,"cta_label"?: string | null,"cta_url"?: string | null,"id"?: string | null,"item_limit"?: number | null,"kind"?: string | null,"media_alt"?: string | null,"media_kind"?: string | null,"media_path"?: string | null,"sort_order"?: number | null,"source_category_id"?: never,"source_collection_id"?: never,"source_type"?: string | null,"title"?: string | null
                         }
                        Relationships: [
                    
                  ]
                },"public_news_banners": {
                  Row: {
                    "ends_at": string | null,"id": string | null,"link_url": string | null,"message": string | null,"starts_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "ends_at"?: string | null,"id"?: string | null,"link_url"?: string | null,"message"?: string | null,"starts_at"?: string | null
                         }
                        Update: {
                           "ends_at"?: string | null,"id"?: string | null,"link_url"?: string | null,"message"?: string | null,"starts_at"?: string | null
                         }
                        Relationships: [
                    
                  ]
                },"public_product_categories": {
                  Row: {
                    "category_id": string | null,"product_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "category_id"?: string | null,"product_id"?: string | null
                         }
                        Update: {
                           "category_id"?: string | null,"product_id"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "product_categories_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "public_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_categories_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"public_product_collections": {
                  Row: {
                    "collection_id": string | null,"product_id": string | null,"sort_order": number | null
                  }
                  ComputedFields: never
                  Insert: {
                           "collection_id"?: string | null,"product_id"?: string | null,"sort_order"?: number | null
                         }
                        Update: {
                           "collection_id"?: string | null,"product_id"?: string | null,"sort_order"?: number | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "product_collections_collection_id_fkey"
      columns: ["collection_id"]
isOneToOne: false
      referencedRelation: "collections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_collections_collection_id_fkey"
      columns: ["collection_id"]
isOneToOne: false
      referencedRelation: "public_collections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_collections_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_collections_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_collections_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_collections_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_collections_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"public_product_colors": {
                  Row: {
                    "hex": string | null,"id": string | null,"name": string | null,"product_id": string | null,"sort_order": number | null
                  }
                  ComputedFields: never
                  Insert: {
                           "hex"?: string | null,"id"?: string | null,"name"?: string | null,"product_id"?: string | null,"sort_order"?: number | null
                         }
                        Update: {
                           "hex"?: string | null,"id"?: string | null,"name"?: string | null,"product_id"?: string | null,"sort_order"?: number | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "product_colors_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_colors_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_colors_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_colors_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_colors_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"public_product_detail": {
                  Row: {
                    "colors_count": number | null,"cover_alt": string | null,"cover_path": string | null,"created_at": string | null,"description": string | null,"id": string | null,"is_new": boolean | null,"materials": string | null,"model": string | null,"name": string | null,"price_bob": number | null,"slug": string | null,"sold_out": boolean | null,"washcare": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"public_product_images": {
                  Row: {
                    "alt": string | null,"color_id": string | null,"id": string | null,"path": string | null,"product_id": string | null,"sort_order": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "product_images_color_fk"
      columns: ["color_id","product_id"]
isOneToOne: false
      referencedRelation: "product_colors"
      referencedColumns: ["id","product_id"]
    },{
      foreignKeyName: "product_images_color_fk"
      columns: ["color_id","product_id"]
isOneToOne: false
      referencedRelation: "public_product_colors"
      referencedColumns: ["id","product_id"]
    },{
      foreignKeyName: "product_images_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_images_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_images_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_images_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_images_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"public_product_related": {
                  Row: {
                    "product_id": string | null,"related_id": string | null,"sort_order": number | null
                  }
                  ComputedFields: never
                  Insert: {
                           "product_id"?: string | null,"related_id"?: string | null,"sort_order"?: number | null
                         }
                        Update: {
                           "product_id"?: string | null,"related_id"?: string | null,"sort_order"?: number | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "product_related_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_related_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_related_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_related_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_related_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_related_related_id_fkey"
      columns: ["related_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_related_related_id_fkey"
      columns: ["related_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_related_related_id_fkey"
      columns: ["related_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_related_related_id_fkey"
      columns: ["related_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_related_related_id_fkey"
      columns: ["related_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"public_product_sizes": {
                  Row: {
                    "id": string | null,"label": string | null,"product_id": string | null,"sort_order": number | null
                  }
                  ComputedFields: never
                  Insert: {
                           "id"?: string | null,"label"?: string | null,"product_id"?: string | null,"sort_order"?: number | null
                         }
                        Update: {
                           "id"?: string | null,"label"?: string | null,"product_id"?: string | null,"sort_order"?: number | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "product_sizes_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_sizes_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_sizes_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_sizes_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_sizes_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                },"public_product_slug_redirects": {
                  Row: {
                    "current_slug": string | null,"old_slug": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"public_product_variants": {
                  Row: {
                    "color_id": string | null,"id": string | null,"product_id": string | null,"size_id": string | null,"stock_status": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "product_variants_color_fk"
      columns: ["color_id","product_id"]
isOneToOne: false
      referencedRelation: "product_colors"
      referencedColumns: ["id","product_id"]
    },{
      foreignKeyName: "product_variants_color_fk"
      columns: ["color_id","product_id"]
isOneToOne: false
      referencedRelation: "public_product_colors"
      referencedColumns: ["id","product_id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variants_size_fk"
      columns: ["size_id","product_id"]
isOneToOne: false
      referencedRelation: "product_sizes"
      referencedColumns: ["id","product_id"]
    },{
      foreignKeyName: "product_variants_size_fk"
      columns: ["size_id","product_id"]
isOneToOne: false
      referencedRelation: "public_product_sizes"
      referencedColumns: ["id","product_id"]
    }
                  ]
                },"public_products": {
                  Row: {
                    "colors_count": number | null,"cover_alt": string | null,"cover_path": string | null,"created_at": string | null,"id": string | null,"is_new": boolean | null,"name": string | null,"price_bob": number | null,"slug": string | null,"sold_out": boolean | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"public_store_settings": {
                  Row: {
                    "key": string | null,"value": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                           "key"?: string | null,"value"?: Json | null
                         }
                        Update: {
                           "key"?: string | null,"value"?: Json | null
                         }
                        Relationships: [
                    
                  ]
                },"variant_availability": {
                  Row: {
                    "availability_light": string | null,"available": number | null,"critical_threshold": number | null,"low_threshold": number | null,"product_id": string | null,"reserved": number | null,"stock_light": string | null,"stock_on_hand": number | null,"variant_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "admin_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_product_detail"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variants_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "public_products"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "_apply_admin_rls":
{ Args: { "p_insert_cols": (string)[],"p_table": string,"p_update_cols": (string)[] }; Returns: undefined
                           },
"adjust_stock":
{ Args: { "p_delta": number,"p_note"?: string,"p_reason": string,"p_variant_id": string }; Returns: number
                           },
"admin_delete_product_price":
{ Args: { "p_country"?: string,"p_currency": string,"p_product_id": string }; Returns: undefined
                           },
"admin_duplicate_product":
{ Args: { "p_new_code": string,"p_new_name": string,"p_product_id": string }; Returns: string
                           },
"admin_set_product_categories":
{ Args: { "p_category_ids": (string)[],"p_product_id": string }; Returns: undefined
                           },
"admin_set_product_collections":
{ Args: { "p_collection_ids": (string)[],"p_product_id": string }; Returns: undefined
                           },
"admin_set_product_related":
{ Args: { "p_product_id": string,"p_related_ids": (string)[] }; Returns: undefined
                           },
"admin_set_stock":
{ Args: { "p_expected": number,"p_new": number,"p_note"?: string,"p_reason": string,"p_variant_id": string }; Returns: number
                           },
"apply_stock_change":
{ Args: { "p_delta": number,"p_note"?: string,"p_reason": string,"p_ref"?: string,"p_user"?: string,"p_variant_id": string }; Returns: number
                           },
"check_rate_limit":
{ Args: { "p_key": string,"p_max": number,"p_window_seconds": number }; Returns: {
              "allowed": boolean,"hit_count": number,"retry_after_seconds": number
            }[]
                           },
"current_app_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"current_rate":
{ Args: { "p_from": string,"p_to": string }; Returns: number
                           },
"deactivate_profile":
{ Args: { "p_anonymize"?: boolean,"p_id": string }; Returns: undefined
                           },
"enqueue_notification":
{ Args: { "p_channel": string,"p_dedupe_key": string,"p_payload": Json,"p_recipient": string,"p_type": string }; Returns: number
                           },
"expire_reservations":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"f_unaccent":
{ Args: { "p_text": string }; Returns: string
                           },
"healthcheck":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"home_media_ok":
{ Args: { "p_kind": string,"p_path": string }; Returns: boolean
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_safe_link":
{ Args: { "p_url": string }; Returns: boolean
                           },
"price_for":
{ Args: { "p_country"?: string,"p_currency"?: string,"p_product_id": string }; Returns: number
                           },
"promote_admin":
{ Args: { "p_email": string }; Returns: string
                           },
"public_price_for":
{ Args: { "p_country"?: string,"p_currency"?: string,"p_product_id": string }; Returns: number
                           },
"public_search_products":
{ Args: { "p_limit"?: number,"p_query": string }; Returns: {
              "colors_count": number | null,
"cover_alt": string | null,
"cover_path": string | null,
"created_at": string | null,
"id": string | null,
"is_new": boolean | null,
"name": string | null,
"price_bob": number | null,
"slug": string | null,
"sold_out": boolean | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "public_products"
        isOneToOne: false
        isSetofReturn: true
      } },
"purge_stock_reservations":
{ Args: { "p_older_than"?: string }; Returns: number
                           },
"release_stock":
{ Args: { "p_owner_id": string,"p_owner_type": string,"p_variant_id"?: string }; Returns: number
                           },
"reserve_stock":
{ Args: { "p_owner_id": string,"p_owner_type": string,"p_qty": number,"p_ttl_seconds"?: number,"p_variant_id": string }; Returns: Json
                           },
"reset_rate_limit":
{ Args: { "p_key": string }; Returns: undefined
                           },
"resolve_login_email":
{ Args: { "p_kind": string,"p_value": string }; Returns: string
                           },
"set_user_role":
{ Args: { "p_id": string,"p_role": string }; Returns: undefined
                           },
"setting_int":
{ Args: { "p_default": number,"p_key": string }; Returns: number
                           },
"slugify":
{ Args: { "p_text": string }; Returns: string
                           },
"stock_status":
{ Args: { "p_available": number,"p_critical": number,"p_low": number }; Returns: string
                           },
"storage_path_ok":
{ Args: { "p_bucket": string,"p_name": string }; Returns: boolean
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
