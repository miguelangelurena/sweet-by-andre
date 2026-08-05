import dotenv from "dotenv"; //Importa DotEnv
dotenv.config(); //Configura DotEnv

import { Pool } from "pg" //Importa Pool (Para múltiples conexiones)

// Se utiliza un pool porque una aplicación web recibe múltiples
// peticiones concurrentes y reutilizar conexiones mejora el rendimiento.
export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
})