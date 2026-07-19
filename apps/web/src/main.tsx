import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { recoverChatHistory } from "./persistence.js";
import "./theme.css";

// Before the Ask panel reads its backlog, restore it from a backup if the live
// history is empty — so a cleared tab or restore doesn't lose past chats.
recoverChatHistory();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
