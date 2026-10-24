
export async function requireTestDatabase(pool) {
    const result = await pool.query(
        "SELECT current_database() AS database_name"
    );

    const databaseName = result.rows[0]?.database_name;

    if (databaseName !== "sweet_by_andre_test") {
        throw new Error(
            `Unsafe test database: ${databaseName}. ` +
            "Expected sweet_by_andre_test."
        );
    }

    return true;
}
