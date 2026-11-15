export async function assertProductionDatabase(client, env = process.env, { requireInitialized = true } = {}) {
  const name = (await client.query("SELECT current_database() AS name")).rows[0].name;
  if (name !== env.PRODUCTION_DB_NAME || /(?:^|[_-])(dev|development|test|staging|restore)(?:$|[_-])/i.test(name))
    throw new Error("Production refuses this database: use its exact dedicated PRODUCTION_DB_NAME");
  if (requireInitialized) {
    const marker = (await client.query("SELECT to_regclass('public.deployment_metadata') AS marker")).rows[0].marker;
    if (!marker) throw new Error("Production database is not initialized; use start:production");
    const metadata = (await client.query("SELECT key,value FROM public.deployment_metadata WHERE key IN ('environment','bootstrap_version')")).rows;
    const values = Object.fromEntries(metadata.map(row => [row.key, row.value]));
    if (values.environment !== "production" || values.bootstrap_version !== "1")
      throw new Error("Database is not marked as the supported production environment");
  }
}
