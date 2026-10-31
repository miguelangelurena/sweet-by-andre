--
-- PostgreSQL database dump
--


-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: protect_checkout_delivery(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_checkout_delivery() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (OLD.fulfillment_method, OLD.fulfillment_at, OLD.service_date,
        OLD.delivery_distance_meters, OLD.delivery_policy_version)
       IS DISTINCT FROM
       (NEW.fulfillment_method, NEW.fulfillment_at, NEW.service_date,
        NEW.delivery_distance_meters, NEW.delivery_policy_version)
       AND EXISTS (SELECT 1 FROM checkout_attempts WHERE order_id = OLD.id) THEN
        RAISE EXCEPTION 'Delivery details cannot change after Checkout starts';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: protect_checkout_order(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_checkout_order() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM checkout_attempts
        WHERE order_id = OLD.id
    ) THEN
        IF (
            OLD.user_id,
            OLD.guest_cart_id,
            OLD.shipping_name,
            OLD.shipping_street,
            OLD.shipping_street_number,
            OLD.shipping_unit,
            OLD.shipping_city,
            OLD.shipping_state,
            OLD.shipping_zip_code,
            OLD.delivery_instructions,
            OLD.note,
            OLD.delivery_date,
            OLD.subtotal,
            OLD.shipping_cost,
            OLD.tax_amount,
            OLD.total,
            OLD.customer_email,
            OLD.customer_phone
        ) IS DISTINCT FROM (
            NEW.user_id,
            NEW.guest_cart_id,
            NEW.shipping_name,
            NEW.shipping_street,
            NEW.shipping_street_number,
            NEW.shipping_unit,
            NEW.shipping_city,
            NEW.shipping_state,
            NEW.shipping_zip_code,
            NEW.delivery_instructions,
            NEW.note,
            NEW.delivery_date,
            NEW.subtotal,
            NEW.shipping_cost,
            NEW.tax_amount,
            NEW.total,
            NEW.customer_email,
            NEW.customer_phone
        ) THEN
            RAISE EXCEPTION
                'Order cannot be modified after Checkout starts';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: protect_checkout_order_items(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_checkout_order_items() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    affected_order_id UUID;
BEGIN
    FOR affected_order_id IN
        SELECT DISTINCT id
        FROM (
            SELECT CASE
                WHEN TG_OP IN ('UPDATE', 'DELETE')
                THEN OLD.order_id
                ELSE NULL::uuid
            END AS id

            UNION ALL

            SELECT CASE
                WHEN TG_OP IN ('INSERT', 'UPDATE')
                THEN NEW.order_id
                ELSE NULL::uuid
            END AS id
        ) affected
        WHERE id IS NOT NULL
        ORDER BY id
    LOOP
        PERFORM 1
        FROM orders
        WHERE id = affected_order_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Order does not exist: %',
                affected_order_id;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM checkout_attempts
            WHERE order_id = affected_order_id
        ) THEN
            RAISE EXCEPTION
                'Order items cannot be modified after Checkout starts';
        END IF;
    END LOOP;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: protect_production_reservation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_production_reservation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (OLD.order_id,OLD.service_date,OLD.points,OLD.policy_version)
      IS DISTINCT FROM (NEW.order_id,NEW.service_date,NEW.points,NEW.policy_version) THEN
        RAISE EXCEPTION 'Production reservation snapshots are immutable';
    END IF;
    IF OLD.status IN ('committed','released') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'A finalized production reservation cannot change state';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: queue_order_transactional_email(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_order_transactional_email() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE notification_event TEXT;
BEGIN
    notification_event := NULL;
    IF NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid' THEN
        notification_event := 'order_paid';
    ELSIF NEW.order_status IS DISTINCT FROM OLD.order_status AND NEW.payment_status = 'paid' THEN
        notification_event := CASE NEW.order_status
           WHEN 'confirmed' THEN 'order_confirmed'
           WHEN 'ready' THEN 'order_ready'
           WHEN 'completed' THEN 'order_completed'
           ELSE NULL END;
    END IF;
    IF notification_event IS NOT NULL AND NULLIF(BTRIM(NEW.customer_email), '') IS NOT NULL THEN
        INSERT INTO order_notification_outbox(order_id, event_type, channel)
        VALUES (NEW.id, notification_event, 'email')
        ON CONFLICT (order_id, event_type, channel) DO NOTHING;
    END IF;
    -- SMS is only queued when the customer explicitly opted in.
    IF notification_event IS NOT NULL AND NEW.sms_opt_in = TRUE AND NULLIF(BTRIM(NEW.customer_phone), '') IS NOT NULL THEN
        INSERT INTO order_notification_outbox(order_id, event_type, channel)
        VALUES (NEW.id, notification_event, 'sms')
        ON CONFLICT (order_id, event_type, channel) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: release_cancelled_production(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_cancelled_production() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.order_status = 'cancelled' AND OLD.order_status IS DISTINCT FROM 'cancelled' THEN
        UPDATE production_reservations SET status='released' WHERE order_id=NEW.id AND status='held';
    END IF;
    RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    label text,
    street text NOT NULL,
    street_number text NOT NULL,
    unit text,
    city text NOT NULL,
    state text NOT NULL,
    zip_code text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: cart; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cart (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    guest_token_hash text,
    CONSTRAINT cart_owner_check CHECK ((((user_id IS NOT NULL) AND (guest_token_hash IS NULL)) OR ((user_id IS NULL) AND (guest_token_hash IS NOT NULL))))
);


--
-- Name: cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cart_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cart_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    price_at_added numeric(10,2) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    variant_id uuid NOT NULL,
    notes text,
    CONSTRAINT cart_items_price_at_added_check CHECK ((price_at_added >= (0)::numeric)),
    CONSTRAINT cart_items_quantity_check CHECK ((quantity > 0))
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: checkout_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkout_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    payment_id uuid,
    idempotency_key uuid DEFAULT gen_random_uuid() NOT NULL,
    stripe_session_id text,
    status text DEFAULT 'creating'::text NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT checkout_attempts_status_check CHECK ((status = ANY (ARRAY['creating'::text, 'open'::text, 'completed'::text, 'expired'::text, 'failed'::text])))
);


--
-- Name: delivery_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guest_cart_id uuid NOT NULL,
    address_hash text NOT NULL,
    policy_version integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    distance_meters integer,
    fee_cents integer,
    expires_at timestamp with time zone DEFAULT (now() + '00:15:00'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT delivery_quotes_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text, 'outside_area'::text])))
);


--
-- Name: delivery_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_settings (
    id boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    config jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT delivery_settings_id_check CHECK (id)
);


--
-- Name: inventory_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    quantity integer NOT NULL,
    status text DEFAULT 'reserved'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    inventory_mode text DEFAULT 'stock'::text NOT NULL,
    CONSTRAINT inventory_reservations_inventory_mode_check CHECK ((inventory_mode = ANY (ARRAY['stock'::text, 'made_to_order'::text]))),
    CONSTRAINT inventory_reservations_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT inventory_reservations_status_check CHECK ((status = ANY (ARRAY['reserved'::text, 'committed'::text, 'released'::text])))
);


--
-- Name: order_creation_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_creation_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identity_type text NOT NULL,
    identity_id uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    payload_hash text NOT NULL,
    order_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_creation_requests_identity_type_check CHECK ((identity_type = ANY (ARRAY['guest'::text, 'user'::text]))),
    CONSTRAINT order_creation_requests_payload_hash_check CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    variant_id uuid,
    notes text,
    options_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    product_name_snapshot text,
    inventory_mode text DEFAULT 'stock'::text NOT NULL,
    production_points integer DEFAULT 0 NOT NULL,
    CONSTRAINT order_items_inventory_mode_check CHECK ((inventory_mode = ANY (ARRAY['stock'::text, 'made_to_order'::text]))),
    CONSTRAINT order_items_production_points_check CHECK (((production_points >= 0) AND (production_points <= 10000))),
    CONSTRAINT order_items_production_snapshot_check CHECK ((((inventory_mode = 'stock'::text) AND (production_points = 0)) OR ((inventory_mode = 'made_to_order'::text) AND (production_points > 0)))),
    CONSTRAINT order_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT order_items_unit_price_check CHECK ((unit_price >= (0)::numeric))
);


--
-- Name: order_notification_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_notification_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    event_type text NOT NULL,
    channel text DEFAULT 'email'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    sent_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_notification_outbox_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT order_notification_outbox_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text]))),
    CONSTRAINT order_notification_outbox_event_type_check CHECK ((event_type = ANY (ARRAY['order_paid'::text, 'order_confirmed'::text, 'order_ready'::text, 'order_completed'::text]))),
    CONSTRAINT order_notification_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    shipping_name text NOT NULL,
    shipping_street text NOT NULL,
    shipping_street_number text NOT NULL,
    shipping_unit text,
    shipping_city text NOT NULL,
    shipping_state text NOT NULL,
    shipping_zip_code text NOT NULL,
    delivery_instructions text,
    note text,
    delivery_date timestamp without time zone NOT NULL,
    subtotal numeric(10,2) NOT NULL,
    shipping_cost numeric(10,2) NOT NULL,
    tax_amount numeric(10,2) NOT NULL,
    total numeric(10,2) NOT NULL,
    payment_status text NOT NULL,
    order_status text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    guest_cart_id uuid,
    customer_email text,
    customer_phone text,
    sms_opt_in boolean DEFAULT false NOT NULL,
    fulfillment_method text DEFAULT 'legacy'::text NOT NULL,
    fulfillment_at timestamp with time zone,
    service_date date,
    delivery_distance_meters integer,
    delivery_policy_version integer,
    delivery_hold_until timestamp with time zone,
    CONSTRAINT orders_order_status_check CHECK ((order_status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'preparing'::text, 'ready'::text, 'completed'::text, 'cancelled'::text, 'refund_pending'::text]))),
    CONSTRAINT orders_owner_check CHECK ((((user_id IS NOT NULL) AND (guest_cart_id IS NULL)) OR ((user_id IS NULL) AND (guest_cart_id IS NOT NULL)))),
    CONSTRAINT orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'partial'::text, 'paid'::text]))),
    CONSTRAINT orders_shipping_cost_check CHECK ((shipping_cost >= (0)::numeric)),
    CONSTRAINT orders_subtotal_check CHECK ((subtotal >= (0)::numeric)),
    CONSTRAINT orders_tax_amount_check CHECK ((tax_amount >= (0)::numeric)),
    CONSTRAINT orders_total_check CHECK ((total >= (0)::numeric))
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    stripe_payment_id text,
    amount numeric(10,2) NOT NULL,
    status text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    stripe_payment_intent_id text,
    stripe_refund_id text,
    CONSTRAINT payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'refund_pending'::text, 'refunded'::text])))
);


--
-- Name: product_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_order integer NOT NULL,
    image_url text NOT NULL,
    product_id uuid NOT NULL,
    cloudinary_public_id text
);


--
-- Name: product_option_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_option_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    option_id uuid NOT NULL,
    value text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: product_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    name text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: product_variant_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variant_values (
    variant_id uuid NOT NULL,
    option_id uuid NOT NULL,
    option_value_id uuid NOT NULL
);


--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    price numeric(10,2) NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    production_points integer DEFAULT 1 NOT NULL,
    CONSTRAINT product_variants_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT product_variants_production_points_check CHECK (((production_points >= 1) AND (production_points <= 10000))),
    CONSTRAINT product_variants_stock_check CHECK ((stock >= 0))
);


--
-- Name: production_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_reservations (
    order_id uuid NOT NULL,
    service_date date NOT NULL,
    points integer NOT NULL,
    policy_version integer NOT NULL,
    status text DEFAULT 'held'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_reservations_points_check CHECK ((points > 0)),
    CONSTRAINT production_reservations_status_check CHECK ((status = ANY (ARRAY['held'::text, 'committed'::text, 'released'::text])))
);


--
-- Name: production_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_settings (
    id boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    config jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_settings_id_check CHECK (id)
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    price numeric(10,2) NOT NULL,
    stock integer NOT NULL,
    category_id uuid NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    inventory_mode text DEFAULT 'stock'::text NOT NULL,
    CONSTRAINT products_inventory_mode_check CHECK ((inventory_mode = ANY (ARRAY['stock'::text, 'made_to_order'::text]))),
    CONSTRAINT products_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT products_stock_check CHECK ((stock >= 0))
);


--
-- Name: refund_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refund_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    payment_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    stripe_refund_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    last_error text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT refund_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'succeeded'::text, 'failed'::text])))
);


--
-- Name: seasonal_collection_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seasonal_collection_products (
    collection_slug text NOT NULL,
    product_id uuid NOT NULL
);


--
-- Name: seasonal_collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seasonal_collections (
    slug text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seasonal_collections_slug_check CHECK ((slug = ANY (ARRAY['valentines'::text, 'thanksgiving'::text, 'christmas'::text])))
);


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    password_hash text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp without time zone,
    role text DEFAULT 'customer'::text NOT NULL,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['customer'::text, 'admin'::text])))
);


--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);


--
-- Name: cart cart_guest_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart
    ADD CONSTRAINT cart_guest_token_hash_unique UNIQUE (guest_token_hash);


--
-- Name: cart_items cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_pkey PRIMARY KEY (id);


--
-- Name: cart cart_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart
    ADD CONSTRAINT cart_pkey PRIMARY KEY (id);


--
-- Name: cart cart_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart
    ADD CONSTRAINT cart_user_id_key UNIQUE (user_id);


--
-- Name: categories categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_name_key UNIQUE (name);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: checkout_attempts checkout_attempts_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_attempts
    ADD CONSTRAINT checkout_attempts_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: checkout_attempts checkout_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_attempts
    ADD CONSTRAINT checkout_attempts_pkey PRIMARY KEY (id);


--
-- Name: checkout_attempts checkout_attempts_stripe_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_attempts
    ADD CONSTRAINT checkout_attempts_stripe_session_id_key UNIQUE (stripe_session_id);


--
-- Name: delivery_quotes delivery_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_quotes
    ADD CONSTRAINT delivery_quotes_pkey PRIMARY KEY (id);


--
-- Name: delivery_settings delivery_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_settings
    ADD CONSTRAINT delivery_settings_pkey PRIMARY KEY (id);


--
-- Name: inventory_reservations inventory_reservations_order_variant_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_order_variant_unique UNIQUE (order_id, variant_id);


--
-- Name: inventory_reservations inventory_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_pkey PRIMARY KEY (id);


--
-- Name: order_creation_requests order_creation_requests_identity_type_identity_id_idempoten_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_creation_requests
    ADD CONSTRAINT order_creation_requests_identity_type_identity_id_idempoten_key UNIQUE (identity_type, identity_id, idempotency_key);


--
-- Name: order_creation_requests order_creation_requests_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_creation_requests
    ADD CONSTRAINT order_creation_requests_order_id_key UNIQUE (order_id);


--
-- Name: order_creation_requests order_creation_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_creation_requests
    ADD CONSTRAINT order_creation_requests_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_notification_outbox order_notification_outbox_order_id_event_type_channel_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_notification_outbox
    ADD CONSTRAINT order_notification_outbox_order_id_event_type_channel_key UNIQUE (order_id, event_type, channel);


--
-- Name: order_notification_outbox order_notification_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_notification_outbox
    ADD CONSTRAINT order_notification_outbox_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);


--
-- Name: product_images product_images_product_id_display_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_display_order_key UNIQUE (product_id, display_order);


--
-- Name: product_option_values product_option_values_id_option_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_option_values
    ADD CONSTRAINT product_option_values_id_option_unique UNIQUE (id, option_id);


--
-- Name: product_option_values product_option_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_option_values
    ADD CONSTRAINT product_option_values_pkey PRIMARY KEY (id);


--
-- Name: product_option_values product_option_values_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_option_values
    ADD CONSTRAINT product_option_values_unique UNIQUE (option_id, value);


--
-- Name: product_options product_options_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_options
    ADD CONSTRAINT product_options_name_unique UNIQUE (product_id, name);


--
-- Name: product_options product_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_options
    ADD CONSTRAINT product_options_pkey PRIMARY KEY (id);


--
-- Name: product_variant_values product_variant_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant_values
    ADD CONSTRAINT product_variant_values_pkey PRIMARY KEY (variant_id, option_id);


--
-- Name: product_variants product_variants_id_product_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_id_product_unique UNIQUE (id, product_id);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: production_reservations production_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_reservations
    ADD CONSTRAINT production_reservations_pkey PRIMARY KEY (order_id);


--
-- Name: production_settings production_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_settings
    ADD CONSTRAINT production_settings_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: refund_requests refund_requests_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: refund_requests refund_requests_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_order_id_key UNIQUE (order_id);


--
-- Name: refund_requests refund_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_pkey PRIMARY KEY (id);


--
-- Name: refund_requests refund_requests_stripe_refund_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_stripe_refund_id_key UNIQUE (stripe_refund_id);


--
-- Name: seasonal_collection_products seasonal_collection_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasonal_collection_products
    ADD CONSTRAINT seasonal_collection_products_pkey PRIMARY KEY (collection_slug, product_id);


--
-- Name: seasonal_collections seasonal_collections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasonal_collections
    ADD CONSTRAINT seasonal_collections_pkey PRIMARY KEY (slug);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.session USING btree (expire);


--
-- Name: cart_items_unique_variant_notes; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cart_items_unique_variant_notes ON public.cart_items USING btree (cart_id, variant_id, COALESCE(notes, ''::text));


--
-- Name: delivery_quotes_cart_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_quotes_cart_created_idx ON public.delivery_quotes USING btree (guest_cart_id, created_at);


--
-- Name: idx_checkout_attempts_one_active_order; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_checkout_attempts_one_active_order ON public.checkout_attempts USING btree (order_id) WHERE (status = ANY (ARRAY['creating'::text, 'open'::text]));


--
-- Name: idx_checkout_attempts_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checkout_attempts_order ON public.checkout_attempts USING btree (order_id);


--
-- Name: idx_inventory_reservations_active_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_reservations_active_variant ON public.inventory_reservations USING btree (variant_id) WHERE (status = 'reserved'::text);


--
-- Name: idx_inventory_reservations_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_reservations_order ON public.inventory_reservations USING btree (order_id);


--
-- Name: idx_orders_guest_cart_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_guest_cart_id ON public.orders USING btree (guest_cart_id) WHERE (guest_cart_id IS NOT NULL);


--
-- Name: idx_payments_stripe_intent_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payments_stripe_intent_unique ON public.payments USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL);


--
-- Name: idx_payments_stripe_session_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payments_stripe_session_unique ON public.payments USING btree (stripe_payment_id) WHERE (stripe_payment_id IS NOT NULL);


--
-- Name: idx_product_option_values_option; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_option_values_option ON public.product_option_values USING btree (option_id);


--
-- Name: idx_product_options_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_options_product ON public.product_options USING btree (product_id);


--
-- Name: idx_product_variants_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_product ON public.product_variants USING btree (product_id);


--
-- Name: notification_outbox_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_outbox_pending_idx ON public.order_notification_outbox USING btree (status, next_attempt_at);


--
-- Name: orders_delivery_service_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_delivery_service_date_idx ON public.orders USING btree (service_date) WHERE (fulfillment_method = 'delivery'::text);


--
-- Name: production_reservations_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX production_reservations_date_idx ON public.production_reservations USING btree (service_date, status);


--
-- Name: seasonal_products_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seasonal_products_product_idx ON public.seasonal_collection_products USING btree (product_id);


--
-- Name: orders trg_protect_checkout_delivery; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_checkout_delivery BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.protect_checkout_delivery();


--
-- Name: orders trg_protect_checkout_order; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_checkout_order BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.protect_checkout_order();


--
-- Name: order_items trg_protect_checkout_order_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_checkout_order_items BEFORE INSERT OR DELETE OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.protect_checkout_order_items();


--
-- Name: production_reservations trg_protect_production_reservation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_production_reservation BEFORE UPDATE ON public.production_reservations FOR EACH ROW EXECUTE FUNCTION public.protect_production_reservation();


--
-- Name: orders trg_queue_order_transactional_email; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_queue_order_transactional_email AFTER UPDATE OF payment_status, order_status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.queue_order_transactional_email();


--
-- Name: orders trg_release_cancelled_production; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_release_cancelled_production AFTER UPDATE OF order_status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.release_cancelled_production();


--
-- Name: addresses addresses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: cart_items cart_items_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES public.cart(id);


--
-- Name: cart_items cart_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: cart_items cart_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- Name: cart cart_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart
    ADD CONSTRAINT cart_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: checkout_attempts checkout_attempts_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_attempts
    ADD CONSTRAINT checkout_attempts_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: checkout_attempts checkout_attempts_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_attempts
    ADD CONSTRAINT checkout_attempts_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: delivery_quotes delivery_quotes_guest_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_quotes
    ADD CONSTRAINT delivery_quotes_guest_cart_id_fkey FOREIGN KEY (guest_cart_id) REFERENCES public.cart(id) ON DELETE CASCADE;


--
-- Name: inventory_reservations inventory_reservations_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: inventory_reservations inventory_reservations_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- Name: order_creation_requests order_creation_requests_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_creation_requests
    ADD CONSTRAINT order_creation_requests_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: order_items order_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- Name: order_notification_outbox order_notification_outbox_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_notification_outbox
    ADD CONSTRAINT order_notification_outbox_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: orders orders_guest_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_guest_cart_id_fkey FOREIGN KEY (guest_cart_id) REFERENCES public.cart(id);


--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payments payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: product_images product_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: product_option_values product_option_values_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_option_values
    ADD CONSTRAINT product_option_values_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.product_options(id) ON DELETE CASCADE;


--
-- Name: product_options product_options_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_options
    ADD CONSTRAINT product_options_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_variant_values product_variant_values_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant_values
    ADD CONSTRAINT product_variant_values_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.product_options(id) ON DELETE CASCADE;


--
-- Name: product_variant_values product_variant_values_option_value_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant_values
    ADD CONSTRAINT product_variant_values_option_value_fk FOREIGN KEY (option_value_id, option_id) REFERENCES public.product_option_values(id, option_id);


--
-- Name: product_variant_values product_variant_values_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variant_values
    ADD CONSTRAINT product_variant_values_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: production_reservations production_reservations_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_reservations
    ADD CONSTRAINT production_reservations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: refund_requests refund_requests_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: refund_requests refund_requests_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: seasonal_collection_products seasonal_collection_products_collection_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasonal_collection_products
    ADD CONSTRAINT seasonal_collection_products_collection_slug_fkey FOREIGN KEY (collection_slug) REFERENCES public.seasonal_collections(slug) ON DELETE CASCADE;


--
-- Name: seasonal_collection_products seasonal_collection_products_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasonal_collection_products
    ADD CONSTRAINT seasonal_collection_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


