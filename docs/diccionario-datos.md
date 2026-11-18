# Diccionario de datos

> **Generado** por `npm run docs:data-dictionary` desde el catálogo real de la base (no se edita a mano: vuelve a generarlo). `npm run docs:data-dictionary -- --check` falla si este archivo ya no coincide con la base.

**69 tablas**, 24 vistas y 203 funciones en el esquema `public`. «Sesión» = una persona con la cuenta iniciada (clienta o administradora; la RLS decide qué filas ve). Nada se borra: el catálogo se archiva y los pedidos y el historial son inmutables.

## Tablas

| Tabla | Columnas | Quién la toca desde el navegador |
| --- | ---: | --- |
| [`addresses`](#addresses) | 19 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`audit_log`](#audit_log) | 8 | la lee una sesión (filtrada por RLS) |
| [`blacklist_entries`](#blacklist_entries) | 13 | la lee una sesión (filtrada por RLS) |
| [`blocked_dates`](#blocked_dates) | 6 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`cart_items`](#cart_items) | 8 | la lee una sesión (filtrada por RLS) |
| [`cart_removed_items`](#cart_removed_items) | 6 | la lee una sesión (filtrada por RLS) |
| [`carts`](#carts) | 11 | la lee una sesión (filtrada por RLS) |
| [`categories`](#categories) | 9 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`collections`](#collections) | 10 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`complaints`](#complaints) | 17 | cerrada al navegador (solo funciones del servidor) |
| [`countries`](#countries) | 6 | la lee una sesión (filtrada por RLS) · una sesión actualiza |
| [`coupons`](#coupons) | 11 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`currencies`](#currencies) | 7 | la lee una sesión (filtrada por RLS) · una sesión actualiza |
| [`customer_group_members`](#customer_group_members) | 6 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`customer_groups`](#customer_groups) | 6 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`delivery_bookings`](#delivery_bookings) | 8 | la lee una sesión (filtrada por RLS) |
| [`delivery_slots`](#delivery_slots) | 10 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`discount_redemptions`](#discount_redemptions) | 11 | la lee una sesión (filtrada por RLS) |
| [`discount_targets`](#discount_targets) | 8 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`discounts`](#discounts) | 20 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`exchange_rates`](#exchange_rates) | 8 | la lee una sesión (filtrada por RLS) · una sesión inserta |
| [`home_section_items`](#home_section_items) | 14 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`home_sections`](#home_sections) | 18 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`import_batch_rows`](#import_batch_rows) | 11 | cerrada al navegador (solo funciones del servidor) |
| [`import_batches`](#import_batches) | 14 | cerrada al navegador (solo funciones del servidor) |
| [`legal_acceptances`](#legal_acceptances) | 8 | cerrada al navegador (solo funciones del servidor) |
| [`legal_documents`](#legal_documents) | 4 | cerrada al navegador (solo funciones del servidor) |
| [`legal_versions`](#legal_versions) | 12 | cerrada al navegador (solo funciones del servidor) |
| [`news_banners`](#news_banners) | 9 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`notification_outbox`](#notification_outbox) | 25 | la lee una sesión (filtrada por RLS) |
| [`notification_preferences`](#notification_preferences) | 8 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`notification_templates`](#notification_templates) | 13 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`order_attribution`](#order_attribution) | 10 | cerrada al navegador (solo funciones del servidor) |
| [`order_counters`](#order_counters) | 2 | la lee una sesión (filtrada por RLS) |
| [`order_edits`](#order_edits) | 8 | la lee una sesión (filtrada por RLS) |
| [`order_incidents`](#order_incidents) | 13 | la lee una sesión (filtrada por RLS) |
| [`order_items`](#order_items) | 18 | la lee una sesión (filtrada por RLS) |
| [`order_notes`](#order_notes) | 5 | la lee una sesión (filtrada por RLS) |
| [`order_return_items`](#order_return_items) | 7 | la lee una sesión (filtrada por RLS) |
| [`order_returns`](#order_returns) | 11 | la lee una sesión (filtrada por RLS) |
| [`order_status_history`](#order_status_history) | 8 | la lee una sesión (filtrada por RLS) |
| [`orders`](#orders) | 39 | la lee una sesión (filtrada por RLS) |
| [`payment_methods`](#payment_methods) | 16 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`payment_proofs`](#payment_proofs) | 15 | la lee una sesión (filtrada por RLS) |
| [`payment_reviews`](#payment_reviews) | 9 | la lee una sesión (filtrada por RLS) |
| [`payments`](#payments) | 19 | la lee una sesión (filtrada por RLS) |
| [`product_categories`](#product_categories) | 3 | la lee una sesión (filtrada por RLS) |
| [`product_collections`](#product_collections) | 4 | la lee una sesión (filtrada por RLS) · una sesión actualiza |
| [`product_colors`](#product_colors) | 8 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`product_images`](#product_images) | 9 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`product_prices`](#product_prices) | 7 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`product_related`](#product_related) | 4 | la lee una sesión (filtrada por RLS) |
| [`product_sizes`](#product_sizes) | 7 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`product_slug_history`](#product_slug_history) | 6 | la lee una sesión (filtrada por RLS) |
| [`product_variants`](#product_variants) | 11 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`products`](#products) | 16 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`profiles`](#profiles) | 12 | la lee una sesión (filtrada por RLS) · una sesión actualiza |
| [`rate_limits`](#rate_limits) | 3 | cerrada al navegador (solo funciones del servidor) |
| [`refund_items`](#refund_items) | 5 | la lee una sesión (filtrada por RLS) |
| [`refunds`](#refunds) | 22 | la lee una sesión (filtrada por RLS) |
| [`shipping_methods`](#shipping_methods) | 13 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`shipping_rate_rules`](#shipping_rate_rules) | 16 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`shipping_zones`](#shipping_zones) | 12 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`stock_movements`](#stock_movements) | 9 | la lee una sesión (filtrada por RLS) |
| [`stock_reservations`](#stock_reservations) | 9 | la lee una sesión (filtrada por RLS) |
| [`store_locations`](#store_locations) | 12 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`store_settings`](#store_settings) | 7 | la lee una sesión (filtrada por RLS) · una sesión actualiza |
| [`tax_profiles`](#tax_profiles) | 9 | la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza |
| [`webhook_events`](#webhook_events) | 11 | la lee una sesión (filtrada por RLS) |

### addresses

RLS activa · 4 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| profile_id | uuid | no |  | profiles.id | sí |
| label | text | no |  |  | sí |
| recipient | text | no |  |  | sí |
| phone_e164 | text | sí |  |  | sí |
| line1 | text | no |  |  | sí |
| line2 | text | sí |  |  | sí |
| city | text | no |  |  | sí |
| department | text | sí |  |  | sí |
| country | text | no | 'BO'::text | countries.code | sí |
| reference_text | text | sí |  |  | sí |
| lat | numeric(9,6) | sí |  |  | sí |
| lng | numeric(9,6) | sí |  |  | sí |
| is_default | boolean | no | false |  | sí |
| for_shipping | boolean | no | true |  | sí |
| for_billing | boolean | no | false |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### audit_log

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | bigint | no |  |  | sí |
| occurred_at | timestamp with time zone | no | now() |  | sí |
| actor_id | uuid | sí |  |  | sí |
| actor_role | text | no |  |  | sí |
| table_name | text | no |  |  | sí |
| record_id | text | sí |  |  | sí |
| action | text | no |  |  | sí |
| diff | jsonb | no |  |  | sí |

### blacklist_entries

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| kind | text | no |  |  | sí |
| profile_id | uuid | sí |  | profiles.id | sí |
| phone_e164 | text | sí |  |  | sí |
| email | text | sí |  |  | sí |
| reason | text | no |  |  | sí |
| is_active | boolean | no | true |  | sí |
| source_order_id | uuid | sí |  | orders.id | sí |
| created_by | uuid | sí |  | profiles.id | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| lifted_by | uuid | sí |  | profiles.id | sí |
| lifted_at | timestamp with time zone | sí |  |  | sí |
| lift_reason | text | sí |  |  | sí |

### blocked_dates

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| blocked_on | date | no |  |  | sí |
| reason | text | sí |  |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### cart_items

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **cart_id** | uuid | no |  | carts.id | sí |
| **variant_id** | uuid | no |  | product_variants.id | sí |
| qty | integer | no |  |  | sí |
| unit_price_at_add | numeric | no |  |  | sí |
| currency | text | no |  | currencies.code | sí |
| added_at | timestamp with time zone | no | now() |  | sí |
| price_locked_until | timestamp with time zone | no |  |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### cart_removed_items

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **cart_id** | uuid | no |  | carts.id | sí |
| **variant_id** | uuid | no |  | product_variants.id | sí |
| unit_price_at_add | numeric | no |  |  | sí |
| added_at | timestamp with time zone | no |  |  | sí |
| price_locked_until | timestamp with time zone | no |  |  | sí |
| removed_at | timestamp with time zone | no | now() |  | sí |

### carts

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| profile_id | uuid | sí |  | profiles.id | sí |
| token_hash | text | sí |  |  | sí |
| status | text | no | 'active'::text |  | sí |
| currency | text | no |  | currencies.code | sí |
| merged_into | uuid | sí |  | carts.id | sí |
| ip_hash | text | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |
| last_activity_at | timestamp with time zone | no | now() |  | sí |
| coupon_code | text | sí |  |  | sí |

### categories

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| parent_id | uuid | sí |  | categories.id | sí |
| name | text | no |  |  | sí |
| slug | text | no |  |  | sí |
| description | text | sí |  |  | sí |
| sort_order | integer | no | 0 |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### collections

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| name | text | no |  |  | sí |
| slug | text | no |  |  | sí |
| description | text | sí |  |  | sí |
| starts_at | timestamp with time zone | sí |  |  | sí |
| ends_at | timestamp with time zone | sí |  |  | sí |
| sort_order | integer | no | 0 |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### complaints

RLS activa · 0 políticas · cerrada al navegador (solo funciones del servidor).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | no |
| number | text | no | ('REC-'::text \|\| lpad((nextval('complaints_number_seq'::reg… |  | no |
| profile_id | uuid | sí |  | profiles.id | no |
| contact_name | text | no |  |  | no |
| contact_email | text | sí |  |  | no |
| contact_phone | text | sí |  |  | no |
| order_number | text | sí |  |  | no |
| kind | text | no |  |  | no |
| detail | text | no |  |  | no |
| status | text | no | 'new'::text |  | no |
| response | text | sí |  |  | no |
| due_at | timestamp with time zone | no |  |  | no |
| answered_at | timestamp with time zone | sí |  |  | no |
| handled_by | uuid | sí |  |  | no |
| ip_hash | text | sí |  |  | no |
| created_at | timestamp with time zone | no | now() |  | no |
| updated_at | timestamp with time zone | no | now() |  | no |

### countries

RLS activa · 2 políticas · la lee una sesión (filtrada por RLS) · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **code** | text | no |  |  | sí |
| name | text | no |  |  | sí |
| currency_code | text | no |  | currencies.code | sí |
| enabled | boolean | no | false |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### coupons

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| discount_id | uuid | no |  | discounts.id | sí |
| code | text | no |  |  | sí |
| code_normalized | text | sí | _coupon_norm(code) |  | sí |
| is_active | boolean | no | true |  | sí |
| starts_at | timestamp with time zone | sí |  |  | sí |
| ends_at | timestamp with time zone | sí |  |  | sí |
| usage_limit | integer | sí |  |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### currencies

RLS activa · 2 políticas · la lee una sesión (filtrada por RLS) · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **code** | text | no |  |  | sí |
| name | text | no |  |  | sí |
| symbol | text | no |  |  | sí |
| decimals | smallint | no | 2 |  | sí |
| enabled | boolean | no | false |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### customer_group_members

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| group_id | uuid | no |  | customer_groups.id | sí |
| profile_id | uuid | no |  | profiles.id | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### customer_groups

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| name | text | no |  |  | sí |
| description | text | sí |  |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### delivery_bookings

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| slot_id | uuid | no |  | delivery_slots.id | sí |
| delivery_date | date | no |  |  | sí |
| owner_type | text | no |  |  | sí |
| owner_id | uuid | no |  |  | sí |
| status | text | no | 'active'::text |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### delivery_slots

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| method_id | uuid | no |  | shipping_methods.id | sí |
| weekday | smallint | no |  |  | sí |
| start_time | time without time zone | no |  |  | sí |
| end_time | time without time zone | no |  |  | sí |
| capacity | integer | no |  |  | sí |
| is_active | boolean | no | true |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### discount_redemptions

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| discount_id | uuid | no |  | discounts.id | sí |
| coupon_id | uuid | sí |  | coupons.id | sí |
| profile_id | uuid | sí |  | profiles.id | sí |
| owner_type | text | no |  |  | sí |
| owner_id | uuid | no |  |  | sí |
| amount | numeric(14,4) | no |  |  | sí |
| currency | text | no |  | currencies.code | sí |
| status | text | no | 'reserved'::text |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### discount_targets

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| discount_id | uuid | no |  | discounts.id | sí |
| product_id | uuid | sí |  | products.id | sí |
| category_id | uuid | sí |  | categories.id | sí |
| collection_id | uuid | sí |  | collections.id | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### discounts

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| name | text | no |  |  | sí |
| kind | text | no |  |  | sí |
| params | jsonb | no |  |  | sí |
| scope | text | no | 'order'::text |  | sí |
| currency | text | no | 'BOB'::text | currencies.code | sí |
| min_order_amount | numeric(14,4) | sí |  |  | sí |
| customer_group_id | uuid | sí |  | customer_groups.id | sí |
| requires_coupon | boolean | no | false |  | sí |
| stackable_with_automatic | boolean | no | false |  | sí |
| exclude_sale_items | boolean | no | false |  | sí |
| usage_limit_total | integer | sí |  |  | sí |
| usage_limit_per_customer | integer | sí |  |  | sí |
| priority | integer | no | 100 |  | sí |
| starts_at | timestamp with time zone | sí |  |  | sí |
| ends_at | timestamp with time zone | sí |  |  | sí |
| is_active | boolean | no | true |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### exchange_rates

RLS activa · 2 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | bigint | no |  |  | sí |
| from_currency | text | no | 'BOB'::text | currencies.code | sí |
| to_currency | text | no |  | currencies.code | sí |
| rate | numeric(18,8) | no |  |  | sí |
| mode | text | no | 'fixed'::text |  | sí |
| valid_from | timestamp with time zone | no | now() |  | sí |
| created_by | uuid | sí | auth.uid() |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |

### home_section_items

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| section_id | uuid | no |  | home_sections.id | sí |
| sort_order | integer | no | 0 |  | sí |
| label | text | sí |  |  | sí |
| link_url | text | sí |  |  | sí |
| media_kind | text | no | 'none'::text |  | sí |
| media_path | text | sí |  |  | sí |
| media_alt | text | sí |  |  | sí |
| product_id | uuid | sí |  | products.id | sí |
| category_id | uuid | sí |  | categories.id | sí |
| collection_id | uuid | sí |  | collections.id | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### home_sections

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| kind | text | no |  |  | sí |
| sort_order | integer | no | 0 |  | sí |
| is_active | boolean | no | true |  | sí |
| title | text | sí |  |  | sí |
| body | text | sí |  |  | sí |
| cta_label | text | sí |  |  | sí |
| cta_url | text | sí |  |  | sí |
| media_kind | text | no | 'none'::text |  | sí |
| media_path | text | sí |  |  | sí |
| media_alt | text | sí |  |  | sí |
| source_type | text | no | 'none'::text |  | sí |
| source_category_id | uuid | sí |  | categories.id | sí |
| source_collection_id | uuid | sí |  | collections.id | sí |
| item_limit | integer | no | 4 |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### import_batch_rows

RLS activa · 0 políticas · cerrada al navegador (solo funciones del servidor).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | bigint | no |  |  | no |
| batch_id | uuid | no |  | import_batches.id | no |
| row_no | integer | no |  |  | no |
| action | text | no |  |  | no |
| entity | text | sí |  |  | no |
| entity_id | uuid | sí |  |  | no |
| key | text | sí |  |  | no |
| before | jsonb | sí |  |  | no |
| after | jsonb | sí |  |  | no |
| error_codes | jsonb | no | '[]'::jsonb |  | no |
| rolled_back | boolean | no | false |  | no |

### import_batches

RLS activa · 0 políticas · cerrada al navegador (solo funciones del servidor).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | no |
| kind | text | no |  |  | no |
| filename | text | sí |  |  | no |
| status | text | no | 'applying'::text |  | no |
| total_rows | integer | no | 0 |  | no |
| created_count | integer | no | 0 |  | no |
| updated_count | integer | no | 0 |  | no |
| skipped_count | integer | no | 0 |  | no |
| error_count | integer | no | 0 |  | no |
| created_by | uuid | sí |  |  | no |
| created_at | timestamp with time zone | no | now() |  | no |
| finished_at | timestamp with time zone | sí |  |  | no |
| rolled_back_at | timestamp with time zone | sí |  |  | no |
| rolled_back_by | uuid | sí |  |  | no |

### legal_acceptances

RLS activa · 0 políticas · cerrada al navegador (solo funciones del servidor).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | bigint | no |  |  | no |
| profile_id | uuid | sí |  |  | no |
| order_id | uuid | sí |  |  | no |
| context | text | no |  |  | no |
| kind | text | no |  |  | no |
| version | integer | no |  |  | no |
| accepted_at | timestamp with time zone | no | now() |  | no |
| ip_hash | text | sí |  |  | no |

### legal_documents

RLS activa · 0 políticas · cerrada al navegador (solo funciones del servidor).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **kind** | text | no |  |  | no |
| title | text | no |  |  | no |
| requires_acceptance | boolean | no |  |  | no |
| sort_order | integer | no | 0 |  | no |

### legal_versions

RLS activa · 0 políticas · cerrada al navegador (solo funciones del servidor).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | no |
| kind | text | no |  | legal_documents.kind | no |
| version | integer | no |  |  | no |
| body | text | no |  |  | no |
| status | text | no | 'draft'::text |  | no |
| change_note | text | sí |  |  | no |
| effective_at | timestamp with time zone | sí |  |  | no |
| created_by | uuid | sí |  |  | no |
| created_at | timestamp with time zone | no | now() |  | no |
| published_by | uuid | sí |  |  | no |
| published_at | timestamp with time zone | sí |  |  | no |
| updated_at | timestamp with time zone | no | now() |  | no |

### news_banners

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| message | text | no |  |  | sí |
| link_url | text | sí |  |  | sí |
| is_active | boolean | no | true |  | sí |
| starts_at | timestamp with time zone | sí |  |  | sí |
| ends_at | timestamp with time zone | sí |  |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### notification_outbox

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | bigint | no |  |  | sí |
| type | text | no |  |  | sí |
| channel | text | no |  |  | sí |
| recipient | text | sí |  |  | sí |
| payload | jsonb | no | '{}'::jsonb |  | sí |
| status | text | no | 'pending'::text |  | sí |
| attempts | integer | no | 0 |  | sí |
| next_retry_at | timestamp with time zone | no | now() |  | sí |
| dedupe_key | text | no |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| template | text | sí |  |  | sí |
| order_id | uuid | sí |  |  | sí |
| profile_id | uuid | sí |  |  | sí |
| sent_at | timestamp with time zone | sí |  |  | sí |
| last_error | text | sí |  |  | sí |
| provider | text | sí |  |  | sí |
| provider_message_id | text | sí |  |  | sí |
| locked_at | timestamp with time zone | sí |  |  | sí |
| locked_by | text | sí |  |  | sí |
| resent_of | bigint | sí |  |  | sí |
| created_by | uuid | sí |  |  | sí |
| sent_by | uuid | sí |  |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |
| rendered_subject | text | sí |  |  | sí |
| rendered_body | text | sí |  |  | sí |

### notification_preferences

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **profile_id** | uuid | no |  | profiles.id | sí |
| id | uuid | sí | profile_id |  | sí |
| preferred_channel | text | no | 'auto'::text |  | sí |
| marketing_email | boolean | no | false |  | sí |
| marketing_whatsapp | boolean | no | false |  | sí |
| marketing_consent_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### notification_templates

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | bigint | no |  |  | sí |
| key | text | no |  |  | sí |
| channel | text | no |  |  | sí |
| locale | text | no | 'es'::text |  | sí |
| audience | text | no |  |  | sí |
| subject | text | no | ''::text |  | sí |
| body | text | no |  |  | sí |
| cta_label | text | sí |  |  | sí |
| active | boolean | no | true |  | sí |
| is_default | boolean | no | true |  | sí |
| updated_by | uuid | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### order_attribution

RLS activa · 0 políticas · cerrada al navegador (solo funciones del servidor).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **order_id** | uuid | no |  | orders.id | no |
| utm_source | text | sí |  |  | no |
| utm_medium | text | sí |  |  | no |
| utm_campaign | text | sí |  |  | no |
| utm_content | text | sí |  |  | no |
| utm_term | text | sí |  |  | no |
| click_id_kind | text | sí |  |  | no |
| landing_path | text | sí |  |  | no |
| referrer_host | text | sí |  |  | no |
| recorded_at | timestamp with time zone | no | now() |  | no |

### order_counters

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **prefix** | text | no |  |  | sí |
| last_value | bigint | no | 0 |  | sí |

### order_edits

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | bigint | no |  |  | sí |
| order_id | uuid | no |  | orders.id | sí |
| actor_id | uuid | sí |  | profiles.id | sí |
| reason | text | no |  |  | sí |
| before | jsonb | no |  |  | sí |
| after | jsonb | no |  |  | sí |
| diff | jsonb | no |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |

### order_incidents

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| order_id | uuid | no |  | orders.id | sí |
| type | text | no |  |  | sí |
| status | text | no | 'open'::text |  | sí |
| description | text | sí |  |  | sí |
| cost_assumed | numeric | no | 0 |  | sí |
| cost_borne_by | text | no | 'store'::text |  | sí |
| resolution | text | sí |  |  | sí |
| opened_by | uuid | sí |  | profiles.id | sí |
| opened_at | timestamp with time zone | no | now() |  | sí |
| resolved_by | uuid | sí |  | profiles.id | sí |
| resolved_at | timestamp with time zone | sí |  |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### order_items

RLS activa · 2 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| order_id | uuid | no |  | orders.id | sí |
| line_no | integer | no |  |  | sí |
| variant_id | uuid | no |  | product_variants.id | sí |
| product_id | uuid | no |  | products.id | sí |
| product_name | text | no |  |  | sí |
| color_name | text | sí |  |  | sí |
| color_hex | text | sí |  |  | sí |
| size_label | text | sí |  |  | sí |
| sku | text | sí |  |  | sí |
| image_path | text | sí |  |  | sí |
| qty | integer | no |  |  | sí |
| unit_price | numeric | no |  |  | sí |
| line_total | numeric | no |  |  | sí |
| discount | numeric | no | 0 |  | sí |
| final_total | numeric | no |  |  | sí |
| cost_unit | numeric | sí |  |  | no |
| discount_offers | jsonb | no | '[]'::jsonb |  | sí |

### order_notes

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | bigint | no |  |  | sí |
| order_id | uuid | no |  | orders.id | sí |
| author_id | uuid | sí |  | profiles.id | sí |
| body | text | no |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |

### order_return_items

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| return_id | uuid | no |  | order_returns.id | sí |
| order_item_id | uuid | no |  | order_items.id | sí |
| qty | integer | no |  |  | sí |
| reason_code | text | no |  |  | sí |
| restock | text | no |  |  | sí |
| restocked_at | timestamp with time zone | sí |  |  | sí |

### order_returns

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| order_id | uuid | no |  | orders.id | sí |
| status | text | no | 'open'::text |  | sí |
| reason | text | no |  |  | sí |
| outside_window | boolean | no | false |  | sí |
| override_reason | text | sí |  |  | sí |
| opened_by | uuid | sí |  | profiles.id | sí |
| opened_at | timestamp with time zone | no | now() |  | sí |
| closed_by | uuid | sí |  | profiles.id | sí |
| closed_at | timestamp with time zone | sí |  |  | sí |
| close_note | text | sí |  |  | sí |

### order_status_history

RLS activa · 2 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | bigint | no |  |  | sí |
| order_id | uuid | no |  | orders.id | sí |
| from_status | text | sí |  |  | sí |
| to_status | text | no |  |  | sí |
| actor_id | uuid | sí |  |  | no |
| actor_kind | text | no |  |  | sí |
| reason | text | sí |  |  | no |
| created_at | timestamp with time zone | no | now() |  | sí |

### orders

RLS activa · 2 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| number | text | no |  |  | sí |
| profile_id | uuid | no |  | profiles.id | sí |
| cart_id | uuid | sí |  | carts.id | sí |
| status | text | no | 'pending_payment'::text |  | sí |
| currency | text | no |  | currencies.code | sí |
| base_currency | text | no |  | currencies.code | sí |
| exchange_rate | numeric(18,8) | no | 1 |  | sí |
| country | text | no |  | countries.code | sí |
| subtotal | numeric | no |  |  | sí |
| discount_total | numeric | no | 0 |  | sí |
| shipping_cost | numeric | no | 0 |  | sí |
| shipping_discount | numeric | no | 0 |  | sí |
| total | numeric | no |  |  | sí |
| tax_included | boolean | no | true |  | sí |
| contact_name | text | no |  |  | sí |
| contact_email | text | sí |  |  | sí |
| contact_phone | text | no |  |  | sí |
| shipping_method | jsonb | no |  |  | sí |
| shipping_address | jsonb | sí |  |  | sí |
| delivery_slot | jsonb | sí |  |  | sí |
| tax_profile | jsonb | sí |  |  | sí |
| payment_method | text | no |  |  | sí |
| payment_provider | text | no |  |  | sí |
| payment_expires_at | timestamp with time zone | sí |  |  | sí |
| coupon_code | text | sí |  |  | sí |
| discounts | jsonb | no | '[]'::jsonb |  | sí |
| idempotency_key | text | no |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |
| paid_at | timestamp with time zone | sí |  |  | sí |
| cancelled_at | timestamp with time zone | sí |  |  | sí |
| cancelled_by | text | sí |  |  | sí |
| cancel_reason | text | sí |  |  | sí |
| reminder_sent_at | timestamp with time zone | sí |  |  | sí |
| request_hash | text | sí |  |  | no |
| channel | text | no | 'web'::text |  | sí |
| edited_at | timestamp with time zone | sí |  |  | sí |
| edit_count | integer | no | 0 |  | sí |

### payment_methods

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| country | text | no |  | countries.code | sí |
| code | text | no |  |  | sí |
| provider | text | no |  |  | sí |
| name | text | no |  |  | sí |
| description | text | sí |  |  | sí |
| is_active | boolean | no | true |  | sí |
| sort_order | integer | no | 0 |  | sí |
| max_amount | numeric | sí |  |  | sí |
| window_minutes | integer | sí |  |  | sí |
| blocked_for_blacklisted | boolean | no | false |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |
| account_details | text | sí |  |  | sí |
| qr_image_path | text | sí |  |  | sí |

### payment_proofs

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| payment_id | uuid | no |  | payments.id | sí |
| order_id | uuid | no |  | orders.id | sí |
| profile_id | uuid | no |  | profiles.id | sí |
| file_path | text | no |  |  | sí |
| file_hash | text | no |  |  | sí |
| mime | text | no |  |  | sí |
| size_bytes | integer | no |  |  | sí |
| status | text | no | 'pending'::text |  | sí |
| reason | text | sí |  |  | sí |
| duplicate_of | uuid | sí |  | payment_proofs.id | sí |
| received_amount | numeric | sí |  |  | sí |
| reviewed_by | uuid | sí |  | profiles.id | sí |
| reviewed_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | clock_timestamp() |  | sí |

### payment_reviews

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| payment_id | uuid | no |  | payments.id | sí |
| reason | text | no |  |  | sí |
| detail | jsonb | no | '{}'::jsonb |  | sí |
| status | text | no | 'open'::text |  | sí |
| note | text | sí |  |  | sí |
| opened_at | timestamp with time zone | no | now() |  | sí |
| resolved_by | uuid | sí |  | profiles.id | sí |
| resolved_at | timestamp with time zone | sí |  |  | sí |

### payments

RLS activa · 2 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| order_id | uuid | no |  | orders.id | sí |
| provider | text | no |  |  | sí |
| method | text | no |  |  | sí |
| status | text | no | 'pending'::text |  | sí |
| amount | numeric | no |  |  | sí |
| currency | text | no |  | currencies.code | sí |
| provider_ref | text | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |
| attempt | smallint | no | 1 |  | sí |
| reference | text | sí |  |  | sí |
| external_id | text | sí |  |  | sí |
| expires_at | timestamp with time zone | sí |  |  | sí |
| received_amount | numeric | sí |  |  | sí |
| paid_at | timestamp with time zone | sí |  |  | sí |
| reminder_sent_at | timestamp with time zone | sí |  |  | sí |
| collected_at | timestamp with time zone | sí |  |  | sí |
| collected_by | uuid | sí |  | profiles.id | no |

### product_categories

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **product_id** | uuid | no |  | products.id | sí |
| **category_id** | uuid | no |  | categories.id | sí |
| created_at | timestamp with time zone | no | now() |  | sí |

### product_collections

RLS activa · 2 políticas · la lee una sesión (filtrada por RLS) · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **product_id** | uuid | no |  | products.id | sí |
| **collection_id** | uuid | no |  | collections.id | sí |
| sort_order | integer | no | 0 |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |

### product_colors

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| product_id | uuid | no |  | products.id | sí |
| name | text | no |  |  | sí |
| hex | text | sí |  |  | sí |
| sort_order | integer | no | 0 |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### product_images

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| product_id | uuid | no |  | products.id | sí |
| color_id | uuid | sí |  |  | sí |
| path | text | no |  |  | sí |
| alt | text | sí |  |  | sí |
| sort_order | integer | no | 0 |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### product_prices

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| product_id | uuid | no |  | products.id | sí |
| currency | text | no |  | currencies.code | sí |
| country | text | sí |  | countries.code | sí |
| amount | numeric | no |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### product_related

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **product_id** | uuid | no |  | products.id | sí |
| **related_id** | uuid | no |  | products.id | sí |
| sort_order | integer | no | 0 |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |

### product_sizes

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| product_id | uuid | no |  | products.id | sí |
| label | text | no |  |  | sí |
| sort_order | integer | no | 0 |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### product_slug_history

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | bigint | no |  |  | sí |
| product_id | uuid | no |  | products.id | sí |
| slug | text | no |  |  | sí |
| changed_at | timestamp with time zone | no | now() |  | sí |
| changed_by | uuid | sí | auth.uid() |  | sí |
| was_public | boolean | no | false |  | sí |

### product_variants

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| product_id | uuid | no |  | products.id | sí |
| color_id | uuid | no |  |  | sí |
| size_id | uuid | sí |  |  | sí |
| sku | text | no |  |  | sí |
| stock_on_hand | integer | no | 0 |  | sí |
| low_threshold | integer | sí |  |  | sí |
| critical_threshold | integer | sí |  |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### products

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| code | text | no |  |  | sí |
| slug | text | no |  |  | sí |
| name | text | no |  |  | sí |
| model | text | sí |  |  | sí |
| description | text | no | ''::text |  | sí |
| materials | text | sí |  |  | sí |
| washcare | text | sí |  |  | sí |
| cost_base | numeric | sí |  |  | sí |
| out_of_stock_behavior | text | no | 'sold_out'::text |  | sí |
| status | text | no | 'draft'::text |  | sí |
| is_new | boolean | no | false |  | sí |
| allow_converted_prices | boolean | no | false |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### profiles

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no |  | users.id | sí |
| full_name | text | no |  |  | sí |
| email | text | sí |  |  | sí |
| phone_e164 | text | sí |  |  | sí |
| role | text | no | 'customer'::text |  | sí |
| is_active | boolean | no | true |  | sí |
| blacklisted | boolean | no | false |  | no |
| anonymized_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |
| preferred_locale | text | no | 'es'::text |  | sí |
| preferred_currency | text | sí |  | currencies.code | sí |

### rate_limits

RLS activa · 0 políticas · cerrada al navegador (solo funciones del servidor).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **key** | text | no |  |  | no |
| window_start | timestamp with time zone | no | now() |  | no |
| hits | integer | no | 0 |  | no |

### refund_items

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| refund_id | uuid | no |  | refunds.id | sí |
| order_item_id | uuid | no |  | order_items.id | sí |
| qty | integer | no |  |  | sí |
| amount | numeric | no |  |  | sí |

### refunds

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| order_id | uuid | no |  | orders.id | sí |
| payment_id | uuid | sí |  | payments.id | sí |
| kind | text | no |  |  | sí |
| amount | numeric | no |  |  | sí |
| shipping_amount | numeric | no | 0 |  | sí |
| deduction | numeric | no | 0 |  | sí |
| currency | text | no |  | currencies.code | sí |
| reason | text | no |  |  | sí |
| status | text | no | 'requested'::text |  | sí |
| method | text | no | 'same_method'::text |  | sí |
| destination | text | sí |  |  | sí |
| external_ref | text | sí |  |  | sí |
| return_id | uuid | sí |  | order_returns.id | sí |
| idempotency_key | text | no |  |  | sí |
| request_hash | text | sí |  |  | sí |
| requested_by | uuid | sí |  | profiles.id | sí |
| processed_by | uuid | sí |  | profiles.id | sí |
| processed_at | timestamp with time zone | sí |  |  | sí |
| decision_note | text | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### shipping_methods

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| code | text | no |  |  | sí |
| name | text | no |  |  | sí |
| kind | text | no |  |  | sí |
| description | text | sí |  |  | sí |
| eta_min_days | integer | sí |  |  | sí |
| eta_max_days | integer | sí |  |  | sí |
| pickup_location_id | uuid | sí |  | store_locations.id | sí |
| is_active | boolean | no | true |  | sí |
| sort_order | integer | no | 0 |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### shipping_rate_rules

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| method_id | uuid | no |  | shipping_methods.id | sí |
| zone_id | uuid | sí |  | shipping_zones.id | sí |
| name | text | no |  |  | sí |
| kind | text | no |  |  | sí |
| params | jsonb | no |  |  | sí |
| min_order_amount | numeric(14,4) | sí |  |  | sí |
| max_order_amount | numeric(14,4) | sí |  |  | sí |
| currency | text | no | 'BOB'::text | currencies.code | sí |
| priority | integer | no | 100 |  | sí |
| is_active | boolean | no | true |  | sí |
| valid_from | timestamp with time zone | sí |  |  | sí |
| valid_until | timestamp with time zone | sí |  |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### shipping_zones

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| name | text | no |  |  | sí |
| kind | text | no |  |  | sí |
| cities | text[] | sí |  |  | sí |
| center_lat | numeric(9,6) | sí |  |  | sí |
| center_lng | numeric(9,6) | sí |  |  | sí |
| radius_km | numeric(8,2) | sí |  |  | sí |
| allowed | boolean | no | true |  | sí |
| is_active | boolean | no | true |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### stock_movements

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | bigint | no |  |  | sí |
| variant_id | uuid | no |  | product_variants.id | sí |
| delta | integer | no |  |  | sí |
| reason | text | no |  |  | sí |
| stock_after | integer | no |  |  | sí |
| ref | text | sí |  |  | sí |
| note | text | sí |  |  | sí |
| created_by | uuid | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |

### stock_reservations

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| variant_id | uuid | no |  | product_variants.id | sí |
| qty | integer | no |  |  | sí |
| owner_type | text | no |  |  | sí |
| owner_id | uuid | no |  |  | sí |
| expires_at | timestamp with time zone | sí |  |  | sí |
| status | text | no | 'active'::text |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### store_locations

RLS activa · 3 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| name | text | no |  |  | sí |
| address_text | text | no |  |  | sí |
| city | text | no |  |  | sí |
| lat | numeric(9,6) | no |  |  | sí |
| lng | numeric(9,6) | no |  |  | sí |
| pickup_hours | text | sí |  |  | sí |
| is_primary | boolean | no | false |  | sí |
| is_active | boolean | no | true |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### store_settings

RLS activa · 2 políticas · la lee una sesión (filtrada por RLS) · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **key** | text | no |  |  | sí |
| value | jsonb | no |  |  | sí |
| value_type | text | no |  |  | sí |
| is_public | boolean | no | false |  | sí |
| description | text | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### tax_profiles

RLS activa · 4 políticas · la lee una sesión (filtrada por RLS) · una sesión inserta · una sesión actualiza.

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | uuid | no | gen_random_uuid() |  | sí |
| profile_id | uuid | no |  | profiles.id | sí |
| doc_type | text | no |  |  | sí |
| doc_number | text | no |  |  | sí |
| legal_name | text | no |  |  | sí |
| is_default | boolean | no | false |  | sí |
| archived_at | timestamp with time zone | sí |  |  | sí |
| created_at | timestamp with time zone | no | now() |  | sí |
| updated_at | timestamp with time zone | no | now() |  | sí |

### webhook_events

RLS activa · 1 políticas · la lee una sesión (filtrada por RLS).

| Columna | Tipo | Nulo | Por omisión | Relación | Una sesión la lee |
| --- | --- | :-: | --- | --- | :-: |
| **id** | bigint | no |  |  | sí |
| provider | text | no |  |  | sí |
| event_id | text | sí |  |  | sí |
| signature_valid | boolean | no |  |  | sí |
| payload | jsonb | no | '{}'::jsonb |  | sí |
| outcome | text | sí |  |  | sí |
| error | text | sí |  |  | sí |
| payment_id | uuid | sí |  | payments.id | sí |
| attempts | integer | no | 1 |  | sí |
| received_at | timestamp with time zone | no | now() |  | sí |
| processed_at | timestamp with time zone | sí |  |  | sí |

## Vistas

| Vista | Visitante | Sesión | Respeta la RLS de quien consulta |
| --- | :-: | :-: | :-: |
| `admin_product_list` | no | sí | no (filtra por dentro) |
| `admin_product_stock` | no | sí | no (filtra por dentro) |
| `admin_stock_overview` | no | sí | no (filtra por dentro) |
| `discount_usage` | no | sí | sí |
| `public_categories` | sí | sí | no (filtra por dentro) |
| `public_collections` | sí | sí | no (filtra por dentro) |
| `public_countries` | sí | sí | no (filtra por dentro) |
| `public_currencies` | sí | sí | no (filtra por dentro) |
| `public_home_section_items` | sí | sí | no (filtra por dentro) |
| `public_home_sections` | sí | sí | no (filtra por dentro) |
| `public_news_banners` | sí | sí | no (filtra por dentro) |
| `public_product_categories` | sí | sí | no (filtra por dentro) |
| `public_product_collections` | sí | sí | no (filtra por dentro) |
| `public_product_colors` | sí | sí | no (filtra por dentro) |
| `public_product_detail` | sí | sí | no (filtra por dentro) |
| `public_product_images` | sí | sí | no (filtra por dentro) |
| `public_product_related` | sí | sí | no (filtra por dentro) |
| `public_product_sizes` | sí | sí | no (filtra por dentro) |
| `public_product_slug_redirects` | sí | sí | no (filtra por dentro) |
| `public_product_variants` | sí | sí | no (filtra por dentro) |
| `public_products` | sí | sí | no (filtra por dentro) |
| `public_shipping_methods` | sí | sí | no (filtra por dentro) |
| `public_store_settings` | sí | sí | no (filtra por dentro) |
| `variant_availability` | no | no | no (filtra por dentro) |

## Funciones

Quién puede llamarlas: **visitante** (sin sesión), **sesión** (clienta o administradora; cada una se autoriza por dentro), **servicio** (solo las funciones de Edge y el cron) o **interna** (solo otras funciones).

| Función | Argumentos | Devuelve | Permisos del dueño | Quién |
| --- | --- | --- | :-: | --- |
| `_apply_admin_rls` | p_table text, p_insert_cols text[], p_update_cols text[] | void | no | servicio |
| `_attention_rows` |  | TABLE(kind text, order_id uuid, since t… | sí | interna |
| `_attr_text` | p_value jsonb, p_key text | text | no | interna |
| `_cart_free_for` | p_variant_id uuid, p_cart_id uuid | integer | sí | interna |
| `_cart_ip_room` | p_cart_id uuid, p_variant_id uuid | integer | sí | interna |
| `_cart_lock` | p_cart_id uuid | void | sí | interna |
| `_cart_lock_active` | p_cart_id uuid | boolean | sí | interna |
| `_cart_resolve` | p_profile_id uuid, p_token_hash text, p_create boolean, p_ip_hash text, OUT o_id uuid, OU… | record | sí | interna |
| `_cart_snapshot` | p_cart_id uuid | jsonb | sí | interna |
| `_checkout_compute` | p_profile_id uuid, p_cart_id uuid, p_address_id uuid, p_tax_profile_id uuid, p_shipping_m… | jsonb | sí | interna |
| `_complaint_text` | p_value jsonb, p_key text, p_keep_newlines boolean | text | no | interna |
| `_coupon_norm` | p_code text | text | no | sesión |
| `_customer_order_count` | p_profile_id uuid | integer | sí | interna |
| `_discount_customer_reason` | p_kind text, p_group_id uuid, p_profile_id uuid | text | sí | interna |
| `_discount_distribute` | p_amount bigint, p_weights bigint[] | bigint[] | no | interna |
| `_discount_evaluate` | p_profile_id uuid, p_currency text, p_lines jsonb, p_coupon text, p_shipping numeric, p_n… | jsonb | sí | interna |
| `_discount_line_eligible` | p_discount_id uuid, p_scope text, p_product_id uuid | boolean | sí | interna |
| `_discount_params_valid` | p_kind text, p_params jsonb | boolean | no | sesión |
| `_discount_reductions` | p_kind text, p_params jsonb, p_elig boolean[], p_unit bigint[], p_qty integer[], p_base b… | bigint[] | no | interna |
| `_discount_usage` | p_discount_id uuid, p_coupon_id uuid, p_profile_id uuid | integer[] | sí | interna |
| `_enqueue_notification_ex` | p_type text, p_channel text, p_recipient text, p_payload jsonb, p_dedupe_key text, p_orde… | bigint | sí | interna |
| `_import_num` | p_row jsonb, p_key text, p_scale integer | numeric | no | interna |
| `_import_rows` | p_kind text, p_rows jsonb, p_batch uuid | jsonb | sí | interna |
| `_import_text` | p_row jsonb, p_key text, p_max integer | text | no | interna |
| `_import_unique_slug` | p_table text, p_base text | text | no | interna |
| `_legal_current` | p_kind text | legal_versions | sí | interna |
| `_legal_required_versions` |  | jsonb | sí | interna |
| `_next_order_number` | p_prefix text | text | sí | interna |
| `_notification_settle` | p_id bigint, p_outcome text, p_provider text, p_message_id text, p_error text, p_retry_af… | text | sí | interna |
| `_notification_stale_reason` | n notification_outbox | text | sí | interna |
| `_notification_status_rank` | p_status text | integer | no | interna |
| `_notify_target` | p_profile_id uuid | TABLE(channel text, recipient text) | sí | interna |
| `_order_address_clean` | p_addr jsonb | jsonb | no | interna |
| `_order_balance` | p_order_id uuid | numeric | sí | interna |
| `_order_json` | p_order_id uuid | jsonb | sí | interna |
| `_order_notify` | p_order_id uuid, p_type text, p_audience text, p_suffix text, p_extra jsonb | void | sí | interna |
| `_order_paid_amount` | p_order_id uuid | numeric | sí | interna |
| `_order_refunded_amount` | p_order_id uuid, p_only_processed boolean | numeric | sí | interna |
| `_order_stock_free` | p_variant_id uuid | integer | sí | interna |
| `_order_transition_ok` | p_from text, p_to text, p_actor_kind text | boolean | no | interna |
| `_payment_alert` | p_type text, p_payload jsonb, p_dedupe text | void | sí | interna |
| `_payment_open_review` | p_payment_id uuid, p_reason text, p_detail jsonb | uuid | sí | interna |
| `_refund_compute` | p_order_id uuid, p_items jsonb, p_include_shipping boolean, p_deduction numeric, p_amount… | jsonb | sí | interna |
| `_refund_settle` | p_order_id uuid, p_actor uuid | text | sí | interna |
| `_report_bounds` | p_from date, p_to date, OUT from_ts timestamp with time zone, OUT to_ts timestamp with ti… | record | no | interna |
| `_report_page` | p_offset integer, p_limit integer | void | no | interna |
| `_sales_lines` | p_from_ts timestamp with time zone, p_to_ts timestamp with time zone | TABLE(order_item_id uuid, order_id uuid… | sí | interna |
| `_sales_orders` | p_from_ts timestamp with time zone, p_to_ts timestamp with time zone | TABLE(order_id uuid, currency text, rat… | sí | interna |
| `_ship_norm` | p_text text | text | no | interna |
| `_ship_params_valid` | p_kind text, p_params jsonb | boolean | no | sesión |
| `_ship_slot_ok` | p_slot_id uuid, p_day date, p_now timestamp with time zone | text | sí | interna |
| `_ship_slots` | p_method_id uuid, p_from date, p_days integer | jsonb | sí | interna |
| `adjust_stock` | p_variant_id uuid, p_delta integer, p_reason text, p_note text | integer | sí | sesión |
| `admin_add_order_note` | p_order_id uuid, p_body text | jsonb | sí | sesión |
| `admin_attention_orders` |  | jsonb | sí | sesión |
| `admin_attention_summary` |  | jsonb | sí | sesión |
| `admin_attribution_summary` | p_from date, p_to date | TABLE(currency text, utm_source text, u… | sí | sesión |
| `admin_blacklist_add` | p_kind text, p_profile_id uuid, p_phone text, p_email text, p_reason text, p_order_id uui… | jsonb | sí | sesión |
| `admin_blacklist_lift` | p_entry_id uuid, p_reason text | jsonb | sí | sesión |
| `admin_blacklist_matches` | p_order_id uuid | jsonb | sí | sesión |
| `admin_cod_collect` | p_order_id uuid, p_amount numeric, p_note text | jsonb | sí | sesión |
| `admin_cod_reject` | p_order_id uuid, p_cost numeric, p_note text, p_blacklist boolean, p_blacklist_reason text | jsonb | sí | sesión |
| `admin_complaint_update` | p_id uuid, p_status text, p_response text | void | sí | sesión |
| `admin_complaints` | p_status text, p_offset integer, p_limit integer | TABLE(id uuid, number text, created_at … | sí | sesión |
| `admin_complaints_summary` |  | jsonb | sí | sesión |
| `admin_confirm_payment_manual` | p_payment_id uuid, p_received_amount numeric, p_note text | jsonb | sí | sesión |
| `admin_create_manual_order` | p_profile_id uuid, p_items jsonb, p_channel text, p_payment_method text, p_shipping_metho… | jsonb | sí | sesión |
| `admin_customers_summary` | p_from date, p_to date | jsonb | sí | sesión |
| `admin_delete_product_price` | p_product_id uuid, p_currency text, p_country text | void | sí | sesión |
| `admin_duplicate_product` | p_product_id uuid, p_new_code text, p_new_name text | uuid | sí | sesión |
| `admin_edit_order` | p_order_id uuid, p_expected_updated_at timestamp with time zone, p_items jsonb, p_contact… | jsonb | sí | sesión |
| `admin_funnel` | p_from date, p_to date | jsonb | sí | sesión |
| `admin_generate_coupon_codes` | p_discount_id uuid, p_count integer, p_prefix text, p_length integer, p_usage_limit integ… | text[] | sí | sesión |
| `admin_import_apply_chunk` | p_batch uuid, p_rows jsonb | jsonb | sí | sesión |
| `admin_import_batch_rows` | p_batch uuid, p_offset integer, p_limit integer | TABLE(row_no integer, action text, enti… | sí | sesión |
| `admin_import_batches` | p_limit integer | TABLE(id uuid, kind text, filename text… | sí | sesión |
| `admin_import_finish` | p_batch uuid | jsonb | sí | sesión |
| `admin_import_rollback` | p_batch uuid | jsonb | sí | sesión |
| `admin_import_start` | p_kind text, p_filename text, p_total integer | uuid | sí | sesión |
| `admin_import_validate` | p_kind text, p_rows jsonb | jsonb | sí | sesión |
| `admin_incident_open` | p_order_id uuid, p_type text, p_description text, p_cost numeric, p_borne_by text | jsonb | sí | sesión |
| `admin_incident_update` | p_id uuid, p_status text, p_resolution text, p_cost numeric, p_borne_by text | jsonb | sí | sesión |
| `admin_inventory_coverage` | p_days integer, p_limit integer | TABLE(variant_id uuid, product_id uuid,… | sí | sesión |
| `admin_inventory_summary` |  | jsonb | sí | sesión |
| `admin_legal_acceptance_stats` |  | jsonb | sí | sesión |
| `admin_legal_discard_draft` | p_kind text | void | sí | sesión |
| `admin_legal_get` | p_kind text, p_version integer | jsonb | sí | sesión |
| `admin_legal_overview` |  | jsonb | sí | sesión |
| `admin_legal_publish` | p_kind text, p_effective_at timestamp with time zone, p_note text | jsonb | sí | sesión |
| `admin_legal_save_draft` | p_kind text, p_body text, p_note text | jsonb | sí | sesión |
| `admin_notification_cancel` | p_id bigint | jsonb | sí | sesión |
| `admin_notification_counts` |  | jsonb | sí | sesión |
| `admin_notification_health` |  | jsonb | sí | sesión |
| `admin_notification_mark_sent` | p_id bigint | jsonb | sí | sesión |
| `admin_notification_resend` | p_id bigint | jsonb | sí | sesión |
| `admin_order_history` | p_order_id uuid | jsonb | sí | sesión |
| `admin_orders_status_counts` |  | jsonb | sí | sesión |
| `admin_payment_mix` | p_from date, p_to date | TABLE(currency text, payment_method tex… | sí | sesión |
| `admin_process_refund` | p_refund_id uuid, p_external_ref text, p_note text | jsonb | sí | sesión |
| `admin_refund_order` | p_order_id uuid, p_idempotency_key text, p_mode text, p_items jsonb, p_include_shipping b… | jsonb | sí | sesión |
| `admin_reject_refund` | p_refund_id uuid, p_note text | jsonb | sí | sesión |
| `admin_report_customers` | p_from date, p_to date, p_currency text, p_offset integer, p_limit integer | TABLE(profile_id uuid, customer_name te… | sí | sesión |
| `admin_report_discounts` | p_from date, p_to date, p_offset integer, p_limit integer | TABLE(discount_id uuid, discount_name t… | sí | sesión |
| `admin_report_inventory` | p_offset integer, p_limit integer | TABLE(variant_id uuid, product_id uuid,… | sí | sesión |
| `admin_report_payments` | p_from date, p_to date, p_offset integer, p_limit integer | TABLE(payment_id uuid, created_at times… | sí | sesión |
| `admin_report_products` | p_from date, p_to date, p_currency text, p_offset integer, p_limit integer | TABLE(product_id uuid, product_name tex… | sí | sesión |
| `admin_report_returns` | p_from date, p_to date, p_offset integer, p_limit integer | TABLE(kind text, created_at timestamp w… | sí | sesión |
| `admin_report_sales` | p_from date, p_to date, p_currency text, p_offset integer, p_limit integer | TABLE(order_id uuid, number text, sold_… | sí | sesión |
| `admin_resolve_review` | p_review_id uuid, p_note text | jsonb | sí | sesión |
| `admin_return_close` | p_return_id uuid, p_resolutions jsonb | jsonb | sí | sesión |
| `admin_return_open` | p_order_id uuid, p_items jsonb, p_reason text, p_override_reason text | jsonb | sí | sesión |
| `admin_return_reject` | p_return_id uuid, p_note text | jsonb | sí | sesión |
| `admin_review_proof` | p_proof_id uuid, p_decision text, p_reason text, p_received_amount numeric | jsonb | sí | sesión |
| `admin_sales_breakdown` | p_from date, p_to date, p_dimension text, p_currency text, p_limit integer | TABLE(key text, label text, units integ… | sí | sesión |
| `admin_sales_summary` | p_from date, p_to date, p_granularity text | jsonb | sí | sesión |
| `admin_set_primary_location` | p_id uuid | void | sí | sesión |
| `admin_set_product_categories` | p_product_id uuid, p_category_ids uuid[] | void | sí | sesión |
| `admin_set_product_collections` | p_product_id uuid, p_collection_ids uuid[] | void | sí | sesión |
| `admin_set_product_related` | p_product_id uuid, p_related_ids uuid[] | void | sí | sesión |
| `admin_set_stock` | p_variant_id uuid, p_expected integer, p_new integer, p_reason text, p_note text | integer | sí | sesión |
| `admin_slow_movers` | p_days integer, p_limit integer | TABLE(product_id uuid, product_name tex… | sí | sesión |
| `admin_top_products` | p_from date, p_to date, p_currency text, p_by text, p_dir text, p_limit integer | TABLE(product_id uuid, product_name tex… | sí | sesión |
| `admin_transition_order` | p_order_id uuid, p_to text, p_reason text, p_expected_from text | jsonb | sí | sesión |
| `admin_undo_transition` | p_order_id uuid, p_expected_status text | jsonb | sí | sesión |
| `alert_recipients` |  | text[] | sí | servicio |
| `apply_discounts` | p_cart_id uuid, p_coupon_code text, p_shipping numeric, p_now timestamp with time zone | jsonb | sí | servicio |
| `apply_stock_change` | p_variant_id uuid, p_delta integer, p_reason text, p_ref text, p_note text, p_user uuid | integer | sí | servicio |
| `cancel_order_by_customer` | p_profile_id uuid, p_order_id uuid, p_reason text | jsonb | sí | servicio |
| `cart_abandon_stale` |  | integer | sí | servicio |
| `cart_accept_prices` | p_profile_id uuid, p_token_hash text, p_variant_id uuid, p_expected_price numeric | jsonb | sí | servicio |
| `cart_clear` | p_profile_id uuid, p_token_hash text | jsonb | sí | servicio |
| `cart_get` | p_profile_id uuid, p_token_hash text | jsonb | sí | servicio |
| `cart_refresh` | p_profile_id uuid, p_token_hash text | jsonb | sí | servicio |
| `cart_remove_coupon` | p_profile_id uuid, p_token_hash text | jsonb | sí | servicio |
| `cart_remove_item` | p_profile_id uuid, p_token_hash text, p_variant_id uuid | jsonb | sí | servicio |
| `cart_set_coupon` | p_profile_id uuid, p_token_hash text, p_code text | jsonb | sí | servicio |
| `cart_set_item` | p_profile_id uuid, p_token_hash text, p_variant_id uuid, p_qty integer, p_may_create bool… | jsonb | sí | servicio |
| `change_profile_contact` | p_id uuid, p_email text, p_phone text, p_expect jsonb | void | sí | servicio |
| `check_rate_limit` | p_key text, p_max integer, p_window_seconds integer | TABLE(allowed boolean, hit_count intege… | sí | servicio |
| `checkout_preview` | p_profile_id uuid, p_address_id uuid, p_tax_profile_id uuid, p_shipping_method text, p_sl… | jsonb | sí | servicio |
| `claim_notifications` | p_limit integer, p_worker text, p_ids bigint[], p_channels text[] | SETOF notification_outbox | sí | servicio |
| `complete_notification` | p_id bigint, p_worker text, p_outcome text, p_provider text, p_message_id text, p_error t… | text | sí | servicio |
| `create_order` | p_profile_id uuid, p_address_id uuid, p_tax_profile_id uuid, p_shipping_method text, p_sl… | jsonb | sí | servicio |
| `current_app_role` |  | text | sí | visitante |
| `current_rate` | p_from text, p_to text | numeric | no | servicio |
| `customer_payment_view` | p_order_id uuid | jsonb | sí | sesión |
| `deactivate_profile` | p_id uuid, p_anonymize boolean | void | sí | servicio |
| `discount_commit` | p_owner_type text, p_owner_id uuid | integer | sí | servicio |
| `discount_release` | p_owner_type text, p_owner_id uuid | integer | sí | servicio |
| `discount_reserve` | p_owner_type text, p_owner_id uuid, p_profile_id uuid, p_applied jsonb | jsonb | sí | servicio |
| `enqueue_notification` | p_type text, p_channel text, p_recipient text, p_payload jsonb, p_dedupe_key text | bigint | sí | servicio |
| `expire_pending_payments` |  | integer | sí | interna |
| `expire_reservations` |  | integer | sí | servicio |
| `expire_unconfirmed_orders` |  | integer | sí | interna |
| `f_unaccent` | p_text text | text | no | sesión |
| `haversine_km` | p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric | numeric | no | interna |
| `healthcheck` |  | jsonb | no | visitante |
| `home_media_ok` | p_kind text, p_path text | boolean | no | visitante |
| `is_admin` |  | boolean | sí | visitante |
| `is_blacklisted` | p_profile_id uuid, p_phone text, p_email text | boolean | sí | interna |
| `is_safe_link` | p_url text | boolean | no | sesión |
| `merge_guest_cart` | p_profile_id uuid, p_token_hash text | jsonb | sí | servicio |
| `my_data_export` |  | jsonb | sí | sesión |
| `my_legal_pending` |  | jsonb | sí | sesión |
| `notification_backoff_seconds` | p_attempts integer, p_base integer | integer | no | interna |
| `notify_worker_kick` |  | text | sí | interna |
| `payment_apply_event` | p_provider text, p_event_id text, p_type text, p_reference text, p_amount numeric, p_curr… | jsonb | sí | servicio |
| `payment_log_invalid_event` | p_provider text, p_reason text, p_payload jsonb | void | sí | servicio |
| `payment_proof_path_ok` | p_name text | boolean | sí | sesión |
| `payment_proof_register` | p_profile_id uuid, p_payment_id uuid, p_path text, p_hash text, p_mime text, p_size integ… | jsonb | sí | servicio |
| `payment_retry` | p_profile_id uuid, p_order_id uuid | jsonb | sí | servicio |
| `price_for` | p_product_id uuid, p_currency text, p_country text | numeric | sí | servicio |
| `promote_admin` | p_email text | uuid | sí | servicio |
| `public_legal_document` | p_kind text | jsonb | sí | visitante |
| `public_legal_index` |  | jsonb | sí | visitante |
| `public_legal_required` |  | jsonb | sí | visitante |
| `public_list_products` | p_category_slug text, p_collection_slug text, p_colors text[], p_sizes text[], p_min_pric… | jsonb | sí | visitante |
| `public_listing_facets` | p_category_slug text, p_collection_slug text | jsonb | sí | visitante |
| `public_price_for` | p_product_id uuid, p_currency text, p_country text | numeric | sí | visitante |
| `public_search_products` | p_query text, p_limit integer | SETOF public_products | sí | visitante |
| `purge_old_carts` | p_older_than interval | integer | sí | servicio |
| `purge_stock_reservations` | p_older_than interval | integer | sí | servicio |
| `quote_shipping` | p_method_code text, p_lat numeric, p_lng numeric, p_city text, p_order_amount numeric, p_… | jsonb | sí | visitante |
| `record_legal_acceptance` | p_profile uuid, p_order uuid, p_context text, p_versions jsonb, p_ip_hash text | void | sí | servicio |
| `record_order_attribution` | p_number text, p_data jsonb | void | sí | sesión |
| `release_delivery_slot` | p_owner_type text, p_owner_id uuid | integer | sí | servicio |
| `release_stock` | p_owner_type text, p_owner_id uuid, p_variant_id uuid | integer | sí | servicio |
| `remind_expiring_payments` |  | integer | sí | interna |
| `remind_pending_orders` |  | integer | sí | interna |
| `reserve_delivery_slot` | p_slot_id uuid, p_day date, p_owner_type text, p_owner_id uuid | jsonb | sí | servicio |
| `reserve_stock` | p_variant_id uuid, p_qty integer, p_owner_type text, p_owner_id uuid, p_ttl_seconds integ… | jsonb | sí | servicio |
| `reset_rate_limit` | p_key text | void | sí | servicio |
| `resolve_login_email` | p_kind text, p_value text | text | sí | servicio |
| `set_user_role` | p_id uuid, p_role text | void | sí | servicio |
| `setting_bool` | p_key text, p_default boolean | boolean | sí | servicio |
| `setting_int` | p_key text, p_default integer | integer | sí | servicio |
| `setting_text` | p_key text, p_default text | text | sí | servicio |
| `slugify` | p_text text | text | no | sesión |
| `stock_status` | p_available integer, p_low integer, p_critical integer | text | no | visitante |
| `storage_path_ok` | p_bucket text, p_name text | boolean | no | visitante |
| `submit_complaint` | p_data jsonb, p_profile uuid, p_ip_hash text | jsonb | sí | servicio |
| `system_health` |  | jsonb | sí | servicio |
| `transition_order_status` | p_order_id uuid, p_to text, p_actor uuid, p_actor_kind text, p_reason text | jsonb | sí | servicio |
