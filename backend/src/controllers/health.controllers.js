import { pool } from '../config/database.js';

export const health = async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW();");
        const response = result.rows[0];
        res.status(200).json({
            status: "OK",
            response
        })
    } catch (error) {
        res.status(500).json({
            message: "Internal server error."
        })
        console.error(error)
    }
}