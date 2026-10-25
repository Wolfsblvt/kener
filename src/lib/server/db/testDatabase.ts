/**
 * The database a server test runs against. By default an in-memory SQLite database; with `TEST_DATABASE_URL`
 * (`postgresql://…` or `mysql://…`) the same test runs on that engine instead, so one file proves a read path on all
 * three supported engines. The test empties the tables it uses, so point it only at a throwaway server.
 */
export async function CreateTestDb() {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { default: DbImpl } = await import("./dbimpl");
  if (process.env.TEST_DATABASE_URL) {
    const { default: knexConfig } = await import("../../../../knexfile");
    return new DbImpl(knexConfig);
  }
  return new DbImpl({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
}
