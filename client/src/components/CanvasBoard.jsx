import React, { useRef, useState, useEffect } from "react";
import { io } from "socket.io-client";

// Point this to your server
const socket = io.connect("https://collab-whiteboard-l0qx.onrender.com");

const CanvasBoard = ({ boardId }) => {
    const canvasRef = useRef(null);
    const ctxRef = useRef(null);
    const isDrawingRef = useRef(false);

    const [isDrawing, setIsDrawing] = useState(false);
    const [tool, setTool] = useState("pencil");
    const [color, setColor] = useState("#000000");
    const [lineWidth, setLineWidth] = useState(3);
    const [darkMode, setDarkMode] = useState(false);
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });

    useEffect(() => {
        isDrawingRef.current = isDrawing;
    }, [isDrawing]);


    // --- Canvas setup ---
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctxRef.current = ctx;

        // Set an initial size once (no listener here)
        canvas.width = window.innerWidth * .85;
        canvas.height = window.innerHeight * .85;
    }, []);

    // --- Socket setup ---
    useEffect(() => {
        socket.emit("joinBoard", boardId);

        socket.on("draw", ({ x0, y0, x1, y1, color, lineWidth }) => {
            const ctx = ctxRef.current;
            if (!ctx) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        });


        socket.on("boardState", ({ image }) => restoreState(image));

        socket.on("clear", () => {
            const canvas = canvasRef.current;
            const ctx = ctxRef.current;
            if (!canvas || !ctx) return;

            setIsDrawing(false);

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.beginPath();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.closePath();
            ctx.restore();

            // ✅ Double-force a repaint to flush GPU buffer
            requestAnimationFrame(() => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            });
        });

        socket.on("forceStop", () => {
            isDrawingRef.current = false;
            setIsDrawing(false);
            const ctx = ctxRef.current;
            if (ctx) {
                ctx.beginPath();
                ctx.closePath();
            }
        });

        return () => {
            socket.emit("leaveBoard", boardId);
            socket.off("draw");
            socket.off("boardState");
            socket.off("clear");
        };
    }, [boardId]);

    useEffect(() => {
        const handleResize = () => {
            const canvas = canvasRef.current;
            const ctx = ctxRef.current;
            if (!canvas || !ctx) return;

            // Save current drawing
            const data = canvas.toDataURL();

            // Resize canvas
            canvas.width = window.innerWidth * .85;
            canvas.height = window.innerHeight * .85;

            // Restore the drawing
            const img = new Image();
            img.onload = () => ctx.drawImage(img, 0, 0);
            ctx.beginPath();       // reset current drawing path
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.lineWidth = lineWidth;  // restore line width
            ctx.strokeStyle = color;    // restore color
            img.src = data;
        };

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);


    // board persist
    useEffect(() => {
        socket.emit("joinBoard", boardId);

        // Explicitly ask for current board data (optional redundancy)
        socket.emit("requestState", boardId);

        socket.on("boardState", ({ image }) => {
            const canvas = canvasRef.current;
            const ctx = ctxRef.current;
            if (!canvas || !ctx || !image) return;

            const img = new Image();
            img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
            };
            img.src = image;
        });

        return () => {
            socket.emit("leaveBoard", boardId);
            socket.off("boardState");
        };
    }, [boardId]);


    const saveState = () => {
        const data = canvasRef.current.toDataURL();
        setUndoStack((prev) => [...prev, data]);
        setRedoStack([]);
    };

    const restoreState = (dataUrl) => {
        if (!dataUrl) return;
        const canvas = canvasRef.current;
        const ctx = ctxRef.current;
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
        };
        img.src = dataUrl;
    };

    const startDrawing = (e) => {
        const { offsetX, offsetY } = e.nativeEvent;
        const ctx = ctxRef.current;
        if (!ctx) return;

        // Prepare to draw immediately
        isDrawingRef.current = true;
        setIsDrawing(true);

        // Begin new path
        ctx.beginPath();
        ctx.moveTo(offsetX, offsetY);

        // Reset previous coordinates tracker
        delete draw.prevX;
        delete draw.prevY;

        // Save state for undo
        saveState();
    };

    const draw = (e) => {
        if (!isDrawingRef.current) return;

        const { offsetX, offsetY } = e.nativeEvent;
        const ctx = ctxRef.current;
        if (!ctx) return;

        // Initialize previous position if needed
        if (typeof draw.prevX === "undefined" || typeof draw.prevY === "undefined") {
            draw.prevX = offsetX;
            draw.prevY = offsetY;
        }

        // Draw locally
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = color;
        ctx.lineTo(offsetX, offsetY);
        ctx.stroke();

        // Emit live line segment
        socket.emit("draw", {
            boardId,
            x0: draw.prevX,
            y0: draw.prevY,
            x1: offsetX,
            y1: offsetY,
            color,
            lineWidth,
        });

        // Update previous coordinates
        draw.prevX = offsetX;
        draw.prevY = offsetY;
    };


    const stopDrawing = () => {
        // Always clean up regardless of ref state
        isDrawingRef.current = false;
        setIsDrawing(false);
        delete draw.prevX;
        delete draw.prevY;

        const canvas = canvasRef.current;
        if (!canvas) return;

        // Close current path and sync
        const ctx = ctxRef.current;
        if (ctx) ctx.closePath();

        const image = canvas.toDataURL();
        socket.emit("applyState", { boardId, image });
    };

    const undo = async () => {
        if (!undoStack.length) return;

        isDrawingRef.current = false;
        setIsDrawing(false);

        const canvas = canvasRef.current;
        const ctx = ctxRef.current;
        if (!canvas || !ctx) return;

        const current = canvas.toDataURL();
        const last = undoStack.pop();

        setRedoStack([...redoStack, current]);
        setUndoStack([...undoStack]);

        // ✅ Decode and paint immediately
        try {
            const blob = await (await fetch(last)).blob();
            const bitmap = await createImageBitmap(blob);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bitmap, 0, 0);
        } catch (e) {
            console.error("Undo decode failed", e);
        }

        // ✅ Notify server right away
        socket.emit("applyState", { boardId, image: last });
    };

    const redo = async () => {
        if (!redoStack.length) return;

        isDrawingRef.current = false;
        setIsDrawing(false);

        const canvas = canvasRef.current;
        const ctx = ctxRef.current;
        if (!canvas || !ctx) return;

        const current = canvas.toDataURL();
        const next = redoStack.pop();

        setUndoStack([...undoStack, current]);
        setRedoStack([...redoStack]);

        // ✅ Decode and paint immediately
        try {
            const blob = await (await fetch(next)).blob();
            const bitmap = await createImageBitmap(blob);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bitmap, 0, 0);
        } catch (e) {
            console.error("Redo decode failed", e);
        }

        // ✅ Notify server right away
        socket.emit("applyState", { boardId, image: next });
    };

    const clearCanvas = () => {
        isDrawingRef.current = false;
        setIsDrawing(false);

        const canvas = canvasRef.current;
        const ctx = ctxRef.current;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const image = canvas.toDataURL();
        socket.emit("applyState", { boardId, image });
    };


    return (
        <div className={`${darkMode ? "bg-stone-900 text-white" : "bg-gray-100 text-black"} min-h-screen flex flex-col items-center`}>
            <div className="flex flex-wrap items-center justify-center gap-3 p-3 rounded-lg shadow-md mb-4">
                <div className="flex items-center gap-2 bg-gray-300 dark:bg-gray-700 px-3 py-2 rounded-md">
                    <span className="font-semibold text-sm">Room: <span className="font-mono">{boardId}</span></span>
                    <button
                        onClick={() => {
                            const newId = prompt("Enter room code or leave blank for new:");
                            if (newId) window.location.href = `/board/${newId}`;
                            else window.location.href = `/board/${Date.now().toString(36)}`;
                        }}
                        className="ml-2 px-2 py-1 rounded bg-blue-500 hover:bg-blue-600 text-white text-sm"
                    >
                        🔁 Change Room
                    </button>
                </div>
                <button onClick={undo} className="px-2 py-1 bg-yellow-500 rounded">↩️ Undo</button>
                <button onClick={redo} className="px-2 py-1 bg-green-500 rounded">↪️ Redo</button>
                <button onClick={clearCanvas} className="px-2 py-1 bg-red-500 rounded">🧹 Clear</button>
                <button onClick={() => setDarkMode(!darkMode)} className="px-2 py-1 bg-purple-500 rounded">
                    {darkMode ? "🌙" : "☀️"}
                </button>
                <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className={`w-10 h-10 rounded-md appearance-none cursor-pointer border-none outline-none p-0 ${darkMode ? "bg-[#1e1e1e]" : "bg-white"
                        }`}
                    style={{
                        WebkitAppearance: "none",
                        MozAppearance: "none",
                    }}
                />
                <input type="range" min="1" max="20" value={lineWidth} onChange={(e) => setLineWidth(e.target.value)} />
            </div>

            <canvas
                ref={canvasRef}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                className={`rounded-lg shadow-md border-4 transition-colors duration-300 ${darkMode
                    ? "bg-[#1e1e1e] border-[#2a2a2a]"
                    : "bg-white border-gray-300"
                    }`}
            />
        </div>
    );
};

export default CanvasBoard;
