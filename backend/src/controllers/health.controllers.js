import { pool } from '../config/database.js';

export const health = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                NOW() AS now,
                current_user,
                current_database(),
                inet_server_addr(),
                inet_server_port()
        `);

        res.json({
            status: "OK",
            response: result.rows[0]
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            status: "ERROR",
            message: "Database connection failed"
        });
    }
};