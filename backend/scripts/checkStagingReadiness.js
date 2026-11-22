import { checkStagingReadiness } from "./lib/stagingReadiness.js";

try {
  if (process.argv.length > 3) throw new Error("Unexpected arguments");
  const result = await checkStagingReadiness({ url: process.argv[2] });
  console.log(JSON.stringify(result, null, 2));
  if (result.failed) process.exitCode = 1;
} catch {
  console.error(
    "Staging check could not start. Use an HTTPS origin without credentials, path, query or fragment.",
  );
  process.exitCode = 1;
}
