
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";

test("GET /api/health responds successfully and confirms database connectivity", async () => {
    const response = await request(app)
        .get("/api/health")
        .expect("Content-Type", /json/)
        .expect(200);

    assert.equal(response.body.status, "OK");
    assert.ok(response.body.response, "Expected database information");
    assert.ok(response.body.response.now, "Expected database timestamp");
    assert.ok(response.body.response.current_user, "Expected database user");
    assert.ok(response.body.response.current_database, "Expected database name");
});

test("GET /api/auth/me rejects unauthenticated requests", async () => {
    const response = await request(app)
        .get("/api/auth/me")
        .expect("Content-Type", /json/)
        .expect(401);

    assert.equal(response.body.status, "ERROR");
    assert.equal(response.body.message, "Not authenticated");
});

test("POST /api/auth/register rejects incomplete registration data", async () => {
    const response = await request(app)
        .post("/api/auth/register")
        .send({
            email: "incomplete@example.com"
        })
        .expect("Content-Type", /json/)
        .expect(400);

    assert.equal(response.body.status, "ERROR");
    assert.equal(response.body.message, "All fields are required!");
});

test("POST /api/auth/login rejects invalid credentials", async () => {
    const response = await request(app)
        .post("/api/auth/login")
        .send({
            email: "nonexistent-user@example.com",
            password: "InvalidPassword123!"
        })
        .expect("Content-Type", /json/)
        .expect(401);

    assert.equal(response.body.status, "ERROR");
    assert.equal(response.body.message, "Invalid email or password");
});
