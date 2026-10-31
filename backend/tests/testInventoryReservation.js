import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../src/config/database.js";
import { reserveInventoryForOrder } from "../src/services/inventoryReservation.service.js";
import { requireTestDatabase } from "./helpers/requireTestDatabase.js";

after(() => pool.end());

async function withOrder(run) {
  const client = await pool.connect();
  try {
    await requireTestDatabase(client);
    await client.query("BEGIN");
    const category = (
      await client.query(
        "INSERT INTO categories (name) VALUES ($1) RETURNING id",
        [`Inventory ${randomUUID()}`],
      )
    ).rows[0].id;
    const product = (
      await client.query(
        "INSERT INTO products (name,price,stock,category_id) VALUES ('Reservation Test',6,15,$1) RETURNING id",
        [category],
      )
    ).rows[0].id;
    const variant = (
      await client.query(
        "INSERT INTO product_variants (product_id,price,stock) VALUES ($1,6,15) RETURNING id",
        [product],
      )
    ).rows[0].id;
    const cart = (
      await client.query(
        "INSERT INTO cart (guest_token_hash) VALUES ($1) RETURNING id",
        [randomBytes(32).toString("hex")],
      )
    ).rows[0].id;
    const order = (
      await client.query(
        `INSERT INTO orders (guest_cart_id,shipping_name,shipping_street,shipping_street_number,shipping_city,shipping_state,shipping_zip_code,delivery_date,subtotal,shipping_cost,tax_amount,total,payment_status,order_status)
      VALUES ($1,'Reservation Tester','Test Road','123','Katy','TX','77449',NOW()+INTERVAL '5 days',18,0,0,18,'pending','pending') RETURNING id`,
        [cart],
      )
    ).rows[0].id;
    await client.query(
      `INSERT INTO order_items (order_id,product_id,variant_id,quantity,unit_price,product_name_snapshot,notes)
      VALUES ($1,$2,$3,2,6,'Reservation Test','First line'),($1,$2,$3,1,6,'Reservation Test','Second line')`,
      [order, product, variant],
    );
    await run(client, {
      order,
      variant,
      expires: new Date(Date.now() + 30 * 60000),
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

test("reserves inventory atomically without committing", () =>
  withOrder(async (client, ids) => {
    const reservations = await reserveInventoryForOrder(
      client,
      ids.order,
      ids.expires,
    );
    assert.equal(reservations.length, 1);
    assert.equal(Number(reservations[0].quantity), 3);
    assert.equal(reservations[0].status, "reserved");
    const saved = await client.query(
      "SELECT quantity,status FROM inventory_reservations WHERE order_id=$1",
      [ids.order],
    );
    assert.equal(saved.rowCount, 1);
    assert.equal(saved.rows[0].quantity, 3);
  }));
test("rejects reservations when inventory is insufficient", () =>
  withOrder(async (client, ids) => {
    await client.query("UPDATE product_variants SET stock=2 WHERE id=$1", [
      ids.variant,
    ]);
    await assert.rejects(
      reserveInventoryForOrder(client, ids.order, ids.expires),
      /Insufficient stock/,
    );
    assert.equal(
      (
        await client.query(
          "SELECT COUNT(*)::int AS count FROM inventory_reservations WHERE order_id=$1",
          [ids.order],
        )
      ).rows[0].count,
      0,
    );
  }));
test("prevents duplicate reservations for the same order", () =>
  withOrder(async (client, ids) => {
    await reserveInventoryForOrder(client, ids.order, ids.expires);
    await assert.rejects(
      reserveInventoryForOrder(client, ids.order, ids.expires),
      /already has reservation history/,
    );
    assert.equal(
      (
        await client.query(
          "SELECT COUNT(*)::int AS count FROM inventory_reservations WHERE order_id=$1",
          [ids.order],
        )
      ).rows[0].count,
      1,
    );
  }));
