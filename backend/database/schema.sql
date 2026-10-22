CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================
-- USERS
-- =========================
CREATE TABLE
    users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT NOT NULL,
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
    );

-- =========================
-- CATEGORIES
-- =========================
CREATE TABLE
    categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

-- =========================
-- PRODUCTS
-- =========================
CREATE TABLE
    products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
        name TEXT NOT NULL,
        description TEXT,
        price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
        stock INTEGER NOT NULL CHECK (stock >= 0),
        category_id UUID NOT NULL REFERENCES categories (id),
        is_available BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

-- =========================
-- PRODUCT IMAGES
-- =========================
CREATE TABLE
    product_images (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
        display_order INTEGER NOT NULL,
        image_url TEXT NOT NULL,
        product_id UUID NOT NULL REFERENCES products (id),
        UNIQUE (product_id, display_order)
    );

-- =========================
-- CART
-- =========================
CREATE TABLE
    cart (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
        user_id UUID NOT NULL UNIQUE REFERENCES users (id),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '2 hours')
    );

-- =========================
-- CART ITEMS
-- =========================
CREATE TABLE
    cart_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
        cart_id UUID NOT NULL REFERENCES cart (id),
        product_id UUID NOT NULL REFERENCES products (id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        price_at_added NUMERIC(10, 2) NOT NULL CHECK (price_at_added >= 0),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (cart_id, product_id)
    );

-- =========================
-- ORDERS
-- =========================
CREATE TABLE
    orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
        user_id UUID NOT NULL REFERENCES users (id),
        -- Address snapshot
        shipping_name TEXT NOT NULL,
        shipping_street TEXT NOT NULL,
        shipping_street_number TEXT NOT NULL,
        shipping_unit TEXT,
        shipping_city TEXT NOT NULL,
        shipping_state TEXT NOT NULL,
        shipping_zip_code TEXT NOT NULL,
        delivery_instructions TEXT,
        note TEXT,
        delivery_date TIMESTAMP NOT NULL,
        subtotal NUMERIC(10, 2) NOT NULL CHECK (subtotal >= 0),
        shipping_cost NUMERIC(10, 2) NOT NULL CHECK (shipping_cost >= 0),
        tax_amount NUMERIC(10, 2) NOT NULL CHECK (tax_amount >= 0),
        total NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
        payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'partial', 'paid')),
        order_status TEXT NOT NULL CHECK (
            order_status IN (
                'pending',
                'confirmed',
                'preparing',
                'ready',
                'completed',
                'cancelled'
            )
        ),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

-- =========================
-- ORDER ITEMS
-- =========================
CREATE TABLE
    order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
        order_id UUID NOT NULL REFERENCES orders (id),
        product_id UUID NOT NULL REFERENCES products (id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (order_id, product_id)
    );

-- =========================
-- PAYMENTS
-- =========================
CREATE TABLE
    payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
        order_id UUID NOT NULL REFERENCES orders (id),
        stripe_payment_id TEXT,
        amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
        status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

-- =========================
-- ADDRESSES
-- =========================
CREATE TABLE
    addresses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
        user_id UUID NOT NULL REFERENCES users (id),
        label TEXT,
        street TEXT NOT NULL,
        street_number TEXT NOT NULL,
        unit TEXT,
        city TEXT NOT NULL,
        state TEXT NOT NULL,
        zip_code TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );