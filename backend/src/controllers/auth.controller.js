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