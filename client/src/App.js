import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from "react-router-dom";
import CanvasBoard from "./components/CanvasBoard";

function BoardWrapper() {
  const { boardId } = useParams();
  return <CanvasBoard boardId={boardId} />;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to={`/board/${Date.now().toString(36)}`} />} />
        <Route path="/board/:boardId" element={<BoardWrapper />} />
        <Route path="/demo" element={<Navigate to="/board/public-demo" />} />
      </Routes>
    </Router>
  );
}

export default App;
