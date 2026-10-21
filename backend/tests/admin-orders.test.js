import crypto from "node:crypto";

import { pool } from "../src/config/database.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";

test("GET /api/admin/orders rejects unauthenticated requests", async () => {
    const response = await request(app)
        .get("/api/admin/orders")
        .expect("Content-Type", /json/)
        .expect(401);

    assert.equal(response.body.status, "ERROR");
});

test("GET /api/admin/orders rejects authenticated customers", async () => {
    const agent = request.agent(app);

    const email = `customer-${crypto.randomUUID()}@example.com`;

    const registration = await agent
        .post("/api/auth/register")
        .send({
            firstName: "Test",
            lastName: "Customer",
            email,
            phone: "8095551234",
            password: "TestPassword123!"
        })
        .expect(201);

    assert.equal(registration.body.status, "GOOD");

    try {
        await agent
            .post("/api/auth/login")
            .send({
                email,
                password: "TestPassword123!"
            })
            .expect(200);

        const response = await agent
            .get("/api/admin/orders")
            .expect(403);

        assert.equal(response.body.status, "ERROR");
    } finally {
        await pool.query(
            `
        UPDATE users
        SET deleted_at = NOW()
        WHERE email = $1;
        `,
            [email]
        );
    }
});


test("GET /api/admin/orders allows authenticated admins", async () => {
    const agent = request.agent(app);
    const email = `admin-${crypto.randomUUID()}@example.com`;
    const password = "TestPassword123!";

    try {
        const registration = await agent
            .post("/api/auth/register")
            .send({
                firstName: "Test",
                lastName: "Admin",
                email,
                phone: "8095551234",
                password
            })
            .expect(201);

        const userId = registration.body.user.id;

        await pool.query(
            "UPDATE users SET role = 'admin' WHERE id = $1",
            [userId]
        );

        await agent
            .post("/api/auth/login")
            .send({ email, password })
            .expect(200);

        const response = await agent
            .get("/api/admin/orders")
            .expect(200);

        assert.equal(response.body.status, "GOOD");
        assert.ok(Array.isArray(response.body.orders));
    } finally {
        await pool.query(
            "UPDATE users SET deleted_at = NOW(), role = 'customer' WHERE email = $1",
            [email]
        );
    }
});


test("PATCH /api/admin/orders/:id/accept rejects unauthenticated requests", async () => {
    const orderId = crypto.randomUUID();

    const response = await request(app)
        .patch(`/api/admin/orders/${orderId}/accept`)
        .expect("Content-Type", /json/)
        .expect(401);

    assert.equal(response.body.status, "ERROR");
});

