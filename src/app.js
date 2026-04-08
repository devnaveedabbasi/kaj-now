import express from "express";
import path from "path";
import { createServer } from "http";
import connectDb from "./config/db.js";
import routes from "./routes/index.js";
import cors from "cors";
import requestLogger from "./middleware/requestLogger.js";

const app = express();

if (process.env.TRUST_PROXY === "true") {
    app.set("trust proxy", 1);
}
const server = createServer(app);

const corsOptions = {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
};



app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use(requestLogger);

app.get('/', (req, res) => {
    res.send('API is working');
});



app.use("/api", routes);


connectDb();

export { server };
export default app;