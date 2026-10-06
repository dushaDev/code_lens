# Code Lens — Academic Git Project Analyzer

Code Lens is a modern academic repository analyzer built to help instructors evaluate student contributions in collaborative Git repositories. It uses AST parsing (via tree-sitter) and Git log parsing (via PyDriller) to calculate git metrics, suspicious squash commit highlights, and the **Gini Coefficient** of contribution inequality.

---

## 📂 Project Structure (Monorepo)

```
code_lens/
├── backend/                  # FastAPI & SQLAlchemy Backend
│   ├── src/
│   │   ├── domain/           # Core Entities & Business Models (No external imports)
│   │   ├── use_cases/        # Application Business Workflows
│   │   ├── infrastructure/   # API Routers, DB Models, Auth, and Services
│   │   └── main.py           # FastAPI Application Entry
│   ├── requirements.txt      # Python Dependencies
│   └── .env                  # Environment configs (DB Url, JWT secret)
└── frontend/                 # React & Vite Frontend
    ├── src/
    │   ├── components/       # Layout parts (Sidebar, Header, Modals)
    │   ├── views/            # Screen views (Login, Courses, Dashboard, Analytics)
    │   ├── App.jsx           # App state & view router
    │   └── index.css         # Modern HSL CSS Design System
    └── vite.config.js        # Vite config & API proxy (Port 3000 -> Port 8000)
```

---

## ⚡ 1. Backend Setup & Run

### Prerequisites
- Python 3.10+
- PostgreSQL database running locally

### Installation Steps

1. Navigate to the backend directory:
   ```powershell
   cd backend
   ```

2. Create a Python virtual environment:
   ```powershell
   python -m venv venv
   ```

3. Activate the virtual environment:
   * **Windows PowerShell**:
     ```powershell
     .\venv\Scripts\Activate.ps1
     ```
   * **Windows Command Prompt**:
     ```cmd
     .\venv\Scripts\activate.bat
     ```
   * **macOS / Linux**:
     ```bash
     source venv/bin/activate
     ```

4. Install the backend dependencies:
   ```bash
   pip install -r requirements.txt
   ```

5. Configure your environment variables. Create a `.env` file in the `backend/` directory:
   ```env
   # Database Configuration (Replace 'your_password' with your local PostgreSQL password)
   DATABASE_URL=postgresql://postgres:your_password@localhost:5432/codelens_db

   # JWT Token Configuration
   SECRET_KEY=generate_a_long_random_secure_hex_key_here
   ALGORITHM=HS256
   ACCESS_TOKEN_EXPIRE_MINUTES=60
   ```

6. Start the FastAPI server:
   ```bash
   uvicorn src.main:app --reload --reload-dir src
   ```
   *The backend will run on **`http://127.0.0.1:8000`**. Tables will be created automatically in your database upon first startup.*

   > **Note:** `--reload-dir src` restricts the auto-reloader to the source folder. Without it, cloning a repository into `saved_repos/` (or `temp_repos/`) writes source files that the reloader detects, restarting the server mid-extraction.

---

## 💻 2. Frontend Setup & Run

### Prerequisites
- Node.js (v18+) & npm

### Installation Steps

1. Open a new terminal window and navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install the frontend dependencies:
   ```bash
   npm install
   ```

3. Launch the hot-reloaded local development server:
   ```bash
   npm run dev
   ```
   *The frontend will run on **`http://localhost:3000`** and proxy all API calls (`/api/v1/*`) to the backend on port 8000.*

---

## 🎯 3. Code Lens Key Features

1. **JWT Authentication & Security**: Secure credential-based login (`/api/v1/auth/login`) protecting all analytical endpoints. Includes a **Demo / Offline Mode** bypass button for testing.
2. **Course Scoping**: Instructors can organize student groups under discrete courses.
3. **PyDriller Extraction & AST Analysis**: Clones remote Git repositories locally, traverses commits, and parses files across 20+ languages to calculate structural qualitative complexity.
4. **Gini Coefficient Calculation**: Computes contribution inequality values. Gini index near `0.0` means equal coding shares; Gini index above `0.6` flags **High Risk** warning alerts (indicating one student did all the work).
5. **Deduplication Alias Merging**: Offers an inline merge selector to combine duplicate student profiles (e.g. multiple email aliases in Git commits) and automatically recalculates all project metrics.
6. **Instructor Resets**: Includes password-verified clearing controls:
   - **Course Reset**: Wipes projects/commits under one course.
   - **System Reset**: Clears all courses (never deletes `users` table).
