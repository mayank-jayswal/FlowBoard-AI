# FlowBoard AI 🚀

A full-stack, collaborative Kanban board web application with real-time sync and built-in AI capabilities powered by Google Gemini.

---

## ✨ Features

- 📋 **Interactive Kanban Board**: Drag-and-drop tasks across columns with fractional position reordering using `@dnd-kit`.
- ⚡ **Real-Time Collaboration**: Powered by **Socket.IO** — live task updates, instant card movement, column syncing, and user presence indicators across active sessions.
- 🤖 **AI-Powered Features (Google Gemini)**:
  - **AI Task Generator**: Converts high-level project goals into actionable backlogs with auto-assigned priorities and descriptions.
  - **AI Subtask Breakdown**: Deconstructs complex tasks into modular, manageable subtasks.
  - **AI Sprint Summary**: Analyzes board state to generate headline insights, completed milestones, blockers, and recommendations.
- 🔐 **Authentication & Access Control**: JWT-based authentication with bcrypt password hashing and granular board member roles (`owner`, `admin`, `member`).
- 📊 **Cross-Board Views**: Aggregated task views including **My Tasks** and a **Calendar** timeline.
- 🗄️ **Modern Relational Database**: Serverless PostgreSQL hosted on **Neon** managed via **Prisma ORM**.

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 19 + Vite
- **Routing**: React Router v7
- **Styling**: Tailwind CSS v4 + Framer Motion
- **Drag & Drop**: `@dnd-kit/core` & `@dnd-kit/sortable`
- **Real-time Client**: Socket.IO Client
- **HTTP Client**: Axios
- **Icons & UI**: Lucide React, react-hot-toast

### Backend
- **Runtime**: Node.js + Express (ES Modules)
- **Database**: PostgreSQL (Neon Serverless)
- **ORM**: Prisma Client v7 with `@prisma/adapter-pg`
- **Real-time Server**: Socket.IO
- **AI Integration**: `@google/generative-ai` (Gemini 3.5 Flash Lite)
- **Security**: Helmet, CORS, JWT, Bcrypt

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+ or v22+)
- A free [Neon](https://neon.tech) PostgreSQL account
- A free [Google AI Studio](https://aistudio.google.com/app/apikey) Gemini API key

---

### 1. Clone the Repository
```bash
git clone https://github.com/mayank-jayswal/FlowBoard-AI.git
cd FlowBoard-AI
```

---

### 2. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
```

Open `backend/.env` and configure:
```env
# Neon Database Connection Strings
DATABASE_URL="postgresql://<user>:<password>@<neon-pooler-host>/neondb?sslmode=require"
DIRECT_URL="postgresql://<user>:<password>@<neon-direct-host>/neondb?sslmode=require"

# JWT Secret
JWT_SECRET="your-secure-random-jwt-secret"
PORT=5050
CLIENT_URL="http://localhost:5173"

# Google Gemini AI
AI_PROVIDER="google"
GEMINI_API_KEY="your-gemini-api-key"
```

Push schema to your database and start the server:
```bash
# Push schema to Neon DB
npx prisma db push

# Start backend dev server
npm run dev
```
Backend runs at `http://localhost:5050`.

---

### 3. Frontend Setup

```bash
cd ../frontend

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
```

Start the frontend dev server:
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## 📁 Project Structure

```
FlowBoard-AI/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma        # Database models (User, Board, Column, Task, Activity, Member)
│   ├── src/
│   │   ├── routes/              # auth, boards, users, ai
│   │   ├── middleware/          # JWT authentication
│   │   ├── lib/                 # Prisma client instance
│   │   └── index.js             # Express + Socket.IO server setup
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/          # Kanban board, AI modals, layout, UI primitives
│   │   ├── pages/               # Dashboard, BoardPage, MyTasks, Calendar, Team, Settings
│   │   ├── context/             # AuthContext, BoardsContext
│   │   ├── hooks/               # useBoard, useWorkspace
│   │   └── lib/                 # api.js, socket.js
│   └── package.json
│
└── README.md
```

---

## 📄 License
This project is open source and available under the [MIT License](LICENSE).
