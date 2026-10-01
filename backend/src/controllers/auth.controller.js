import { pool } from "../config/database.js";
import bcrypt from "bcrypt";

export const register = async (req, res) => {
    try {
        const firstName = req.body.firstName?.trim();
        const lastName = req.body.lastName?.trim();
        const email = req.body.email?.trim().toLowerCase();
        const phone = req.body.phone?.trim();
        const password = req.body.password;

        if (!firstName || !lastName || !email || !phone || !password) {
            return res.status(400).json({
                status: "ERROR",
                message: "All fields are required!"
            });
        }

        const existingUser = await pool.query(
            "SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL",
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                status: "ERROR",
                message: "Email already registered"
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await pool.query(
            `INSERT INTO users (
                first_name,
                last_name,
                email,
                phone,
                password_hash
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, first_name, last_name, email, phone, role, created_at`,
            [
                firstName,
                lastName,
                email,
                phone,
                passwordHash
            ]
        );

        return res.status(201).json({
            status: "GOOD",
            message: "User registered successfully",
            user: result.rows[0]
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};

export const login = async (req, res) => {
    try {
        console.log("1. Login request received");

        const email = req.body.email?.trim().toLowerCase();
        const password = req.body.password;

        console.log("2. Body parsed");

        if (!email || !password) {
            return res.status(400).json({
                status: "ERROR",
                message: "Email and password are required!"
            });
        }

        console.log("3. Before database query");

        const result = await pool.query(
            `SELECT id, first_name, last_name, email, phone, password_hash, role
             FROM users
             WHERE email = $1
             AND deleted_at IS NULL`,
            [email]
        );

        console.log("4. Database query finished");

        if (result.rows.length === 0) {
            return res.status(401).json({
                status: "ERROR",
                message: "Invalid email or password"
            });
        }

        console.log("5. User found");

        const user = result.rows[0];

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        console.log("6. Password comparison finished");

        if (!passwordMatches) {
            return res.status(401).json({
                status: "ERROR",
                message: "Invalid email or password"
            });
        }

        console.log("7. Password correct, before session regenerate");

        req.session.regenerate((err) => {
            console.log("8. Session regenerate callback");

            if (err) {
                console.error(err);
                return res.status(500).json({
                    status: "ERROR",
                    message: "Internal server error"
                });
            }

            req.session.userId = user.id;

            console.log("9. userId assigned to session");

            return res.status(200).json({
                status: "GOOD",
                message: "Login successful"
            });
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};

export const getMe = async (req, res) => {
    try {
        const userId = req.session.userId;

        if (!userId) {
            return res.status(401).json({
                status: "ERROR",
                message: "Not authenticated"
            });
        }

        const result = await pool.query(
            `SELECT id, first_name, last_name, email, phone, role, created_at
             FROM users
             WHERE id = $1
             AND deleted_at IS NULL`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                status: "ERROR",
                message: "User not found"
            });
        }

        return res.status(200).json({
            status: "GOOD",
            user: result.rows[0]
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            status: "ERROR",
            message: "Internal server error"
        });
    }
};