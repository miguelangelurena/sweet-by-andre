import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import app from "../src/app.js";
import { pool } from "../src/config/database.js";

test("authentication flow: register, login, access profile, logout", async () => {
    const email = `auth-flow-${randomUUID()}@example.com`;
    const password = "TestPassword123!";
    const agent = request.agent(app);

    try {
        const registration = await agent
            .post("/api/auth/register")
            .send({
                firstName: "Auth",
                lastName: "Test",
                email,
                phone: "8095550100",
                password
            })
            .expect("Content-Type", /json/)
            .expect(201);

        assert.equal(registration.body.status, "GOOD");
        assert.equal(registration.body.user.email, email);
        assert.equal(registration.body.user.role, "customer");
        assert.ok(registration.body.user.id);

        const login = await agent
            .post("/api/auth/login")
            .send({ email, password })
            .expect("Content-Type", /json/)
            .expect(200);

        assert.equal(login.body.status, "GOOD");
        assert.match(login.headers["set-cookie"]?.join(";") ?? "", /connect\.sid/);

        const profile = await agent
            .get("/api/auth/me")
            .expect("Content-Type", /json/)
            .expect(200);

        assert.equal(profile.body.status, "GOOD");
        assert.equal(profile.body.user.email, email);

        const logout = await agent
            .post("/api/auth/logout")
            .expect("Content-Type", /json/)
            .expect(200);

        assert.equal(logout.body.status, "GOOD");

        const afterLogout = await agent
            .get("/api/auth/me")
            .expect("Content-Type", /json/)
            .expect(401);

        assert.equal(afterLogout.body.status, "ERROR");
        assert.equal(afterLogout.body.message, "Not authenticated");
    } finally {
        await pool.query(
            "UPDATE users SET deleted_at = NOW() WHERE email = $1 AND deleted_at IS NULL",
            [email]
        );
    }
});

test("authenticated sessions cannot access profiles after account deactivation", async () => {
    const email = `auth-disabled-${randomUUID()}@example.com`;
    const password = "TestPassword123!";
    const agent = request.agent(app);

    try {
        await agent
            .post("/api/auth/register")
            .send({
                firstName: "Disabled",
                lastName: "Test",
                email,
                phone: "8095550101",
                password
            })
            .expect(201);

        await agent
            .post("/api/auth/login")
            .send({ email, password })
            .expect(200);

        await pool.query(
            "UPDATE users SET deleted_at = NOW() WHERE email = $1",
            [email]
        );

        const response = await agent
            .get("/api/auth/me")
            .expect("Content-Type", /json/)
            .expect(401);

        assert.equal(response.body.status, "ERROR");
        assert.equal(response.body.message, "User not found");
    } finally {
        await pool.query(
            "UPDATE users SET deleted_at = NOW() WHERE email = $1 AND deleted_at IS NULL",
            [email]
        );
    }
});

test("registration rejects duplicate emails regardless of letter case", async () => {
    const email = `auth-duplicate-${randomUUID()}@example.com`;
    const password = "TestPassword123!";

    try {
        const payload = {
            firstName: "Duplicate",
            lastName: "Test",
            email,
            phone: "8095550102",
            password
        };

        await request(app)
            .post("/api/auth/register")
            .send(payload)
            .expect(201);

        const duplicate = await request(app)
            .post("/api/auth/register")
            .send({
                ...payload,
                email: email.toUpperCase()
            })
            .expect("Content-Type", /json/)
            .expect(409);

        assert.equal(duplicate.body.status, "ERROR");
        assert.equal(duplicate.body.message, "Email already registered");
    } finally {
        await pool.query(
            "UPDATE users SET deleted_at = NOW() WHERE email = $1 AND deleted_at IS NULL",
            [email]
        );
    }
});
