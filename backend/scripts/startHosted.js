import "dotenv/config";

if (process.env.APP_ENV === "staging") await import("./startStaging.js");
else if (process.env.APP_ENV === "production") await import("./startProduction.js");
else throw new Error("Hosted startup requires APP_ENV=staging or production");
