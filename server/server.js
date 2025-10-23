import express from "express";
import http from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());

// frontend connection
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ["https://collab-whiteboard-liart.vercel.app"],
        methods: ["GET", "POST"],
        credentials: true
    }
});

// mango?
const mongoURI = process.env.MONGO_URI;
const PORT = process.env.PORT || 3001;

mongoose
    .connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log(":) Connected to MongoDB"))
    .catch((err) => console.error(":( MongoDB connection error:", err));

const boardSchema = new mongoose.Schema({
    boardId: { type: String, required: true, unique: true },
    image: { type: String, default: "" }, // base64 image data
});
const Board = mongoose.model("Board", boardSchema);

const boardStates = {};

// sockets
io.on("connection", (socket) => {
    console.log("!! User connected:", socket.id);

    // join board
    socket.on("joinBoard", async (boardId) => {
        socket.join(boardId);
        console.log(`!-> User ${socket.id} joined board ${boardId}`);

        // checks cache, if not pulls from database
        if (boardStates[boardId]) {
            socket.emit("boardState", { image: boardStates[boardId] });
        } else {
            const existing = await Board.findOne({ boardId });
            if (existing && existing.image) {
                boardStates[boardId] = existing.image;
                socket.emit("boardState", { image: existing.image });
            }
        }
    });

    // draw
    socket.on("draw", (data) => {
        socket.to(data.boardId).emit("draw", data);
    });


    // save
    socket.on("applyState", async ({ boardId, image }) => {
        if (!boardId || !image) return;
        boardStates[boardId] = image;

        await Board.findOneAndUpdate(
            { boardId },
            { image },
            { upsert: true, new: true }
        );

        socket.to(boardId).emit("boardState", { image });
    });

    // clear
    socket.on("clear", async (boardId) => {
        if (!boardId) return;
        boardStates[boardId] = "";

        await Board.findOneAndUpdate(
            { boardId },
            { image: "" },
            { upsert: true, new: true }
        );

        socket.to(boardId).emit("clear");
    });

    socket.on("disconnect", () => {
        console.log(`## User ${socket.id} disconnected`);
    });
});

// server start
server.listen(PORT, () => console.log(`:) Server running on port ${PORT}`));
