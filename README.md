# Movement Assessment Tracker

Movement tracking and assessment prototype.  
Built with **React (Vite + TS) + Supabase** and deployed on **Vercel**.

## Demo
- **Live App**: https://movement-tracker-ruby.vercel.app  
- **Demo Video**: [link to Loom/Drive/YouTube recording]  
- **Screenshots**:  
  - Login / Register  
  - Dashboard with history + chart  
  - New Assessment (live camera with overlay, preview, save)  
  - Profile edit  

---

## Features

### Core
- User authentication via Supabase Auth  
- Protected routes with React Router  
- Movement assessment flow:
  - Select Squat / Plank / Side Bend
  - Record 10s video **or** capture photo **or** upload file
  - Real-time overlay of joints (pose model)  
  - Score (1–10) with AI feedback  
- Assessments saved to Supabase (row + media file)  
- Dashboard:
  - History of past assessments
  - Signed URLs for video/photo previews
  - Score trend chart (Recharts)  

### Extra
- Minimal **profile** table (full name, bio) editable in Profile page  
- Delete assessment (row + Storage cleanup)  
- Camera countdown (3s record / 2s photo)  
- Responsive 2-pane New Assessment UI:
  - Left: live camera with overlay + controls  
  - Right: recorded preview + Save  
- Deployed on Vercel with SPA routing fix (`vercel.json` rewrite)

---

## Stack

- **Frontend**: React 22 + Vite + TypeScript
- **UI**: TailwindCSS
- **Auth/DB/Storage**: Supabase
- **AI / Pose**: TensorFlow.js MoveNet (Lightning, WebGL backend)
- **Charts**: Recharts
- **Deployment**: Vercel (with rewrites for SPA routes)

---

## Data Model

### Supabase tables
```sql
-- profiles
id uuid primary key references auth.users(id) on delete cascade,
full_name text,
bio text,
created_at timestamptz default now(),
updated_at timestamptz default now()

-- assessments
id uuid primary key default gen_random_uuid(),
user_id uuid references auth.users(id) on delete cascade,
movement_type text not null,
score int not null,
feedback text not null,
media_url text not null,
analysis jsonb,
created_at timestamptz default now()
